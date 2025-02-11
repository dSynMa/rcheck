import { execFile, ExecFileException } from "child_process";
import * as path from 'node:path';
import { promisify } from "node:util";
import * as vscode from "vscode";
import { Temp } from "./temp.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { integer } from "vscode-languageserver";
import { ChildProcess } from "node:child_process";
import { jarCallback } from "./common.js";

let temp: Temp
let hasnuxmv: boolean
let channel: vscode.OutputChannel
let smvFile: string
let tmpDirName: string
const execPromise = promisify(execFile);

class Cancel {
    children: ChildProcess[] = []
    Push(child: ChildProcess) {
        this.children.push(child);
    }
    Cancel() {
        this.children.forEach((c) => c.kill());
        this.children = []
    }

}

export class Verify {
    constructor(context: vscode.ExtensionContext, t: Temp, chan: vscode.OutputChannel) {
        channel = chan;
        temp = t;
        (async () => await execPromise("which", ["nuxmv"]).then(() => hasnuxmv = true, (err) => hasnuxmv = false))();
    }

    /**
     * Register the command
     * @param context The ExtensionContext for our extension
     */
    Init(context: vscode.ExtensionContext): void {
        const args = ["--smv", "-tmp"]
        context.subscriptions.push(
            vscode.commands.registerCommand('rcheck.verify', () => jarCallback(context, args, check, smvCallback))
        );
        tmpDirName = mkdtempSync(path.join(tmpdir(), "rcheck-"));
        temp.addDir(tmpDirName);
    }
}

function check() {
    if (!hasnuxmv) {
        vscode.window.showErrorMessage("This command requires nuxmv.");
    }
    return hasnuxmv;
}

/**
 * Process SMV file
 */
async function smvCallback(err: ExecFileException | null, _: string, stderr: string) {
    if (err) {
        vscode.window.showErrorMessage(err.message);
        return;
    }
    smvFile = stderr.trim();
    temp.addFile(smvFile);

    execFile("grep", ["-B", "1", "^LTLSPEC", smvFile], grepCallback);
}

/**
 * Launch verification tasks
 */
async function grepCallback(err: ExecFileException | null, stdout: string, _: string) {
    if (err) {
        vscode.window.showErrorMessage(err.message);
        return;
    }

    const specs = stdout.trim().replace("\n", "").split("--").slice(1)
    channel.show();
    channel.appendLine("Model checking...");
    const canc = new Cancel();
    // new Promise(f => setTimeout(f, 20000)).then(() => canc.Cancel());
    // await new Promise(f => setTimeout(f, 100)).then(() => channel.appendLine("Model checking..."));
    Promise
        .all(specs.map((element, index) => ic3(smvFile, index, element, canc)))
        .then((x) => { x.forEach((a) => channel.appendLine(a || ""))})
        // .catch((x) => channel.appendLine(x))
        .then(() => channel.appendLine("Done."));
    
    // channel.appendLine("Done");
}

/**
 * Verify an LTLSPEC property using IC3.
 * @param fname Name of the .smv file 
 * @param index Index of property being verified
 * @param spec The full text of the LTLSPEC being verified
 */
function ic3(fname: string, index: integer, spec: string, canc: Cancel, build_boolean_model: boolean=false) {
    const split = spec.split("LTLSPEC").map((x) => x.trim());
    // TODO a.  In some cases build_boolean_model is not needed and will actually
    //          make the entire script fail, must detect & retry without it
    //      b.  If spec starts with G one can use check_property_as_invar_ic3
    const smvCommands = `
        set on_failure_script_quits 1
        go_msat
        ${build_boolean_model ? "build_boolean_model" : ""}
        check_ltlspec_ic3 -p "${split[1]}"
        quit`;
    const script = path.join(tmpDirName, `ltlspec-${index}.smv`);
    

    return new Promise<string>((resolve, reject) => {
        temp.addFile(script);
        writeFileSync(script, smvCommands);
        const child = execFile("nuxmv", ["-source", script, fname], async (err,stdout,stderr) => {
            if (err) {
                if (err.message.indexOf("The boolean model must be built") > -1) {
                    await ic3(fname, index, spec, canc, true).then(resolve, reject);
                }
                else {
                    vscode.window.showErrorMessage(err.message);
                    reject(err.message);
                }
            } else {
                const stderrTrim = stderr.trim();
                // channel.appendLine(stderrTrim);
                if (stderrTrim && stderrTrim.indexOf("The boolean model must be built") > -1) {
                    await ic3(fname, index, spec, canc, true).then(resolve, reject);
                }
                else {
                    if (stderrTrim) { vscode.window.showWarningMessage(stderrTrim); }
                    resolve(stdout);
                }
            }
            });
        canc.Push(child);
        
    });
}