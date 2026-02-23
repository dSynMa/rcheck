console.log("Fixing syntax hihglighting...")

const fs = require('fs');
const path = require('path');

const jsonpath = path.join(__dirname, "syntaxes", "r-check.tmLanguage.json");

fs.readFile(jsonpath, 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading file:', err);
        return;
    }
    const jsonData = JSON.parse(data);
    let oldPatterns = [];
    jsonData.patterns.forEach(element => {
        const match = (element.match ?? "")
            .split("|")
            .map(s => s.trim()
                .replace(/\\b/g, "").replace(/\\B/g, "")
                .replace("(", "").replace(")", ""))
            .filter(s => s.length > 0);
        oldPatterns.push(...match);
    });
    // const oldPatterns = jsonData.patterns;
    console.log("Old patterns:", oldPatterns);


    jsonData.patterns = [
        {
            include: "#comments"
        },
        {
            name: "keyword.control.r-check",
            match: "\\b(SPEC|enum|channels|property-variables|exists|false|forall|guard|init|local|message-structure|receive-guard|relabel|rep|repeat|system)\\b|\\B(-automaton-state)\\b|\\b(GET@|SUPPLY@)\\B"
        },
        {  
            match: "\\b(agent)\\b\\s+([^\\s]+)",
            captures: {
                1: { name: "keyword.other.agent.r-check" },
                2: { name: "entity.name.agent.r-check" }
            }
        },
        {
            name: "keyword.operator.r-check",
            match: "\\b(F|G|R|U|W|X|exists|forall)\\b"
        },
        {
            name: "constant.language.r-check",
            match: "\\b(false|true|any)\\b"
        },
        {
            name: "constant.numeric.r-check",
            match: "\\b([0-9]+)\\b"
        },
        {
            name: "variable.language.r-check",
            match: "\\b(myself|chan|sender|getter|supplier|p2p)\\b"
        },
        {
        name: "storage.type.r-check",
        match: "\\b(bool|channel|int|Agent|location)\\b"
        }
    ];

    // Careful, this can still have false positives
    oldPatterns.forEach(pattern => {
        if (!jsonData.patterns.some(p => p.match !== undefined && p.match.includes(pattern))) {
            console.warn(`Pattern "${pattern}" is missing in the new patterns.`);
        }
    });


    fs.writeFile(jsonpath, JSON.stringify(jsonData, null, 2), 'utf8', (err) => {
        if (err) {
            console.error('Error writing file:', err);
            return;
        }
        console.log('Syntax file updated successfully');
    });
});

