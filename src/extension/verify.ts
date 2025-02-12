import { execFile, ExecFileException } from "child_process";
import * as path from 'node:path';
import { promisify } from "node:util";
import * as vscode from "vscode";
import { Temp } from "./temp.js";
import { writeFileSync } from "node:fs";
import { integer } from "vscode-languageserver";
import { getCurrentRcpFile, jarCallback } from "./common.js";

let temp: Temp
let hasnuxmv: boolean
let channel: vscode.OutputChannel
let smvFile: string
let tmpDirName: string
const execPromise = promisify(execFile);

export class Verify {
    constructor(t: Temp, chan: vscode.OutputChannel) {
        channel = chan;
        temp = t;
        (async () => await execPromise("which", ["nuxmv"]).then(() => hasnuxmv = true, (err) => hasnuxmv = false))();
    }

    /**
     * Register the command
     * @param context The ExtensionContext for our extension
     */
    Init(context: vscode.ExtensionContext): void {
        tmpDirName = temp.makeDir("rcheck-");
        context.subscriptions.push(
            vscode.commands.registerCommand('rcheck.verify', () => {
                const rcpPath = getCurrentRcpFile()!;
                const args = ["-i", rcpPath, "--smv", "-tmp"]
                jarCallback(context, args, check, smvCallback)
            })
        );
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
    const editor = vscode.window.visibleTextEditors.find((x) => x.document.fileName.endsWith("rcp"));
    const fname = editor?.document.uri.fsPath.toString()!
    if (err) {
        vscode.window.showErrorMessage(err.message);
        return;
    }
    smvFile = stderr.trim();
    temp.addFile(smvFile);

    execFile(
        "grep", ["-B", "1", "^LTLSPEC", smvFile],
        (err, stdout, stderr) => grepCallback(fname, err, stdout, stderr)
    );
}

/**
 * Launch verification tasks
 */
async function grepCallback(fname:string, err: ExecFileException | null, stdout: string, _: string) {
    if (err) {
        vscode.window.showErrorMessage(err.message);
        return;
    }
    const specs = stdout.trim().replace("\n", "").split("--").slice(1)
    channel.show();
    channel.appendLine(`[${fname}] Model checking started...`);
    const title = `R-CHECK: Verification of ${fname}`
    let htmlReport =  `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
</head>
<body>
    <h1>${title}</h1>`
    
    let count = 0;
    await Promise
        .all(specs.map(async (element, index) => {
            const split = element.split("LTLSPEC").map((x) => x.trim());
            const x = await ic3(smvFile, index, split[1]);
            channel.appendLine(`[${fname}] ${++count}/${specs.length} done...`)

            htmlReport = htmlReport.concat(formatOutput(split[0], x));
        }))
        .then(() => channel.appendLine(`[${fname}] Done.`));
    const panel = vscode.window.createWebviewPanel(
        "verificationResults",
        "Verification Results",
        vscode.ViewColumn.One
    );
    panel.webview.html = htmlReport + "</body></html>";
}

function formatOutput(spec: string, out: string) {
    const isTrue = out.indexOf("is true") > -1
    const isFalse = out.indexOf("is false") > -1
    const emoji = isTrue ? "✅" : isFalse ? "❌" : "❔"

    const lines = out
        .split('\n')
        .filter((x) => !x.startsWith("***") && !x.startsWith("-- no proof or counterexample found"))
        .map((x) => x.trim())
        .filter((x) => x);
    return `<h2>${spec} ${emoji}</h2><pre>${lines.join("\n")}</pre>`;
}

/**
 * Verify an LTLSPEC property using IC3.
 * @param fname Name of the .smv file 
 * @param index Index of property being verified
 * @param spec The LTLSPEC being verified
 */
function ic3(fname: string, index: integer, spec: string, build_boolean_model: boolean=false) {
    // TODO If spec starts with G one can use check_property_as_invar_ic3
    const smvCommands = `
        set on_failure_script_quits 1
        go_msat
        ${build_boolean_model ? "build_boolean_model" : ""}
        check_ltlspec_ic3 -p "${spec}"
        quit`;
    const script = path.join(tmpDirName, `ltlspec-${index}.smv`);
    

    return new Promise<string>((resolve, reject) => {
        temp.addFile(script);
        writeFileSync(script, smvCommands);
        const child = execFile("nuxmv", ["-source", script, fname], async (err,stdout,stderr) => {
            temp.rmChild(fname, child);
            if (err) {
                if (err.message.indexOf("The boolean model must be built") > -1) {
                    // Retry with build_boolean_model
                    await ic3(fname, index, spec, true).then(resolve, reject);
                }
                else {
                    vscode.window.showErrorMessage(err.message);
                    reject(err.message);
                }
            } else {
                const stderrTrim = stderr.trim();
                if (stderrTrim && stderrTrim.indexOf("The boolean model must be built") > -1) {
                    // Retry with build_boolean_model
                    await ic3(fname, index, spec, true).then(resolve, reject);
                }
                else {
                    if (stderrTrim) { vscode.window.showWarningMessage(stderrTrim); }
                    resolve(stdout);
                }
            }
        });
        temp.addChild(fname, child);
    });
}