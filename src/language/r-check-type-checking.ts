import { LangiumTypeSystemDefinition, TypirLangiumServices } from "typir-langium";
import { RCheckAstType } from "./generated/ast.js";
import { AstNode } from "langium";

export class RCheckTypeSystem implements LangiumTypeSystemDefinition<RCheckAstType> {
  onInitialize(typir: TypirLangiumServices<RCheckAstType>): void {}

  onNewAstNode(languageNode: AstNode, typir: TypirLangiumServices<RCheckAstType>): void {}
}
