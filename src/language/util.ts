import { NodeFileSystem } from "langium/node";
import { extractAstNode } from "../cli/cli-util.js";
import { Model } from "./generated/ast.js";
import { createRCheckServices } from "./r-check-module.js";

export async function parseToJson(fileName: string) {
    const services = createRCheckServices(NodeFileSystem).RCheck;
    const model = await extractAstNode<Model>(fileName, services);
    return JSON.stringify(model, getAstReplacer());
}

export function parseToJsonSync(fileName: string) { 
    let result = "";
    (async () => await parseToJson(fileName).then((x) => result = x))();
    return result;
}

const getAstReplacer = () => {
    /**
     * Used with JSON.stringify() to make a JSON of a Langium AST.
     */

    // Extra measure to remove circular references. See
    // https://stackoverflow.com/a/53731154
    const seen = new WeakSet();
    return (key: any, value: any) => {
        // Remove Langium nodes that we won't need
        if (
            key === "references" || key === "$cstNode" || key === "$refNode" ||
            key === "_ref" || key === "ref"
            ||
            key === "$nodeDescription" || key === "_nodeDescription") {
            return;
        }
        // Remove seen nodes
        if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }
        return value;
    };
};
