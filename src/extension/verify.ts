import { execFile } from "child_process";
import * as vscode from "vscode";
import { Temp } from "./temp.js";
import { writeFileSync } from "node:fs";
import { integer } from "vscode-languageserver";
import { execPromise, ExecResult, getCurrentRcpFile, readPromise, renderTemplate, runJar, writePromise } from "./common.js";
import { renderStep, Step } from "./cex.js";

let temp: Temp
let channel: vscode.OutputChannel
let ctx: vscode.ExtensionContext
let panel: vscode.WebviewPanel

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
        ctx = context;
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
            if (err) { reject("This command requires nuxmv.") }
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

async function verifySpecsIc3(fname: string, json: string, v: [string, ExecResult]) {
    verifySpecs(fname, json, ic3, v, "IC3");
}

/**
 * Launch verification tasks
 */
async function verifySpecs(fname: string, json: string, fn: Function, v: [string, ExecResult], subtitle: string) {
    panel = vscode.window.createWebviewPanel(
        "verificationResults",
        "Verification Results",
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
    );
    const tmpHtml = await renderTemplate(
        ctx, "verify.html", {
        fname: fname,
        subtitle: subtitle,
        body: undefined
    },
        panel.webview);
    panel.webview.html = tmpHtml;

    const specs = v[1].stdout.trim().replace("\n", "").split("--").slice(1)
    channel.show();
    channel.appendLine(`[${fname}] Model checking started...`);

    let count = 0;
    const body = await Promise
        .all(specs.map(async (element, index) => {
            const split = element.split("LTLSPEC").map((x) => x.trim());
            const nuxmvOutput = await fn(v[0], index, split[1]);
            channel.appendLine(`[${fname}] ${++count}/${specs.length} done...`)
            return formatNuXmvOutput(split[0], json, nuxmvOutput);
        }))
        .then(outputs => {
            channel.appendLine(`[${fname}] Done.`);
            return outputs.join("");
        });
    panel.webview.html = await renderTemplate(
        ctx, "verify.html", {
        fname: fname,
        subtitle: subtitle,
        body: body
    },
        panel.webview);
}

async function formatNuXmvOutput(spec: string, json: string, out: string) {
    const isTrue = out.indexOf("is true") > -1;
    const isFalse = out.indexOf("is false") > -1;

    const lines = out
        .split('\n')
        .filter(x => !x.startsWith("***") && !x.startsWith("-- no proof or counterexample found"))
        .map(x => x.trim())
        .filter(x => x);

    let table = "";
    if (isFalse) {
        const cexFile = temp.makeFile("cex", ".txt");
        // TODO promisify this
        table = await writePromise(cexFile, out)
            .then(() => runJar(["-j", json, "-cex", cexFile]))
            .then(v => JSON.parse(v.stdout), channel.appendLine)
            .then((cex: Step[]) => cex.map(async s => {
                const render = await renderTemplate(
                    ctx, "_step.html",
                    {
                        deadlock: s.___DEADLOCK___,
                        depth: s.depth,
                        isSupplyGet: s.inboundTransition?.hasOwnProperty("___get-supply___"),
                        loop: s.___LOOP___ && !s.___DEADLOCK___,
                        step: renderStep(cex, s),
                        transition: s.inboundTransition
                    },
                    panel.webview);
                return render;
            }))
            .then(outputs => Promise.all(outputs))
            .catch((e) => {
                channel.appendLine(e);
                return [];
            })
            .then(s => s.join("\n"));
    }
    const render = await renderTemplate(
        ctx, "_verify.single.html",
        {
            tbody: table,
            spec: spec,
            isTrue: isTrue,
            isFalse: isFalse,
            output: lines.join("\n")
        }, panel.webview);
    return render;
}

/**
 * Verify an LTLSPEC property using IC3.
 * @param fname Name of the .smv file 
 * @param index Index of property being verified
 * @param spec The LTLSPEC being verified
 */
function ic3(fname: string, index: integer, spec: string, build_boolean_model: boolean = false) {
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
        const child = execFile("nuxmv", ["-source", script, fname], async (err, stdout, stderr) => {
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
 * Verify an LTLSPEC property using BMC.
 * @param fname Name of the .smv file 
 * @param index Index of property being verified
 * @param bound The BMC bound
 * @param spec The LTLSPEC being verified
 */
async function verifySpecsBmc(fname: string, json: string, bound: integer, v: [string, ExecResult]) {
    const bmcFn = makeBmcFn(bound);
    verifySpecs(fname, json, bmcFn, v, `BMC (bound: ${bound})`);
}


function makeBmcFn(bound: integer) {
    return function (fname: string, index: integer, spec: string) {
        const smvCommands = `
            set on_failure_script_quits 1
            go_msat
            build_boolean_model
            bmc_setup
            msat_check_ltlspec_bmc -k ${bound} -p "${spec}"
            quit`;
        const script = temp.makeFile(`ltspec-${index}`, ".smv");

        return new Promise<string>((resolve, reject) => {
            writeFileSync(script, smvCommands);
            const child = execFile("nuxmv", ["-source", script, fname], async (err, stdout, stderr) => {
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
}
