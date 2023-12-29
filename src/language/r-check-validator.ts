// import type { ValidationAcceptor, ValidationChecks } from 'langium';
// import type { RCheckAstType, Person } from './generated/ast.js';
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
        // Person: validator.checkPersonStartsWithCapital
        Model: validator.checkQuantifiedLtol,
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

    checkQuantifiedLtol(model: Model, accept: ValidationAcceptor): void {
        if (model.commVars.length == 0) {
            model.specs.forEach(ltol => {
                if (ltol.quant != undefined) {
                    accept("warning", `Quantifier '${ltol.quant}', but system has no property identifiers`, { node: ltol, property: 'quant' });
                }
            });
        }
    }

    // checkPersonStartsWithCapital(person: Person, accept: ValidationAcceptor): void {
    //     if (person.name) {
    //         const firstChar = person.name.substring(0, 1);
    //         if (firstChar.toUpperCase() !== firstChar) {
    //             accept('warning', 'Person name should start with a capital.', { node: person, property: 'name' });
    //         }
    //     }
    // }

}
