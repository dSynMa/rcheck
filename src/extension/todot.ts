import { execFile } from "child_process";
import * as path from 'node:path';
import * as vscode from "vscode";
import { Temp } from "./temp.js";
import { ExecResult, getCurrentRcpFile, readPromise, runJar } from "./common.js";

let temp: Temp
let hasgv: boolean
let channel: vscode.OutputChannel
const graphvizInteractiveExtensionId = "efanzh.graphviz-preview";
const graphvizInteractiveCmdName = "graphviz.showPreviewToSide";

/**
 * Implements the `rcheck.todot` command
 * (Generate/show DOT transition systems for all agents)
 */
export class ToDot {
    constructor(t: Temp, ch: vscode.OutputChannel) {
        temp = t;
        channel = ch;
        hasgv = vscode.extensions.all.some((x) => x.id.includes(graphvizInteractiveExtensionId));
    }

    /**
     * Register the command
     * @param context The ExtensionContext for our extension
     */
    Init(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('rcheck.todot', async () => {
                const rcpPath = getCurrentRcpFile()!;
                temp.toJson(rcpPath)
                .then((tmpJson) => runJar(["-j", tmpJson, "--dot", "-tmp"]))
                .then(dotCallback)
                .catch(vscode.window.showErrorMessage)
            })
        );
    }
}


function dotCallback(value: ExecResult) {
    // Get names of .dot files
    const dotfiles = value.stderr.split('\n').map((f) => f.trim()).filter((f) => f != '');

    dotfiles.forEach(async (f) => {
        temp.addFile(f);
        temp.addDir(path.basename(path.dirname(f)));
        const fUri = vscode.Uri.file(f);
        if (hasgv) {
            // Use the extension to render the dot file
            vscode.commands.executeCommand(graphvizInteractiveCmdName, {uri: fUri});
        }
        else {
            // Turn the .dot file into pdf
            execFile("dot", ["-O", "-Tpdf", f], (err, _, __) => {
                if (err){
                    readPromise(f).then((contents) => {
                        channel.appendLine(`[ERROR] Error rendering ${f}:`);
                        channel.appendLine(`[ERROR] ${err.message}`);
                        channel.appendLine(`[ERROR] Contents of ${f}:`);
                        channel.appendLine(`[ERROR] ${contents}`);
                    });
                } else {
                    // Open the pdfs in side views
                    const pdfUri = vscode.Uri.file(`${f}.pdf`)
                    vscode.commands.executeCommand('vscode.open', pdfUri, vscode.ViewColumn.Beside);
                    temp.addFile(pdfUri.fsPath);
                }
            });
        }
    });
}
