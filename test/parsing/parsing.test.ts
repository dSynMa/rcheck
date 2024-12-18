import { readFile } from "fs/promises";
import { EmptyFileSystem, type LangiumDocument } from "langium";
import { expandToString as s } from "langium/generate";
import { parseHelper } from "langium/test";
import { beforeAll, describe, expect, test } from "vitest";
import type { Diagnostic } from "vscode-languageserver-types";
import { Model, isModel } from "../../src/language/generated/ast.js";
import { createRCheckServices } from "../../src/language/r-check-module.js";

let services: ReturnType<typeof createRCheckServices>;
let parse:    ReturnType<typeof parseHelper<Model>>;
let document: LangiumDocument<Model> | undefined;

beforeAll(async () => {
    services = createRCheckServices(EmptyFileSystem);
    const doParse = parseHelper<Model>(services.RCheck);
    parse = (input: string) => doParse(input, { validation: false });

    // activate the following if your linking test requires elements from a built-in library, for example
    // await services.shared.workspace.WorkspaceManager.initializeWorkspace([]);
});

describe('Parsing tests', () => {
    test('bigger-example', async () => testCorrectFile(`${__dirname}/../../examples/bigger-example.rcp`));
    test('bigger-example-3', async () => testCorrectFile(`${__dirname}/../../examples/bigger-example-3.rcp`));
    test('duplicates', async () => testCorrectFile(`${__dirname}/../../examples/errors/duplicates.rcp`));
    test('ltol-in-expr', async () => testCorrectFile(`${__dirname}/../../examples/errors/ltol-in-expr.rcp`));

// test('parse simple model', async () => {
//     document = await parse(`
//             person Langium
//             Hello Langium!
//         `);

//     // check for absensce of parser errors the classic way:
//     //  deacivated, find a much more human readable way below!
//     // expect(document.parseResult.parserErrors).toHaveLength(0);

//     expect(
//         // here we use a (tagged) template expression to create a human readable representation
//         //  of the AST part we are interested in and that is to be compared to our expectation;
//         // prior to the tagged template expression we check for validity of the parsed document object
//         //  by means of the reusable function 'checkDocumentValid()' to sort out (critical) typos first;
//         checkDocumentValid(document) || s`
//                 Persons:
//                   ${document.parseResult.value?.persons?.map(p => p.name)?.join('\n  ')}
//                 Greetings to:
//                   ${document.parseResult.value?.greetings?.map(g => g.person.$refText)?.join('\n  ')}
//             `
//     ).toBe(s`
//             Persons:
//               Langium
//             Greetings to:
//               Langium
//         `);
// });
});

async function testCorrectFile(fileName: string) {
    const biggerExample = await readFile(fileName, "utf8")
        document = await parse(biggerExample);
        expect(document.parseResult.parserErrors).toHaveLength(0);
}

function checkDocumentValid(document: LangiumDocument): string | undefined {
    return document.parseResult.parserErrors.length && s`
        Parser errors:
          ${document.parseResult.parserErrors.map(e => e.message).join('\n  ')}
    `
        || document.parseResult.value === undefined && `ParseResult is 'undefined'.`
        || !isModel(document.parseResult.value) && `Root AST object is a ${document.parseResult.value.$type}, expected a '${Model}'.`
        || undefined;
}

function diagnosticToString(d: Diagnostic) {
    return `[${d.range.start.line}:${d.range.start.character}..${d.range.end.line}:${d.range.end.character}]: ${d.message}`;
}