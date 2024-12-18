import type { AstNode, AstNodeDescription, LangiumDocument, Module, PrecomputedScopes, ReferenceInfo, Scope } from 'langium';
import { AstUtils, DefaultScopeComputation, DefaultScopeProvider, inject } from 'langium';
import { CancellationToken } from 'vscode-languageserver';
import { Enum, Model, QualifiedRef, isEnum, isQualifiedRef, isPropVar, isCommand, Command} from './generated/ast.js';
import { RCheckGeneratedModule, RCheckGeneratedSharedModule } from './generated/module.js';
import { RCheckValidator, registerValidationChecks } from './r-check-validator.js';
import { createDefaultModule, createDefaultSharedModule, DefaultSharedModuleContext, LangiumServices, LangiumSharedServices, PartialLangiumServices } from 'langium/lsp';


export class RCheckScopeProvider extends DefaultScopeProvider {
    override getScope(context: ReferenceInfo): Scope {
        const superScope: Scope = super.getScope(context);
        const globalDescriptions: AstNodeDescription[] = superScope.getAllElements().toArray();
        const document: LangiumDocument = AstUtils.getDocument(context.container);
        for (const childNode of AstUtils.streamAllContents(document.parseResult.value)) {
            // Export enum cases globally (but limited to current file)
            if (isEnum(childNode)) {
                const enumNode: Enum = childNode as Enum;
                for(const caseNode of enumNode.cases){
                    globalDescriptions.push(this.descriptions.createDescription(caseNode, caseNode.name, document));
                }
            }
            // Export @-prefixed names for property variables
            if (isPropVar(childNode)) {
                globalDescriptions.push(this.descriptions.createDescription(childNode, "@" + childNode.name, document))
            }
        }
        return this.createScope(globalDescriptions);
    }
}

export class RCheckScopeComputation extends DefaultScopeComputation {

    override async computeLocalScopes(document: LangiumDocument<AstNode>, cancelToken?: CancellationToken | undefined): Promise<PrecomputedScopes> {
        
        const scopes = await super.computeLocalScopes(document, cancelToken);
        const model = document.parseResult.value as Model;
        // This map stores a list of descriptions for each node in our document
        
        // Make param names available within guard
        for (const guard of model.guards) {
            const localDescriptions: AstNodeDescription[] = [];
            for (const param of guard.params){
                const descr = this.descriptions.createDescription(param, param.name, document);
                localDescriptions.push(descr);
            }
            scopes.addAll(guard, localDescriptions);
        }

        let agentMap = new Map<string, AstNodeDescription[]>;
        let instanceMap = new Map<string, string>;
        let quantMap = new Map<string, string[]>;

        for (const agent of model.agents) {
            const localDescriptions: AstNodeDescription[] = [];
            // Create descriptions for labels
            for (const child of AstUtils.streamAst(agent).filter(isCommand)) {
                const cmd = child as Command;
                if (cmd.name !== undefined) {
                    const descr = this.descriptions.createDescription(cmd, cmd.name, document);
                    localDescriptions.push(descr);
                }
            }
            // Create descriptions for local variables
            for (const local of agent.locals){
                const descr = this.descriptions.createDescription(local, local.name, document);
                localDescriptions.push(descr);
            }
            agentMap.set(agent.name, localDescriptions);
            scopes.addAll(agent, localDescriptions);
        }
        // Export local variables to instance init
        for (const instance of model.system) {
            if (agentMap.has(instance.agent.$refText)) {
                instanceMap.set(instance.name, instance.agent.$refText);
                scopes.addAll(instance, agentMap.get(instance.agent.$refText)!);
            }
        }

        // Export labels and local variables to qualified references in LTOL
        for (const spec of model.specs) {
            // Gather kinds of quantified variables
            if (spec.quants !== undefined){
                for (const quant of spec.quants) {
                    quantMap.set(quant.name, quant.kinds.map(k => k.$refText));
                    if (quant.anyKind !== undefined) {
                        // This quantifier uses the catch-all name ("Agent")
                        quantMap.set(quant.name, model.agents.map(a => a.name));
                    }
                }
            }

            for (const child of AstUtils.streamAllContents(spec)) {
                if (isQualifiedRef(child)) {
                    const qref = child as QualifiedRef;
                    if (instanceMap.has(qref.instance.$refText)){
                        const agentName = instanceMap.get(qref.instance.$refText)!;
                        if (agentName !== undefined) {
                            const descriptions = agentMap.get(agentName);
                            if (descriptions !== undefined) {
                                scopes.addAll(child, descriptions);
                            }
                        }
                    }
                    else if (quantMap.has(qref.instance.$refText)) {
                        const names = quantMap.get(qref.instance.$refText)!;
                        if (names !== undefined) {
                            for (const agentName of names) {
                                const descriptions = agentMap.get(agentName);
                                if (descriptions !== undefined) {
                                    scopes.addAll(child, descriptions);
                                }
                            }
                        }
                    }
                }
            }
        }

        return scopes;
    }
}

/**
 * Declaration of custom services - add your own service classes here.
 */
export type RCheckAddedServices = {
    validation: {
        RCheckValidator: RCheckValidator
    }
}

/**
 * Union of Langium default services and your custom services - use this as constructor parameter
 * of custom service classes.
 */
export type RCheckServices = LangiumServices & RCheckAddedServices

/**
 * Dependency injection module that overrides Langium default services and contributes the
 * declared custom services. The Langium defaults can be partially specified to override only
 * selected services, while the custom services must be fully specified.
 */
export const RCheckModule: Module<RCheckServices, PartialLangiumServices & RCheckAddedServices> = {
    validation: {
        RCheckValidator: () => new RCheckValidator()
    },
    references : {
        ScopeComputation : (services) => new RCheckScopeComputation(services),
        ScopeProvider: (services) => new RCheckScopeProvider(services)
    }
};

/**
 * Create the full set of services required by Langium.
 *
 * First inject the shared services by merging two modules:
 *  - Langium default shared services
 *  - Services generated by langium-cli
 *
 * Then inject the language-specific services by merging three modules:
 *  - Langium default language-specific services
 *  - Services generated by langium-cli
 *  - Services specified in this file
 *
 * @param context Optional module context with the LSP connection
 * @returns An object wrapping the shared services and the language-specific services
 */
export function createRCheckServices(context: DefaultSharedModuleContext): {
    shared: LangiumSharedServices,
    RCheck: RCheckServices
} {
    const shared = inject(
        createDefaultSharedModule(context),
        RCheckGeneratedSharedModule
    );
    const RCheck = inject(
        createDefaultModule({ shared }),
        RCheckGeneratedModule,
        RCheckModule
    );
    shared.ServiceRegistry.register(RCheck);
    registerValidationChecks(RCheck);
    return { shared, RCheck };
}
