import { ChildProcess } from "child_process";
import { rmdir, unlink } from "fs";
import { Disposable } from "vscode";

/**
 * Simple tracker of temporary files/directories, which
 * will be deleted when the object is disposed.
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

    addChild(name: string, child: ChildProcess){
        const children = this.children.get(name) || [];
        children.push(child);
        this.children.set(name, children);
    }
    
    cancel(name: string) {
        const children = this.children.get(name) || [];
        children.forEach((child) => child.kill());
        this.children.delete(name);
    }

    dispose() {
        const awaits: any[] = [];
        this.tmpFiles.forEach(f => {
            awaits.push(unlink(f, (_) => { }))
        });
        (async () => await Promise.allSettled(awaits));

        this.tmpDirs.forEach((d) => {
            awaits.push(rmdir(d, (_) => { }));
        });
        (async () => await Promise.allSettled(awaits));

        this.children.forEach((_: ChildProcess[], name: string) => this.cancel(name));

    }
}