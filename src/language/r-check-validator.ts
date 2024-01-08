import { AstNode, NamedAstNode, ValidationAcceptor, ValidationChecks, isAstNode, isNamed, streamAllContents, streamAst, streamContents } from 'langium';
import { Agent, Model, RCheckAstType, isAssign, isBinExpr, isBox, isCommand, isDiamond, isExpr, isFinally, isGlobally, isLocal, isLtolQuant, isNext, isParam } from './generated/ast.js';
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

function checkDuplicates(nodeArray: any, what: string, accept: ValidationAcceptor, names: Set<string> | undefined = undefined) : Set<string> {
    const seen: Set<string> = new Set(names);
    if (nodeArray == undefined) return seen;
    nodeArray.forEach((node: AstNode) => {
        if (!isNamed(node)) return;
        const namedNode = node as NamedAstNode;
        if (namedNode.name !== undefined && seen.has(namedNode.name)) {
            accept("error", `Duplicate ${what} '${namedNode.name}'`, {node: namedNode, property: "name"});
        }
        else {
            seen.add(namedNode.name);
        }
    });
    return seen;
}

/**
 * Implementation of custom validations.
 */
export class RCheckValidator {
    globalNames: any;

    async checkAgent(agent: Agent, accept: ValidationAcceptor): Promise<void> {
        checkDuplicates(agent.locals, "local variable", accept, this.globalNames);
        checkDuplicates(streamAst(agent).filter(isCommand), "label", accept, this.globalNames);

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
        
        const namedNodes = streamAst(model).filter(isNamed).filter(
            n => !isParam(n) && !isLocal(n) && !isCommand(n) && !isLtolQuant(n)
        );
            
        this.globalNames = checkDuplicates(namedNodes, "name", accept);
        model.guards?.forEach(g => checkDuplicates(g.params, "parameter", accept, this.globalNames));
        model.specs?.forEach(spec => checkDuplicates(streamAst(spec), "name", accept, this.globalNames));


        if (model.commVars?.length == 0) {
            model.specs?.forEach(ltol => { 
                if (ltol.quants !== undefined && ltol.quants?.length > 0) {
                    accept("warning", `Quantified formula, but system has no property identifiers`, { node: ltol });
                
                }
            });
        }

        model.guards?.forEach(g => checkForLtol(g.body, accept));
    }

}
