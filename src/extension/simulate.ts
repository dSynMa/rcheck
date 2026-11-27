import * as vscode from "vscode";
import { Temp } from "./temp.js";
import { getCurrentRcpFile, renderTemplate, spawnJar } from "./common.js";
import { ChildProcess } from "node:child_process";
import axios from "axios";
import { Step } from "./cex.js";

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
            vscode.commands.registerCommand('rcheck.simulate', async (seed?: { rcpPath: string; trace: Step[] }) => {
                const rcpPath = seed?.rcpPath ?? getCurrentRcpFile()!;
                if (!simulators.has(rcpPath)) {
                    const newSim = new SimulationPanel(rcpPath);
                    simulators.set(rcpPath, newSim);
                }
                const sim = simulators.get(rcpPath);
                await sim?.start(seed?.trace);
            }));
        ctx = context;
    }
}

export class SimulationPanel {
    rcp: string
    panel: vscode.WebviewPanel | undefined
    server: ChildProcess | undefined
    port: number
    initialized: boolean = false
    private ready: boolean = false
    private portWaiters: Array<(port: number) => void> = []
    private readyWaiters: Array<() => void> = []


    constructor(rcpPath: string) {
        this.rcp = rcpPath
        this.port = 0
    }

    serverUrl() {
        return `http://localhost:${this.port}`
    }

    async start(trace?: Step[]) {
        await this.initPanel();
        await this.reset();
        if (trace) {
            await this.waitForReady();
            await this.loadTrace(trace);
        }
    }

    private waitForReady(): Promise<void> {
        if (this.ready) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("Simulator webview did not become ready")),
                10000
            );
            this.readyWaiters.push(() => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    private waitForPort(): Promise<number> {
        if (this.port > 0) return Promise.resolve(this.port);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("Simulation server did not report a port")),
                10000
            );
            this.portWaiters.push((port) => {
                clearTimeout(timer);
                resolve(port);
            });
        });
    }

    async initPanel() {
        const jsonPath = await temp.toJson(this.rcp)
        channel.appendLine(jsonPath);
        if (this.server && !this.server.killed) this.killServer();
        this.port = 0;
        this.server = spawnJar(["-j", jsonPath, "-a", "-p", "0"]);
        temp.addChild(`simulator: ${this.rcp}`, this.server);
        let stderrChunks: any[] = [];
        this.server.stderr?.on('data', (data) => {
            stderrChunks = stderrChunks.concat(data);
            if (data.indexOf("\n") > -1) {
                var stderrContent = Buffer.concat(stderrChunks).toString();
                // channel.appendLine(`[DEBUG] ${stderrContent}`);
                if (this.port == 0 && stderrContent.indexOf("PORT:") > -1) {
                    this.port = +stderrContent.replace("PORT: ", "").trim();
                    channel.appendLine(`[DEBUG] PORT: ${stderrContent}`);
                    this.portWaiters.splice(0).forEach((resolve) => resolve(this.port));
                }
            }
        });

        channel.appendLine(`[DEBUG] Spawned simulation server (PID ${this.server.pid})`);
        this.panel = vscode.window.createWebviewPanel(
            "simulator",
            `R-CHECK simulator: ${this.rcp}`,
            vscode.ViewColumn.Active,
            // TODO persist state with getState/setState instead
            {enableScripts: true, retainContextWhenHidden: true}
        );
    }

    async loadTrace(trace: Step[]) {
        try {
            const port = await this.waitForPort();
            const url = `http://localhost:${port}/interpretLoadJSON`;
            channel.appendLine(`[DEBUG] loading replay with ${trace.length} steps`);
            const response = await axios.post(url, trace, {
                headers: { "Content-Type": "application/json" },
                maxBodyLength: Infinity
            });
            if (response.data.hasOwnProperty("error")) {
                vscode.window.showErrorMessage(response.data.error);
                return;
            }
            this.initialized = true;
            this.panel?.webview.postMessage({ command: 'load-trace', content: response.data });
        } catch (error: any) {
            vscode.window.showErrorMessage(error?.message ?? String(error));
        }
    }

    async reset() {
        this.initialized = false;
        this.ready = false;
        if (this.panel !== undefined) {
            this.panel.onDidDispose(() => this.killServer());
            this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg), undefined, ctx.subscriptions);
            this.panel.webview.html = await renderTemplate(ctx, "simulate.html", {fname: this.rcp}, this.panel.webview);
        }
    }


    handleMessage(msg: any) {
        switch (msg.command) {
            case "ready":
                this.ready = true;
                this.readyWaiters.splice(0).forEach((resolve) => resolve());
                break;
            case "back": this.back(); break;
            case "next": this.next(msg); break;
            // case "reset": this.initialized = false; this.next("0"); break;
        }
    }

    async back() {
        channel.appendLine("back");
        const url = `${this.serverUrl()}/interpretBack`
        channel.appendLine(`[DEBUG] ${url}`);
        const response = await axios.get(url);
        channel.appendLine(`[DEBUG] ${response.status}`);
        channel.appendLine(`[DEBUG] ${JSON.stringify(response.data.state)}`);
        if (response.data.hasOwnProperty("error")) {
            vscode.window.showErrorMessage(response.data.error);
        } else {
            this.panel?.webview.postMessage({ command: 'undo-step', content: response.data });
            this.panel?.webview.postMessage({ command: 'update-transitions', content: response.data.transitions });
            this.initialized = true;
        }
    }

    async next(msg: any) {
        channel.appendLine("next");
        let url = `${this.serverUrl()}/interpretNext?reset=${!this.initialized}`;
        if (msg.data) { url = `${url}&index=${msg.data}`; }
        channel.appendLine(`[DEBUG] ${url}`);
        const response = await axios.get(url);
        channel.appendLine(`[DEBUG] ${response.status}`);
        channel.appendLine(`[DEBUG] ${JSON.stringify(response.data)}`);
        if (response.data.hasOwnProperty("error")) {
            vscode.window.showErrorMessage(response.data.error);
        } else {
            this.panel?.webview.postMessage({ command: 'append-step', content: response.data });
            this.panel?.webview.postMessage({ command: 'update-transitions', content: response.data.transitions });
            this.initialized = true;
        }
    }
    
    async killServer() {
        const pid = this.server?.pid;
        if (this.server?.kill()) {
            channel.appendLine(`[DEBUG] Correctly terminated simulation server (PID ${pid})`);
        } else {
            channel.appendLine(`[ERROR] Error terminating simulation server (PID ${pid})`);
        }
        this.port = 0;
    }
}