import { LangiumTypeSystemDefinition, TypirLangiumServices } from "typir-langium";
import {
  Agent,
  BinExpr,
  Enum,
  Instance,
  isAgent,
  isBinExpr,
  isBoolLiteral,
  isBroadcast,
  isCase,
  isChannelRef,
  isEnum,
  isGet,
  isInstance,
  isLocal,
  isLtolQuant,
  isMsgStruct,
  isMyself,
  isNeg,
  isNumberLiteral,
  isParam,
  isPropVar,
  isReceive,
  isRelabel,
  isSend,
  isSupply,
  isUMinus,
  Local,
  MsgStruct,
  Neg,
  Param,
  PropVar,
  QualifiedRef,
  RCheckAstType,
  SupplyLocationExpr,
  UMinus,
} from "./generated/ast.js";
import { assertUnreachable, AstNode } from "langium";
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
    const typeAny = typir.factory.Top.create({}).finish();
    typir.factory.Primitives.create({ primitiveName: "channel" })
      .inferenceRule({ filter: isChannelRef })
      .inferenceRule({ filter: isBroadcast })
      .inferenceRule({
        languageKey: [Local, Param, MsgStruct, PropVar],
        matching: (node: Local | Param | MsgStruct | PropVar) => node.customType?.ref?.name === "channel",
      })
      .inferenceRule({
        languageKey: Enum,
        matching: (node: Enum) => node.name === "channel",
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
        signature: { left: typeAny, right: typeAny, return: typeBool },
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
    typir.factory.Operators.createBinary({
      name: "<-",
      signature: { left: typeAny, right: typeAny, return: typeAny },
    })
      .inferenceRule({
        filter: isRelabel,
        matching: () => true,
        operands: (node) => [node.var.ref!, node.expr], // TODO: take care of "!", find out if this is an issue
        validation: (node, _operatorName, _operatorType, accept, typir) =>
          typir.validation.Constraints.ensureNodeIsAssignable(node.expr, node.var.ref, accept, (actual, expected) => ({
            message: `Variable of type '${expected.name}' cannot be relabeled with expression of type '${actual.name}'.`,
            languageNode: node,
            languageProperty: "expr",
            severity: "error",
          })),
      })
      .finish();

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
        if (isLocal(ref)) {
          return ref;
        } else if (isCase(ref)) {
          console.log(
            `While inferring type for case ${ref.name} at position ${ref.$container.$cstNode?.text}, the type of ${ref.$cstNode?.text} was returned`
          );
          return ref.$container;
        } else if (isParam(ref)) {
          return ref;
        } else if (isMsgStruct(ref)) {
          return ref;
        } else if (isPropVar(ref)) {
          return ref;
        } else if (isSend(ref)) {
          return InferenceRuleNotApplicable;
        } else if (isReceive(ref)) {
          return InferenceRuleNotApplicable;
        } else if (isGet(ref)) {
          return InferenceRuleNotApplicable;
        } else if (isSupply(ref)) {
          return InferenceRuleNotApplicable;
        } else if (isInstance(ref)) {
          return ref;
        } else if (ref === undefined) {
          return InferenceRuleNotApplicable;
        } else {
          assertUnreachable(ref);
        }
      },
      PropVarRef: (languageNode) => {
        const ref = languageNode.variable.ref;
        if (isPropVar(ref)) {
          return ref;
        } else {
          return InferenceRuleNotApplicable;
        }
      },
    });
  }

  onNewAstNode(languageNode: AstNode, typir: TypirLangiumServices<RCheckAstType>): void {
    if (isEnum(languageNode)) {
      // Exclude channel enum here
      if (languageNode.name === "channel") return;

      const documentUri = languageNode.$container.$document?.uri;
      if (documentUri === undefined) {
        throw new Error("Unable to determine document URI."); // TODO: is error correct solution here?
      }
      const enumName = `${documentUri}::${languageNode.name}`;

      // Return early if a primitive with the same name already exists
      if (typir.factory.Primitives.get({ primitiveName: enumName })) return;

      // Create new enum type
      typir.factory.Primitives.create({ primitiveName: enumName })
        .inferenceRule({
          languageKey: [Local, Param, MsgStruct, PropVar],
          matching: (node: Local | Param | MsgStruct | PropVar) => languageNode === node.customType?.ref,
        })
        .inferenceRule({
          languageKey: Enum,
          matching: (node: Enum) => languageNode === node,
        })
        .finish();
    }

    if (isAgent(languageNode)) {
      const agentName = languageNode.name;
      typir.factory.Classes.create({
        className: agentName,
        fields: languageNode.locals.map((l) => ({
          name: l.name,
          type: (l.builtinType ?? l.rangeType ?? l.customType?.ref)!,
        })),
        methods: [],
      })
        .inferenceRuleForClassDeclaration({ languageKey: Agent, matching: (node: Agent) => languageNode === node })
        .inferenceRuleForClassLiterals({
          languageKey: Instance,
          matching: (node: Instance) => isAgent(node.agent.ref) && node.agent.ref.name === agentName,
          inputValuesForFields: (_node: Instance) => new Map(),
        })
        .inferenceRuleForFieldAccess({
          languageKey: QualifiedRef,
          matching: (node: QualifiedRef) => {
            const qualifier = node.instance.ref;
            if (isLtolQuant(qualifier)) return false;
            return qualifier?.agent.ref?.name === agentName;
          },
          field: (node: QualifiedRef) => node.variable.ref!,
        })
        .finish();
    }
  }
}
