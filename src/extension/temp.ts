import { ChildProcess } from "child_process";
import { mkdtempSync, rmdir, unlink } from "fs";
import { tmpdir } from "os";
import path from "path";
import { Disposable } from "vscode";

/**
 * Simple tracker of temporary files/directories/processes, which
 * will be deleted/killed when the object is disposed. This, in turn,
 * should happen automatically when the extension deactivates (e.g., when
 * VSCode closes normally).
 */
export class Temp implements Disposable {
    tmpFiles: Set<string>;
    tmpDirs: Set<string>;
    children: Map<string, ChildProcess[]>;
    
    constructor() {
        this.tmpFiles = new Set<string>();
        this.tmpDirs = new Set<string>();
        this.children = new Map<string, ChildProcess[]>();
    }

    addFile(fileName: string) { this.tmpFiles.add(fileName); }
    addDir(dirName: string) { this.tmpDirs.add(dirName); }
    makeDir(prefix: string) {
        const newDir = mkdtempSync(path.join(tmpdir(), prefix));
        this.addDir(newDir);
        return newDir;
    }

    makeFile(prefix: string, suffix:string="") {
        const dir = this.makeDir(prefix);
        const file = path.resolve(path.join(dir, `file${suffix}`));
        this.addDir(dir);
        this.addFile(file);
        
        return file;
    }

    /**
     * Register a child process under `name`.
     * @param name A name that will be used to retrieve `child` later.
     * @param child A `ChildProcess`.
     */
    addChild(name: string, child: ChildProcess){
        const children = this.children.get(name) || [];
        children.push(child);
        this.children.set(name, children);
    }

    /** 
     * Stop tracking a (terminated) child process.
     * If the process is still running, this method does nothing.
     * @param name Name under which child is registered
     * @param child The (terminated) child process
     */
    rmChild(name: string, child: ChildProcess) {
        const children = this.children.get(name);
        // Only go ahead if child a) may be registered under name and 
        // b) has terminated
        if (children && child.exitCode != null){
            const index = children?.findIndex((c) => c.pid == child.pid);
            if (index > -1){
                this.children.set(name, children.splice(index, 1));
            }
        }
    }
    
    /**
     * Kill all children processes registered under `name`.
     * @param name The name under which the processes are registered.
     */
    cancel(name: string) {
        const children = this.children.get(name) || [];
        children.forEach((child) => child.kill());
        children.forEach((child) => this.rmChild(name, child));
        if (this.children.get(name)?.length == 0) {
            this.children.delete(name);
        }
    }

    async rm(fname: string) {
        if (this.tmpFiles.has(fname)) {
            unlink(fname, () => {});
            this.tmpFiles.delete(fname);
        }
    }

    async rmDir(dirname: string) {
        if (this.tmpDirs.has(dirname)) {
            rmdir(dirname, () => {});
            this.tmpDirs.delete(dirname);
        }
    }

    dispose() {
        const awaits: any[] = [];
        this.tmpFiles.forEach(f => awaits.push(this.rm(f)));
        (async () => await Promise.allSettled(awaits));

        this.tmpDirs.forEach(d => awaits.push(this.rmDir(d)));
        (async () => await Promise.allSettled(awaits));

        this.children.forEach((_: ChildProcess[], name: string) => this.cancel(name));

    }
}