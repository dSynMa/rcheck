import { LangiumTypeSystemDefinition, TypirLangiumServices } from "typir-langium";
import {
  Agent,
  AutomatonState,
  BaseProcess,
  BinExpr,
  Enum,
  Guard,
  GuardCall,
  Instance,
  isAgent,
  isBinExpr,
  isBoolLiteral,
  isBroadcast,
  isCase,
  isChannelRef,
  isChoice,
  isEnum,
  isGet,
  isGuard,
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
  isRef,
  isRelabel,
  isRep,
  isSend,
  isSequence,
  isSupply,
  isUMinus,
  Local,
  MsgStruct,
  Neg,
  Param,
  PropVar,
  QualifiedRef,
  RCheckAstType,
  Sequence,
  SupplyLocationExpr,
  UMinus,
} from "./generated/ast.js";
import { assertUnreachable, AstNode } from "langium";
import {
  InferOperatorWithMultipleOperands,
  InferOperatorWithSingleOperand,
  InferenceRuleNotApplicable,
  NO_PARAMETER_NAME,
} from "typir";

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

    const typeInt = typir.factory.Primitives.create({ primitiveName: "int" })
      .inferenceRule({ filter: isNumberLiteral })
      .inferenceRule({
        languageKey: [Local, Param, MsgStruct, PropVar],
        matching: (node: Local | Param | MsgStruct | PropVar) => node.builtinType === "int",
      })
      .finish();

    // TODO: define range as subtype of 'int'
    const typeRange = typir.factory.Primitives.create({ primitiveName: "range" })
      .inferenceRule({
        languageKey: [Local, Param, MsgStruct, PropVar],
        matching: (node: Local | Param | MsgStruct | PropVar) => node.rangeType !== undefined,
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

    const typeAny = typir.factory.Top.create({}).finish();

    // TODO: fix this conversion
    typir.Conversion.markAsConvertible(typeRange, typeInt, "IMPLICIT_EXPLICIT");

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
          // TODO: working, but check out if there is a better way then check for assignability
          //       (best case: keep IsEquals but do type conversion if available)
          validation: (node, _operatorName, _operatorType, accept, typir) => {
            const nodes = [node.left, node.right];
            if (isRef(node.right) && isInstance(node.right.variable.ref)) {
              nodes.reverse();
            }
            return typir.validation.Constraints.ensureNodeIsAssignable(
              nodes[0],
              nodes[1],
              accept,
              (actual, expected) => ({
                message: `This comparison will always return '${node.operator === "!=" ? "true" : "false"}' as '${
                  node.left.$cstNode?.text
                }' and '${node.right.$cstNode?.text}' have the different types '${actual.name}' and '${
                  expected.name
                }'.`,
                languageNode: node, // Inside the BinaryExpression ...
                languageProperty: "operator", // ... mark the '==' or '!=' token, i.e. the 'operator' property
                severity: "warning", // Only issue warning because mismatch returns "false"
              })
            );
          },
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

    // TODO: maybe this validation rule can be implemented upon class creation
    typir.validation.Collector.addValidationRulesForAstNodes({
      Instance: (node, accept, typir) => {
        const typeBool = typir.factory.Primitives.get({ primitiveName: "bool" })!;
        typir.validation.Constraints.ensureNodeIsAssignable(node.init, typeBool, accept, () => ({
          message: "Agent inititalization needs to evaluate to 'bool'.",
          languageProperty: "init",
          languageNode: node,
        }));
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

    if (isGuard(languageNode)) {
      typir.factory.Functions.create({
        functionName: languageNode.name,
        outputParameter: { name: NO_PARAMETER_NAME, type: "bool" },
        inputParameters: languageNode.params.map((p) => ({ name: p.name, type: p })),
        associatedLanguageNode: languageNode,
      })
        .inferenceRuleForDeclaration({
          languageKey: Guard,
          matching: (node: Guard) => languageNode === node,
        })
        .inferenceRuleForCalls({
          languageKey: GuardCall,
          matching: (node: GuardCall) => languageNode === node.guard.ref,
          inputArguments: (node: GuardCall) => node.args,
          validateArgumentsOfFunctionCalls: true,
        })
        .finish();
    }

    if (isAgent(languageNode)) {
      const agentName = languageNode.name;
      const agentType = typir.factory.Classes.create({
        className: agentName,
        fields: [
          ...languageNode.locals.map((l) => ({
            name: l.name,
            type: l,
          })),
          ...this.getProcessNames(languageNode).map((n) => ({
            name: n,
            type: "bool",
          })),
          { name: "automaton-state", type: "int" },
        ],
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
          field: (node: QualifiedRef) => node.variable.ref!.name!,
        })
        .inferenceRuleForFieldAccess({
          languageKey: AutomatonState,
          matching: (node: AutomatonState) => languageNode === node.instance.ref?.agent.ref,
          field: (_node: AutomatonState) => "automaton-state",
        })
        .finish();

      // Every agent is also a location
      // TODO: fix this conversion
      agentType.addListener((type) => {
        typir.Conversion.markAsConvertible(
          type,
          typir.factory.Primitives.get({ primitiveName: "location" })!,
          "IMPLICIT_EXPLICIT"
        );
      });
    }
  }

  protected getProcessNames(agent: Agent): string[] {
    const stack: (BaseProcess | Sequence)[] = [agent.repeat];
    const processNames: string[] = [];

    while (stack.length !== 0) {
      const process = stack.pop()!;
      if (isSend(process) || isReceive(process) || isGet(process) || isSupply(process)) {
        if (process.name) {
          processNames.push(process.name);
        }
      } else if (isChoice(process) || isSequence(process)) {
        stack.push(process.left);
        if (process.right !== undefined) {
          stack.push(process.right);
        }
      } else if (isRep(process)) {
        stack.push(process.process);
      } else {
        assertUnreachable(process);
      }
    }

    return processNames;
  }
}
