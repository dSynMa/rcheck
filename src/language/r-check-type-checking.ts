import { LangiumTypeSystemDefinition, TypirLangiumServices } from "typir-langium";
import {
  BinExpr,
  Case,
  isBinExpr,
  isBoolLiteral,
  isEnum,
  isLocal,
  isMsgStruct,
  isMyself,
  isNeg,
  isNumberLiteral,
  isParam,
  isPropVar,
  isUMinus,
  Local,
  MsgStruct,
  Neg,
  Param,
  PropVar,
  RCheckAstType,
  SupplyLocationExpr,
  UMinus,
} from "./generated/ast.js";
import { AstNode } from "langium";
import { InferOperatorWithMultipleOperands, InferOperatorWithSingleOperand, InferenceRuleNotApplicable } from "typir";

export class RCheckTypeSystem implements LangiumTypeSystemDefinition<RCheckAstType> {
  onInitialize(typir: TypirLangiumServices<RCheckAstType>): void {
    // Define the primitive types
    const typeBool = typir.factory.Primitives.create({ primitiveName: "bool" })
      .inferenceRule({ filter: isBoolLiteral })
      .inferenceRule({
        languageKey: [Local, Param, MsgStruct, PropVar],
        matching: (node: Local | Param | MsgStruct | PropVar) => node.builtinType === "bool",
      })
      .finish();
    const typeInt = typir.factory.Primitives.create({
      primitiveName: "int",
    })
      .inferenceRule({ filter: isNumberLiteral })
      .inferenceRule({
        languageKey: [Local, Param, MsgStruct, PropVar],
        matching: (node: Local | Param | MsgStruct | PropVar) => node.builtinType === "int",
      })
      .finish();
    const typeLocation = typir.factory.Primitives.create({ primitiveName: "location" })
      .inferenceRule({
        languageKey: [Local, Param, MsgStruct, PropVar],
        matching: (node: Local | Param | MsgStruct | PropVar) => node.builtinType === "location",
      })
      .inferenceRule({ filter: isMyself })
      .inferenceRule({
        languageKey: SupplyLocationExpr,
        matching: (node: SupplyLocationExpr) => node.myself !== undefined || node.any !== undefined,
      })
      .finish();

    // Inference rules for binary and unary operators
    const binaryInferenceRule: InferOperatorWithMultipleOperands<AstNode, BinExpr> = {
      filter: isBinExpr,
      matching: (node: BinExpr, name: string) => node.operator === name,
      operands: (node: BinExpr, _name: string) => [node.left, node.right],
      validateArgumentsOfCalls: true,
    };
    type UnaryExpression = UMinus | Neg;
    function isUnaryExpression(node: AstNode, _name: string): node is UnaryExpression {
      return isUMinus(node) || isNeg(node);
    }
    const unaryInferenceRule: InferOperatorWithSingleOperand<AstNode, UnaryExpression> = {
      filter: isUnaryExpression,
      matching: (node: UnaryExpression, name: string) => node.operator === name,
      operand: (node: UnaryExpression, _name: string) => node.expr,
      validateArgumentsOfCalls: true,
    };

    // Binary operators
    for (const operator of ["+", "-", "*", "/"]) {
      typir.factory.Operators.createBinary({
        name: operator,
        signature: { left: typeInt, right: typeInt, return: typeInt },
      })
        .inferenceRule(binaryInferenceRule)
        .finish();
    }
    for (const operator of ["<", "<=", ">", ">="]) {
      typir.factory.Operators.createBinary({
        name: operator,
        signature: { left: typeInt, right: typeInt, return: typeBool },
      })
        .inferenceRule(binaryInferenceRule)
        .finish();
    }
    // The syntax allows this only for numbers, but the type system allows it for all types
    for (const operator of ["=", "!=", "=="]) {
      typir.factory.Operators.createBinary({
        name: operator,
        signatures: [
          { left: typeInt, right: typeInt, return: typeBool },
          { left: typeBool, right: typeBool, return: typeBool },
          { left: typeLocation, right: typeLocation, return: typeBool },
        ],
      })
        .inferenceRule(binaryInferenceRule)
        .finish();
    }

    // Unary operators
    typir.factory.Operators.createUnary({ name: "-", signature: { operand: typeInt, return: typeInt } })
      .inferenceRule(unaryInferenceRule)
      .finish();
    typir.factory.Operators.createUnary({ name: "!", signature: { operand: typeBool, return: typeBool } })
      .inferenceRule(unaryInferenceRule)
      .finish();

    // Handle variable references
    typir.Inference.addInferenceRulesForAstNodes({
      Ref: (languageNode) => {
        const ref = languageNode.variable.ref;
        if (isLocal(ref) || isParam(ref) || isMsgStruct(ref) || isPropVar(ref)) {
          return ref;
        } else {
          return InferenceRuleNotApplicable;
        }
      },
    });
  }

  onNewAstNode(languageNode: AstNode, typir: TypirLangiumServices<RCheckAstType>): void {
    console.log(`Encountered node type: ${languageNode.$type}`);
    if (isEnum(languageNode)) {
      // Check for duplicate enum definitions. Remove the if statement to encounter language server crash
      /* if (typir.factory.Primitives.get({ primitiveName: languageNode.name })) {
        console.log(`Found duplicate enum definition with name ${languageNode.name} in this scope.`);
        return;
      } */
      typir.factory.Primitives.create({ primitiveName: languageNode.name })
        .inferenceRule({
          languageKey: [Local, Param, MsgStruct, PropVar],
          matching: (node: Local | Param | MsgStruct | PropVar) => languageNode === node.customType?.ref,
        })
        .inferenceRule({
          languageKey: [Case],
          matching: (node: Case) => languageNode === node.$container,
        })
        .finish();
    }
  }
}
