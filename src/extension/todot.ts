import { execFile } from "child_process";
import * as path from 'node:path';
import * as vscode from "vscode";
import { Temp } from "./temp.js";
import { execPromise, ExecResult, getCurrentRcpFile, runJar } from "./common.js";

let temp: Temp
let hasgv: boolean
const graphvizInteractiveExtensionId = "tintinweb.graphviz-interactive-preview";
const graphvizInteractiveCmdName = "graphviz-interactive-preview.preview.beside";

/**
 * Implements the `rcheck.todot` command
 * (Generate/show DOT transition systems for all agents)
 */
export class ToDot {
    constructor(t: Temp) {
        temp = t;
        hasgv = vscode.extensions.all.some((x) => x.id.includes(graphvizInteractiveExtensionId));
    }

    /**
     * Register the command
     * @param context The ExtensionContext for our extension
     */
    Init(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('rcheck.todot', async () => {
                const path = getCurrentRcpFile()!.toString();
                check()
                .then(() => runJar(["-i", path, "--dot", "-tmp"]))
                .then(dotCallback)
                .catch(vscode.window.showErrorMessage)
            })
        );
    }
}

async function check() {
    if (hasgv) {
        return Promise.resolve();
    }
    return execPromise("dot", ["--version"]).then(
        (_) => Promise.resolve(),
        (__) => Promise.reject("This command requires either the GraphViz Interactive Preview extension or the Graphviz package."))
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
                // Open the pdfs in side views
                const pdfUri = vscode.Uri.file(`${f}.pdf`)
                vscode.commands.executeCommand('vscode.open', pdfUri, vscode.ViewColumn.Beside);
                temp.addFile(pdfUri.fsPath);
            });
        }
    });
}
