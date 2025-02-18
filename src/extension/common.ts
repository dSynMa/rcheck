import * as vscode from "vscode";
import { join } from 'node:path';
import { execFile } from "child_process";
import { promisify } from "node:util";

let jarPath: string;
let context: vscode.ExtensionContext;

export const execPromise = promisify(execFile);
export type ExecResult = {
    stdout: string,
    stderr: string
}

export function Init(c: vscode.ExtensionContext) {
    context = c
    jarPath = context.asAbsolutePath(join('bin', 'rcheck-0.1.jar'));
}

export function getCurrentRcpFile() {
    const editor = vscode.window.visibleTextEditors.find((x) => x.document.fileName.endsWith("rcp"));
    const path = editor?.document.uri.fsPath
    return path;
}

export async function runJar(args: string[]) {
    const args_ = ["-jar", jarPath].concat(args);
    return execPromise("java", args_);
}
