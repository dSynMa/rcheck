import { LangiumTypeSystemDefinition, TypirLangiumServices } from "typir-langium";
import {
  BinExpr,
  Case,
  isBinExpr,
  isBoolLiteral,
  isCase,
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
    typir.factory.Primitives.create({ primitiveName: "location" })
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
    const anyType = typir.factory.Top.create({}).finish();

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
        signature: { left: anyType, right: anyType, return: typeBool },
      })
        .inferenceRule({
          ...binaryInferenceRule,
          validation: (node, _operatorName, _operatorType, accept, typir) =>
            typir.validation.Constraints.ensureNodeIsEquals(node.left, node.right, accept, (actual, expected) => ({
              message: `This comparison will always return '${node.operator === "!=" ? "true" : "false"}' as '${
                node.left.$cstNode?.text
              }' and '${node.right.$cstNode?.text}' have the different types '${actual.name}' and '${expected.name}'.`,
              languageNode: node, // Inside the BinaryExpression ...
              languageProperty: "operator", // ... mark the '==' or '!=' token, i.e. the 'operator' property
              severity: "warning", // Only issue warning because mismatch returns "false"
            })),
        })
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
        if (isLocal(ref) || isParam(ref) || isMsgStruct(ref) || isPropVar(ref) || isCase(ref)) {
          return ref;
        } else {
          return InferenceRuleNotApplicable;
        }
      },
    });
  }

  onNewAstNode(languageNode: AstNode, typir: TypirLangiumServices<RCheckAstType>): void {
    if (isEnum(languageNode)) {
      const documentUri = languageNode.$container.$document?.uri;
      if (documentUri === undefined) {
        throw new Error("Unable to determine document URI."); // TODO: is error correct solution here?
      }
      const enumName = `${documentUri}: ${languageNode.name}`;

      // Return early if a primitive with the same name already exists
      if (typir.factory.Primitives.get({ primitiveName: enumName })) return;

      // Create new enum type
      typir.factory.Primitives.create({ primitiveName: enumName })
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
