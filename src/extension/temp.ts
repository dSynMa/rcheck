import { rmdir, unlink } from "fs";
import { Disposable } from "vscode";

/**
 * Simple tracker of temporary files/directory, which
 * will be deleted when the object is disposed.
 */
export class Temp implements Disposable {
    tmpFiles: Set<string>;
    tmpDirs: Set<string>;

    constructor() {
        this.tmpFiles = new Set<string>();
        this.tmpDirs = new Set<string>();
    }

    addFile(fileName: string) { this.tmpFiles.add(fileName); }
    addDir(dirName: string) { this.tmpDirs.add(dirName); }

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
    }
}