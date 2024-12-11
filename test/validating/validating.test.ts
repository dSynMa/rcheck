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
    parse = (input: string) => doParse(input, { validation: true });

    // activate the following if your linking test requires elements from a built-in library, for example
    // await services.shared.workspace.WorkspaceManager.initializeWorkspace([]);
});

describe('Validating', () => {
  
    test('bigger-example', async () => {
        const biggerExample = await readFile(`${__dirname}/../../examples/bigger-example.rcp`, "utf8")
        document = await parse(biggerExample);

        expect(
            // here we first check for validity of the parsed document object by means of the reusable function
            //  'checkDocumentValid()' to sort out (critical) typos first,
            // and then evaluate the diagnostics by converting them into human readable strings;
            // note that 'toHaveLength()' works for arrays and strings alike ;-)
            checkDocumentValid(document) || document?.diagnostics?.map(diagnosticToString)?.join('\n')
        ).toHaveLength(0);
    });

    // test('check capital letter validation', async () => {
    //     document = await parse(`
    //         person langium
    //     `);

    //     expect(
    //         checkDocumentValid(document) || document?.diagnostics?.map(diagnosticToString)?.join('\n')
    //     ).toEqual(
    //         // 'expect.stringContaining()' makes our test robust against future additions of further validation rules
    //         expect.stringContaining(s`
    //             [1:19..1:26]: Person name should start with a capital.
    //         `)
    //     );
    // });
});

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
