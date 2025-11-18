import { execFile } from "child_process";
import * as vscode from "vscode";
import { Temp } from "./temp.js";
import { writeFileSync } from "node:fs";
import { integer } from "vscode-languageserver";
import { execPromise, ExecResult, getCurrentRcpFile, readPromise, runJar, writePromise } from "./common.js";
import { formatStep, formatTransition, renderStep, Step } from "./cex.js";

let temp: Temp
let channel: vscode.OutputChannel

export class Verify {
    constructor(t: Temp, chan: vscode.OutputChannel) {
        channel = chan;
        temp = t;
    }

    /**
     * Register the commands
     * @param context The ExtensionContext for our extension
     */
    Init(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('rcheck.verify-ic3', async () => {
                const rcpPath = getCurrentRcpFile()!;
                const tmpJson = await temp.toJson(rcpPath);
                check()
                .then(() => runJar(["-j", tmpJson, "--smv", "-tmp"]))
                .then(findSpecs)
                .then(value => verifySpecsIc3(rcpPath, tmpJson, value))
                .catch(vscode.window.showErrorMessage)
            }),
            vscode.commands.registerCommand('rcheck.verify-bmc', async () => {
                
                const rcpPath = getCurrentRcpFile()!;
                const tmpJson = await temp.toJson(rcpPath);
                const boundString = await vscode.window.showInputBox({
                    placeHolder: 'Enter BMC bound (default 20)',
                    validateInput: text => {
                        return text === '' || /^\d+$/.test(text) ? null : 'Please enter a valid integer';
                    }
                });
                const bound = boundString === '' ? 20 : parseInt(boundString!);
                check()
                .then(() => runJar(["-j", tmpJson, "--smv", "-tmp"]))
                .then(findSpecs)
                .then(value => verifySpecsBmc(rcpPath, tmpJson, bound, value))
                .catch(vscode.window.showErrorMessage)
            }),
            vscode.commands.registerCommand('rcheck.tosmv', async () => {
                const rcpPath = getCurrentRcpFile()!;
                temp.toJson(rcpPath)
                .then((tmpJson) => runJar(["-j", tmpJson, "--smv", "-tmp"]))
                .then(value => {
                    const smvFile = value.stderr.trim();
                    temp.addFile(smvFile);
                    return smvFile;
                })
                .then(readPromise)
                .then(showSmv)
                .catch(vscode.window.showErrorMessage);
            })
        );
    }
}

async function showSmv(content: string) {
    vscode.workspace.openTextDocument({
        "language": "nuxmv",
        "content": content
    })
    .then(doc => vscode.window.showTextDocument(doc));
}

async function check() {
    return new Promise<void>((resolve, reject) => {
        execFile("which", ["nuxmv"], (err, _) => {
            if (err) {reject("This command requires nuxmv.")}
            else resolve();
        });
    });
}

/**
 * Process SMV file
 */
async function findSpecs(value: ExecResult) {
    const smvFile = value.stderr.trim();
    temp.addFile(smvFile);
    return Promise.all([Promise.resolve(smvFile), execPromise("grep", ["-B", "1", "^LTLSPEC", smvFile])]);
}

/**
 * Launch verification tasks
 */
async function verifySpecsIc3(fname:string, json: string, v: [string, ExecResult]) {
    const specs = v[1].stdout.trim().replace("\n", "").split("--").slice(1)
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
    const html = await Promise
        .all(specs.map(async (element, index) => {
            const split = element.split("LTLSPEC").map((x) => x.trim());
            const nuxmvOutput = await ic3(v[0], index, split[1]);
            channel.appendLine(`[${fname}] ${++count}/${specs.length} done...`)
            return formatOutputIc3(split[0], json, nuxmvOutput);
        }))
        .then(outputs => {
            channel.appendLine(`[${fname}] Done.`);
            return `${htmlReport}${outputs.join("")}</body></html>`;
        });
    const panel = vscode.window.createWebviewPanel(
        "verificationResults",
        "Verification Results",
        vscode.ViewColumn.Active
    );
    panel.webview.html = html;
}

async function formatOutputIc3(spec: string, json: string, out: string) {
    const isTrue = out.indexOf("is true") > -1
    const isFalse = out.indexOf("is false") > -1
    const emoji = isTrue ? "✅" : isFalse ? "❌" : "❔"
    let table = "";
    if (isFalse) {
        const cexFile = temp.makeFile("cex", ".txt");
        // TODO promisify this
        const tbody = await writePromise(cexFile, out)
            .then(() => runJar(["-j", json, "-cex", cexFile]))
            .then(v => JSON.parse(v.stdout), channel.appendLine)
            .then((cex: Step[]) => cex.map(s => {
                    const tr = (
                        s.inboundTransition != undefined
                        ? `<tr><td></td><td>${formatTransition(s.inboundTransition)}</td></tr>`
                        : "")
                    const fmtLoop = s.___LOOP___ && !s.___DEADLOCK___ ? "<br /><em>Loop starts here</em>" : "";
                    const fmtDeadlock = s.___DEADLOCK___ ? "<br /><em>Deadlock state</em>" : "";
                    return `${tr}<tr><td>${s.depth}${fmtLoop}${fmtDeadlock}</td><td>${formatStep(renderStep(cex, s))}</td></tr>`
                }))
            .catch((e) => {
                channel.appendLine(e);
                return [];
            })
            .then(s => s.join("\n"));
        table = tbody === "" ? "" : `
<table striped bordered hover>
<thead>
<tr>
<th>#Step</th>
<th>Changed Variables</th>
</tr>
</thead>
<tbody>${tbody}</tbody></table>`
    }

    const lines = out
        .split('\n')
        .filter(x => !x.startsWith("***") && !x.startsWith("-- no proof or counterexample found"))
        .map(x => x.trim())
        .filter(x => x);
    return `<h2>${spec} ${emoji}</h2>
${table}
<details>
<summary>Full output</summary>
<pre>${lines.join("\n")}</pre>
</details>`;
}

/**
 * Verify an LTLSPEC property using IC3.
 * @param fname Name of the .smv file 
 * @param index Index of property being verified
 * @param spec The LTLSPEC being verified
 */
function ic3(fname: string, index: integer, spec: string, build_boolean_model: boolean=false) {
    // TODO If spec starts with G one can use check_property_as_invar_ic3
    // TODO add optional ic3 bound limit in extension settings
    const smvCommands = `
        set on_failure_script_quits 1
        go_msat
        ${build_boolean_model ? "build_boolean_model" : ""}
        check_ltlspec_ic3 -p "${spec}"
        quit`;
    const script = temp.makeFile(`ltlspec-${index}`, ".smv");

    return new Promise<string>((resolve, reject) => {
        writeFileSync(script, smvCommands);
        const child = execFile("nuxmv", ["-source", script, fname], async (err,stdout,stderr) => {
            temp.rmChild(fname, child);
            temp.rm(script);
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

/**
 * Launch BMC verification tasks
 */
async function verifySpecsBmc(fname:string, json: string, bound: integer, v: [string, ExecResult]) {
    const specs = v[1].stdout.trim().replace("\n", "").split("--").slice(1)
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
    const html = await Promise
        .all(specs.map(async (element, index) => {
            const split = element.split("LTLSPEC").map((x) => x.trim());
            const nuxmvOutput = await bmc(v[0], index, bound, split[1]);
            channel.appendLine(`[${fname}] ${++count}/${specs.length} done...`);
            return formatOutputIc3(split[0], json, nuxmvOutput);
        }))
        .then(outputs => {
            channel.appendLine(`[${fname}] Done.`);
            return `${htmlReport}${outputs.join("")}</body></html>`;
        });
    const panel = vscode.window.createWebviewPanel(
        "verificationResults",
        "Verification Results",
        vscode.ViewColumn.Active
    );
    panel.webview.html = html;
}


/**
 * Verify an LTLSPEC property using BMC.
 * @param fname Name of the .smv file 
 * @param index Index of property being verified
 * @param bound The BMC bound
 * @param spec The LTLSPEC being verified
 */
function bmc(fname: string, index: integer, bound: integer, spec: string) {
    const smvCommands = `
        set on_failure_script_quits 1
        go_msat
        build_boolean_model
        bmc_setup
        check_ltlspec_bmc -k ${bound} -p "${spec}"
        quit`;
    const script = temp.makeFile(`ltspec-${index}`, ".smv");

    return new Promise<string>((resolve, reject) => {
        writeFileSync(script, smvCommands);
        const child = execFile("nuxmv", ["-source", script, fname], async (err,stdout,stderr) => {
        temp.rmChild(fname, child);
        temp.rm(script);
        if (err) {
            vscode.window.showErrorMessage(err.message);
            reject(err.message);
        } else {
            resolve(stdout);
        }
        });
        temp.addChild(fname, child);
    });
}