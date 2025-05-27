import * as vscode from "vscode";
import { Temp } from "./temp.js";
import { getCurrentRcpFile, spawnJar } from "./common.js";
import { ChildProcess } from "node:child_process";
import axios from "axios";

let temp: Temp
let channel: vscode.OutputChannel
let ctx: vscode.ExtensionContext
let simulators: Map<string, SimulationPanel>

export class Simulate {
    constructor(t: Temp, chan: vscode.OutputChannel) {
        channel = chan;
        temp = t;
        simulators = new Map();
    }

    Init(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('rcheck.simulate', async () => {
                const rcpPath = getCurrentRcpFile()!;
                if (!simulators.has(rcpPath)) {
                    const newSim = new SimulationPanel(rcpPath);
                    simulators.set(rcpPath, newSim);
                }
                const sim = simulators.get(rcpPath);
                sim?.start();
            }));
        ctx = context;
    }
}


function getHtml(fname: string) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Simulator: ${fname}</title>
</head>
<body>
    <h1>R-CHECK simulator: ${fname}</h1>
    <button onclick="back()">Back</button>
    <button onclick="next()">Next</button>
    <script>
        const vscode = acquireVsCodeApi();
        function next() { vscode.postMessage({ command: 'next' }); }
        function back() { vscode.postMessage({ command: 'back' }); }
    </script>
</body>
</html>`
}

export class SimulationPanel {
    rcp: string
    panel: vscode.WebviewPanel | undefined
    server: ChildProcess | undefined
    port: number
    initialized: boolean = false


    constructor(rcpPath: string) {
        this.rcp = rcpPath
        this.port = 0
    }

    serverUrl() {
        return `http://localhost:${this.port}`
    }

    async start() {
        await this.initPanel();
        await this.reset();
    }

    async initPanel() {
        const jsonPath = await temp.toJson(this.rcp)
        channel.appendLine(jsonPath);
        if (this.server && !this.server.killed) this.killServer();
        this.server = spawnJar(["-j", jsonPath, "-a", "-p", "0"]);
        temp.addChild(`simulator: ${this.rcp}`, this.server);
        let stderrChunks: any[] = [];
        this.server.stderr?.on('data', (data) => {
            stderrChunks = stderrChunks.concat(data);
            if (data.indexOf("\n") > -1) {
                var stderrContent = Buffer.concat(stderrChunks).toString();
                channel.appendLine(`[DEBUG] ${stderrContent}`);
                if (this.port == 0 && stderrContent.indexOf("PORT:") > -1) {
                    this.port = +stderrContent.replace("PORT: ", "").trim();
                }
            }
        });

        channel.appendLine(`[DEBUG] Spawned simulation server (PID ${this.server.pid})`);
        this.panel = vscode.window.createWebviewPanel(
            "simulator",
            `R-CHECK simulator: ${this.rcp}`,
            vscode.ViewColumn.Active,
            {enableScripts: true}
        );
    }

    async reset() {
        this.initialized = false;
        if (this.panel !== undefined) {
            const html = getHtml(this.rcp);
            this.panel.webview.html = html;
            this.panel.onDidDispose(() => this.killServer());
            this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg), undefined, ctx.subscriptions);
        }
    }

    handleMessage(msg: any) {
        switch (msg.command) {
            case "back": this.back(); break;
            case "next": this.next(); break;
            case "reset": this.initialized = false; this.next(); break;
        }
    }

    async back() {
        channel.appendLine("back");
        const url = `${this.serverUrl()}/interpretBack`
        channel.appendLine(`[DEBUG] ${url}`);
        const x = await axios.get(url);
        channel.appendLine(`[DEBUG] ${x.status.toString()}`);
        channel.appendLine(`[DEBUG] ${JSON.stringify(x.data.state)}`);
    }

    async next() {
        channel.appendLine("next");
        const url = `${this.serverUrl()}/interpretNext?reset=${!this.initialized}`
        channel.appendLine(`[DEBUG] ${url}`);
        const x = await axios.get(url);
        channel.appendLine(`[DEBUG] ${x.status.toString()}`);
        channel.appendLine(`[DEBUG] ${JSON.stringify(x.data.state)}`);
        this.initialized = true;
    }
    
    async killServer() {
        const pid = this.server?.pid;
        if (this.server?.kill()) {
            channel.appendLine(`[DEBUG] Correctly terminated simulation server (PID ${pid})`);
        } else {
            channel.appendLine(`[ERROR] Error terminating simulation server (PID ${pid})`);
        }
    }
}