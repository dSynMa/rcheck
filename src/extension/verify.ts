import { execFile } from "child_process";
import * as path from 'node:path';
import * as vscode from "vscode";
import { Temp } from "./temp.js";
import { writeFileSync } from "node:fs";
import { integer } from "vscode-languageserver";
import { execPromise, ExecResult, getCurrentRcpFile, runJar, writePromise } from "./common.js";
import { parseToJson } from "../language/util.js";
import { formatStep, formatTransition, renderStep, Step } from "./cex.js";

let temp: Temp
let channel: vscode.OutputChannel
let tmpDirName: string

export class Verify {
    constructor(t: Temp, chan: vscode.OutputChannel) {
        channel = chan;
        temp = t;
    }

    /**
     * Register the command
     * @param context The ExtensionContext for our extension
     */
    Init(context: vscode.ExtensionContext): void {
        tmpDirName = temp.makeDir("rcheck-");
        context.subscriptions.push(
            vscode.commands.registerCommand('rcheck.verify', async () => {
                const rcpPath = getCurrentRcpFile()!;
                const parsed = await parseToJson(rcpPath);
                const tmpJson = path.join(tmpDirName, `${path.basename(rcpPath, ".rcp")}.json`);
                writeFileSync(tmpJson, parsed);
                temp.addFile(tmpJson);
                check()
                .then(() => runJar(["-j", tmpJson, "--smv", "-tmp"]))
                .then(findSpecs)
                .then(value => verifySpecs(rcpPath, tmpJson, value))
                .catch(vscode.window.showErrorMessage)
            })
        );
    }
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
async function verifySpecs(fname:string, json: string, v: [string, ExecResult]) {
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
    await Promise
        .all(specs.map(async (element, index) => {
            const split = element.split("LTLSPEC").map((x) => x.trim());
            const nuxmvOutput = await ic3(v[0], index, split[1]);
            channel.appendLine(`[${fname}] ${++count}/${specs.length} done...`)
            htmlReport = htmlReport.concat(await formatOutput(split[0], json, nuxmvOutput));
        }))
        .then(() => channel.appendLine(`[${fname}] Done.`));
    const panel = vscode.window.createWebviewPanel(
        "verificationResults",
        "Verification Results",
        vscode.ViewColumn.One
    );
    panel.webview.html = htmlReport + "</body></html>";
}

async function formatOutput(spec: string, json: string, out: string) {
    const isTrue = out.indexOf("is true") > -1
    const isFalse = out.indexOf("is false") > -1
    const emoji = isTrue ? "✅" : isFalse ? "❌" : "❔"
    let table = "";
    if (isFalse) {
        const cexFile = temp.makeFile("cex", ".txt");
        // TODO promisify this
        const tbody = await writePromise(cexFile, out)
            .then(() => runJar(["-j", json, "-cex", cexFile]))
            .then((v) => JSON.parse(v.stdout))
            .then((cex: Step[]) => cex.map(s => {
                    const tr = (
                        s.inboundTransition != undefined
                        ? `<tr><td></td><td>${formatTransition(s.inboundTransition)}</td></tr>`
                        : "")
                    return `${tr}<tr><td>${s.depth}</td><td>${formatStep(renderStep(cex, s))}</td></tr>`
                }))
            .then(s => s.join("\n"));
        table = `
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