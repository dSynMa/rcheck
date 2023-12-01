import type { DefaultSharedModuleContext, LangiumServices, LangiumSharedServices, Module, PartialLangiumServices } from 'langium';
import { createDefaultModule, createDefaultSharedModule, inject } from 'langium';
import { RCheckGeneratedModule, RCheckGeneratedSharedModule } from './generated/module.js';
import { RCheckValidator, registerValidationChecks } from './r-check-validator.js';

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
