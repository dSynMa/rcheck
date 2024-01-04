import { AstNode, Stream, ValidationAcceptor, ValidationChecks, isAstNode, streamAst, streamContents } from 'langium';
import { Agent, Model, RCheckAstType, isAssign, isBinExpr, isBox, isCommand, isDiamond, isExpr, isFinally, isGlobally, isNext } from './generated/ast.js';
import type { RCheckServices } from './r-check-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: RCheckServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.RCheckValidator;
    const checks: ValidationChecks<RCheckAstType> = {
        Model: validator.checkModel,
        Agent: validator.checkAgent
    };
    registry.register(checks, validator);
}

function checkForLtol(node: AstNode, accept: ValidationAcceptor): void {
    if (!isAstNode(node)) return;
    if (
        isDiamond(node) || isBox(node)
        || isFinally(node) || isGlobally(node) || isNext(node)
        || (isBinExpr(node) && "RUW".indexOf(node.operator) != -1)
    ) {
        accept("error", "LTOL not allowed here", {node: node})
    }
    if (isExpr(node)) {
        streamContents(node).forEach(n => checkForLtol(n, accept));
    }
}

function checkDuplicates(nodeArray: any[] | Stream<any> | undefined, what: string, accept: ValidationAcceptor) : Set<any> {
    const seen = new Set();
    nodeArray?.forEach(v => {
        if (v.name !== undefined && seen.has(v.name)) {
            accept("error", `Duplicate ${what} '${v.name}'`, {node: v, property: "name"});
        }
        seen.add(v.name);
    });
    return seen;
}

/**
 * Implementation of custom validations.
 */
export class RCheckValidator {
    
    checkAgent(agent: Agent, accept: ValidationAcceptor): void {
        checkDuplicates(agent.locals, "local variable", accept);
        checkDuplicates(streamAst(agent).filter(isCommand), "label", accept);

        if (agent.init !== undefined){
            checkForLtol(agent.init, accept);
        }
        for (const n of streamAst(agent)){
            if (isAssign(n) || isCommand(n)) {
                streamContents(n).forEach(m => checkForLtol(m, accept));
            }
        }
        
    }

    checkModel(model: Model, accept: ValidationAcceptor): void {
        checkDuplicates(model.channels, "channel name", accept);
        checkDuplicates(model.msgStructs, "message variable", accept);
        checkDuplicates(model.enums, "enum", accept);
        model.guards?.forEach(g => checkDuplicates(g.params, "parameter", accept));
        const cases = model.enums?.map(e => e.cases).flat()
        checkDuplicates(cases, "enum case", accept);


        if (model.commVars.length == 0) {
            model.specs?.forEach(ltol => { 
                if (ltol.quants !== undefined && ltol.quants.length > 0) {
                    accept("warning", `Quantified formula, but system has no property identifiers`, { node: ltol });
                
                }
            });
        }

        model.guards?.forEach(g => checkForLtol(g.body, accept));
    }

}
