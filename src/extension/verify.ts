import { execFile, ExecFileException } from "child_process";
import * as path from 'node:path';
import { promisify } from "node:util";
import * as vscode from "vscode";
import { Temp } from "./temp.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { integer } from "vscode-languageserver";

let temp: Temp
let jarPath: string
let hasnuxmv: boolean
let channel: vscode.OutputChannel
let smvFile: string
let tmpDirName: string
const execPromise = promisify(execFile);

export class Verify {
    constructor(context: vscode.ExtensionContext, t: Temp, chan: vscode.OutputChannel) {
        channel = chan;
        jarPath = context.asAbsolutePath(path.join('bin', 'rcheck-0.1.jar'));
        temp = t;
        (async () => await execPromise("which", ["nuxmv"]).then(() => hasnuxmv = true, (err) => hasnuxmv = false))();
    }

    /**
     * Register the command
     * @param context The ExtensionContext for our extension
     */
    Init(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('rcheck.verify', callback)
        );
        tmpDirName = mkdtempSync(path.join(tmpdir(), "rcheck-"));
        temp.addDir(tmpDirName);
    }
}

async function callback() {
    if (!hasnuxmv) {
        vscode.window.showErrorMessage("This command requires nuxmv.");
        return;
    }
    const args = ["-jar", jarPath, "-i", vscode.window.activeTextEditor?.document.fileName!, "--smv", "-tmp"]
    execFile("java", args, smvCallback);
}

async function smvCallback(err: ExecFileException | null, _: string, stderr: string) {
    if (err) {
        vscode.window.showErrorMessage(err.message);
        return;
    }
    smvFile = stderr.trim();
    temp.addFile(smvFile);

    execFile("grep", ["-B", "1", "^LTLSPEC", smvFile], grepCallback);
}

async function grepCallback(err: ExecFileException | null, stdout: string, _: string) {
    if (err) {
        vscode.window.showErrorMessage(err.message);
        return;
    }

    const specs = stdout.trim().replace("\n", "").split("--")
    channel.show();
    specs.forEach((element, index) => { ic3(smvFile, index, element); });
}

/**
 * Verify an LTLSPEC property using IC3.
 * @param fname Name of the .smv file 
 * @param index Index of property being verified
 * @param spec The full text of the LTLSPEC being verified
 */
async function ic3(fname: string, index: integer, spec: string) {

    const split = spec.split("LTLSPEC").map((x) => x.trim());
    
    // TODO a.  In some cases build_boolean_model is not needed and will actually
    //          make the entire script fail, must detect & retry without it
    //      b.  If spec starts with G one can use check_property_as_invar_ic3
    const smvCommands = `
        go_msat
        build_boolean_model
        check_ltlspec_ic3 -p "${split[1]}"
        quit`;

    const script = path.join(tmpDirName, `ltlspec-${index}.smv`);
    temp.addFile(script);
    writeFileSync(script, smvCommands);
    

    execFile("nuxmv", ["-source", script, fname], (err,stdout,stderr) => {
        if (err) {
            vscode.window.showErrorMessage(err.message);
            return;
        }
        const stderrTrim = stderr.trim();
        if (stderrTrim) {
            vscode.window.showWarningMessage(stderrTrim);
        }
        channel.appendLine(stdout);
    });
}