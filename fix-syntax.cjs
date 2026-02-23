console.log("Fixing syntax hihglighting...")

const fs = require('fs');
const path = require('path');
const { json } = require('stream/consumers');

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
    console.log("Old patterns:", oldPatterns);


    jsonData.repository.keywords = {
        patterns: [
            {
                name: "keyword.control.r-check",
                match: "\\b(SPEC|enum|channels|property-variables|guard|init|local|message-structure|receive-guard|relabel|rep|repeat|system)\\b|\\B(-automaton-state)\\b|\\b(GET@|SUPPLY@)\\B"
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
        ]};

    jsonData.repository.constants = {
        patterns: [
            {
                name: "constant.language.r-check",
                match: "\\b(false|true|any)\\b"
            },
            {
                name: "constant.numeric.r-check",
                match: "\\b([0-9]+)\\b"
            }
        ]
    }

    jsonData.repository.variables = {
        patterns: [
            {
                name: "variable.language.r-check",
                match: "\\b(myself|chan|getter|p2p|sender|supplier)\\b"
            }
        ]
    }

    jsonData.repository.types = {
        patterns: [
            {
                name: "storage.type.r-check",
                match: "\\b(Agent|bool|channel|int|location)\\b"
            }
        ]
    }

    let count = 0;
    // Careful, this can still have false positives
    oldPatterns.forEach(pattern => {
        let found = false;
        Object.keys(jsonData.repository).forEach(key => {
            if (jsonData.repository[key].patterns.some(p => p.match !== undefined && p.match.includes(pattern))) {
                found = true;
                return;
            }
        });
        if (!found) {
            count++;
            console.warn(`\x1b[33m[WARNING] Pattern "${pattern}" is missing in the new patterns.\x1b[0m`);
        }
    });

    jsonData.patterns = [
        {
            include: "#comments"
        },
        {
            include: "#keywords"
        },
        {
            include: "#constants"
        },
        {
            include: "#variables"
        },
        {
            include: "#types"
        }
    ]

    fs.writeFile(jsonpath, JSON.stringify(jsonData, null, 2), 'utf8', (err) => {
        if (err) {
            console.error('Error writing file:', err);
            return;
        }
        color = count > 0 ? "\x1b[33m" : "\x1b[32m";
        console.log(`Syntax file updated successfully ${color}[${count} missing patterns.]\x1b[0m`);;
    });
});
