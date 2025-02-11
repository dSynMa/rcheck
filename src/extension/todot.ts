import { execFile, ExecFileException } from "child_process";
import * as path from 'node:path';
import { promisify } from "node:util";
import * as vscode from "vscode";
import { Temp } from "./temp.js";
import { jarCallback } from "./common.js";

let temp: Temp
let hasgv: boolean 
let hasdot: boolean
const execPromise = promisify(execFile);
const graphvizInteractiveExtensionId = "tintinweb.graphviz-interactive-preview";
const graphvizInteractiveCmdName = "graphviz-interactive-preview.preview.beside";

/**
 * Implements the `rcheck.todot` command
 * (Generate/show DOT transition systems for all agents)
 */
export class ToDot {
    constructor(context: vscode.ExtensionContext, t: Temp) {
        temp = t
        hasgv = vscode.extensions.all.some((x) => x.id.includes(graphvizInteractiveExtensionId));
        hasdot = false;
        if (!hasgv) {
            // Check whether dot is installed
            (async () => await execPromise("dot", ["--version"]).then(() => hasdot = true, (err) => hasdot = false))();
        }
    }

    /**
     * Register the command
     * @param context The ExtensionContext for our extension
     */
    Init(context: vscode.ExtensionContext): void {
        const args = ["--dot", "-tmp"]
        context.subscriptions.push(
            vscode.commands.registerCommand('rcheck.todot', () => jarCallback(context, args, check, dotCallback))
        );
    }
}

function check() {
    if (!hasgv && !hasdot) {
        vscode.window.showErrorMessage(
            "This command requires either the GraphViz Interactive Preview extension or the Graphviz package.");
    }
    return hasgv || hasdot;
}

function dotCallback(err: ExecFileException | null, _: string, stderr: string) {
    if (err) {
        vscode.window.showErrorMessage("!!");
        vscode.window.showErrorMessage(err.message);
        return;
    }
    // Get names of .dot files
    const dotfiles = stderr.split('\n').map((f) => f.trim()).filter((f) => f != '');

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
