import { ValidationAcceptor, ValidationChecks } from 'langium';
import { Agent, Model, RCheckAstType } from './generated/ast.js';
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
    }

    checkModel(model: Model, accept: ValidationAcceptor): void {
        if (model.commVars.length == 0) {
            model.specs.forEach(ltol => { 
                if (ltol.quants !== undefined && ltol.quants.length > 0) {
                    accept("warning", `Quantified formula, but system has no property identifiers`, { node: ltol });
                
                }
            });
        }
    }

}
