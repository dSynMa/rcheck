import { execFile, ExecFileException } from "child_process";
import * as path from 'node:path';
import { promisify } from "node:util";
import * as vscode from "vscode";
import { Temp } from "./temp.js";

let temp: Temp
let jarPath: string
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
        jarPath = context.asAbsolutePath(path.join('bin', 'rcheck-0.1.jar'));
        temp = t
        // check whether the graphviz interactive extension is installed/enabled
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
        context.subscriptions.push(
            vscode.commands.registerCommand('rcheck.todot', callback)
        );
    }
}

async function callback() {
    if (!hasgv && !hasdot) {
        vscode.window.showErrorMessage(
            "This command requires either the GraphViz Interactive Preview extension or the Graphviz package.");
            return;
    }
    const args = ["-jar", jarPath, "-i", vscode.window.activeTextEditor?.document.fileName!, "--dot", "-tmp"]
    execFile("java", args, dotCallback);
};


function dotCallback(err: ExecFileException | null, _: string, stderr: string) {
    if (err) {
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
