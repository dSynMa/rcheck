import { describe, expect, test, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { parseSpecs } from "../../src/extension/verify.js";

describe("Verification spec parsing", () => {
    test("pairs original specs with translated formulas", () => {
        const output = [
            "--G (a -> F b)",
            "LTLSPEC G((a) -> (F(b)))",
            "--X false",
            "LTLSPEC X(FALSE)"
        ].join("\n");

        expect(parseSpecs(output)).toEqual([
            { display: "G (a -> F b)", formula: "G((a) -> (F(b)))" },
            { display: "X false", formula: "X(FALSE)" }
        ]);
    });

    test("falls back to the translated formula without a comment", () => {
        const output = [
            "\t(transition) | keep",
            "LTLSPEC X(FALSE)",
            "--",
            "LTLSPEC G(a)"
        ].join("\n");

        expect(parseSpecs(output)).toEqual([
            { display: "X(FALSE)", formula: "X(FALSE)" },
            { display: "G(a)", formula: "G(a)" }
        ]);
    });

    test("returns no specs for empty output", () => {
        expect(parseSpecs("")).toEqual([]);
    });
});
