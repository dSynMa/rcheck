import * as vscode from "vscode";
import { join } from 'node:path';
import { execFile } from "child_process";
import { ExecFileException } from "node:child_process";

let jarPath: string;

export function getCurrentRcpFile() {
    const editor = vscode.window.visibleTextEditors.find((x) => x.document.fileName.endsWith("rcp"));
    const path = editor?.document.uri.fsPath
    return path;
}

export async function jarCallback(
    context: vscode.ExtensionContext,
    args: string[],
    guard: () => boolean, 
    then: (error: ExecFileException | null, stdout: string, stderr: string) => void) {
    if (!jarPath) {
        jarPath = context.asAbsolutePath(join('bin', 'rcheck-0.1.jar'));
    }
    if (!guard()) return;
    const args_ = ["-jar", jarPath].concat(args);
    execFile("java", args_, then);
}