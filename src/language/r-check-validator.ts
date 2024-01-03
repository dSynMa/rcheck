import { AstNode, ValidationAcceptor, ValidationChecks, isAstNode, streamAst, streamContents } from 'langium';
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

/**
 * Implementation of custom validations.
 */
export class RCheckValidator {
    
    checkAgent(agent: Agent, accept: ValidationAcceptor): void {
        const locals = new Set();
        agent.locals?.forEach(v => {
            if (locals.has(v.name)) {
                accept("error", `Duplicate local variable '${v.name}'`, {node: v, property: "name"});
            }
            locals.add(v.name);
        });
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
