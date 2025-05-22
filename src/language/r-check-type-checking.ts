import { LangiumTypeSystemDefinition, TypirLangiumServices } from "typir-langium";
import {
  Agent,
  Assign,
  AutomatonState,
  BaseProcess,
  BinExpr,
  BinObs,
  Box,
  Diamond,
  Enum,
  ExistsObs,
  Finally,
  ForallObs,
  Globally,
  Guard,
  GuardCall,
  isAgent,
  isAssign,
  isBinExpr,
  isBinObs,
  isBoolLiteral,
  isBox,
  isBroadcast,
  isCase,
  isChannelObs,
  isChannelRef,
  isChoice,
  isDiamond,
  isEnum,
  isExistsObs,
  isForallObs,
  isGet,
  isGuard,
  isInstance,
  isLiteralObs,
  isLocal,
  isLtolMod,
  isLtolQuant,
  isMsgStruct,
  isMyself,
  isNeg,
  isNumberLiteral,
  isParam,
  isPropVar,
  isReceive,
  isRelabel,
  isRep,
  isSend,
  isSenderObs,
  isSequence,
  isSupply,
  isUMinus,
  Local,
  MsgStruct,
  Neg,
  Next,
  Param,
  PropVar,
  QualifiedRef,
  RCheckAstType,
  Relabel,
  Sequence,
  SupplyLocationExpr,
  UMinus,
} from "./generated/ast.js";
import { assertUnreachable, AstNode } from "langium";
import {
  AnnotatedTypeAfterValidation,
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
      .inferenceRule({ filter: isLiteralObs })
      .inferenceRule({ filter: isChannelObs })
      .inferenceRule({ filter: isSenderObs })
      .inferenceRule({
        languageKey: [Local, Param, MsgStruct, PropVar],
        matching: (node: Local | Param | MsgStruct | PropVar) => node.builtinType === "bool",
      })
      .finish();

    const typeInt = typir.factory.Primitives.create({ primitiveName: "int" })
      .inferenceRule({ filter: isNumberLiteral })
      .inferenceRule({
        languageKey: [Local, Param, MsgStruct, PropVar],
        matching: (node: Local | Param | MsgStruct | PropVar) =>
          node.builtinType === "int" || node.rangeType !== undefined,
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
      .inferenceRule({ filter: isInstance })
      .finish();

    const typeChannel = typir.factory.Primitives.create({ primitiveName: "channel" })
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

    // Inference rule for binary operators
    const binaryInferenceRule: InferOperatorWithMultipleOperands<AstNode, BinExpr> = {
      filter: isBinExpr,
      matching: (node: BinExpr, name: string) => node.operator === name,
      operands: (node: BinExpr) => [node.left, node.right],
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
    // TODO: what about 'U' | 'R' | 'W'?
    for (const operator of ["&", "|", "->"]) {
      typir.factory.Operators.createBinary({
        name: operator,
        signature: { left: typeBool, right: typeBool, return: typeBool },
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
              }' and '${node.right.$cstNode?.text}' have the different types '${this.getTypeName(
                actual
              )}' and '${this.getTypeName(expected)}'.`,
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
        operands: (node: Relabel) => [node.var.ref!, node.expr], // TODO: take care of "!", find out if this is an issue
        validation: (node, _operatorName, _operatorType, accept, typir) =>
          typir.validation.Constraints.ensureNodeIsAssignable(node.expr, node.var.ref, accept, (actual, expected) => ({
            message: `Variable of type '${this.getTypeName(
              expected
            )}' cannot be relabeled with expression of type '${this.getTypeName(actual)}'.`,
            languageNode: node,
            languageProperty: "expr",
            severity: "error",
          })),
        validateArgumentsOfCalls: true,
      })
      .finish();
    typir.factory.Operators.createBinary({
      name: ":=",
      signature: { left: typeAny, right: typeAny, return: typeAny },
    })
      .inferenceRule({
        filter: isAssign,
        matching: () => true,
        operands: (node: Assign) => [node.left.ref!, node.right],
        validation: (node, _operatorName, _operatorType, accept, typir) =>
          typir.validation.Constraints.ensureNodeIsAssignable(
            node.right,
            node.left.ref,
            accept,
            (actual, expected) => ({
              message: `Expression of type '${this.getTypeName(
                actual
              )}' cannot be assigned to variable of type '${this.getTypeName(expected)}'.`,
              languageNode: node,
              languageProperty: "expr",
              severity: "error",
            })
          ),
        validateArgumentsOfCalls: true,
      })
      .finish();
    for (const operator of ["&", "|", "->", "<->"]) {
      typir.factory.Operators.createBinary({
        name: operator,
        signature: { left: typeBool, right: typeBool, return: typeBool },
      })
        .inferenceRule({
          filter: isBinObs,
          matching: (node: BinObs, name: string) => node.operator === name,
          operands: (node: BinObs) => [node.left, node.right],
          validateArgumentsOfCalls: true,
        })
        .finish();
    }
    for (const operator of ["Diamond", "Box"]) {
      typir.factory.Operators.createBinary({
        name: operator,
        signature: { left: typeBool, right: typeBool, return: typeBool },
      })
        .inferenceRule({
          filter: isDiamond,
          matching: (_node: Diamond, name: string) => name === "Diamond",
          operands: (node: Diamond) => [node.obs, node.expr],
          validateArgumentsOfCalls: true,
        })
        .inferenceRule({
          filter: isBox,
          matching: (_node: Box, name: string) => name === "Box",
          operands: (node: Box) => [node.obs, node.expr],
          validateArgumentsOfCalls: true,
        })
        .finish();
    }

    // Inference rule for unary opterators
    type UnaryExpression = UMinus | Neg | Finally | Globally | Next | ForallObs | ExistsObs;
    const isUnaryExpression = (node: AstNode): node is UnaryExpression => {
      return isUMinus(node) || isNeg(node) || isLtolMod(node) || isForallObs(node) || isExistsObs(node);
    };
    const unaryInferenceRule: InferOperatorWithSingleOperand<AstNode, UnaryExpression> = {
      filter: isUnaryExpression,
      matching: (node: UnaryExpression, name: string) => node.operator === name,
      operand: (node: UnaryExpression) => node.expr,
      validateArgumentsOfCalls: true,
    };

    // Unary operators
    typir.factory.Operators.createUnary({ name: "-", signature: { operand: typeInt, return: typeInt } })
      .inferenceRule(unaryInferenceRule)
      .finish();
    for (const operator of ["!", "F", "G", "X", "forall", "exists"]) {
      typir.factory.Operators.createUnary({ name: operator, signature: { operand: typeBool, return: typeBool } })
        .inferenceRule(unaryInferenceRule)
        .finish();
    }

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
      QualifiedRef: (languageNode) => {
        const instance = languageNode.instance.ref;
        if (isInstance(instance)) {
          // Case already handled in class declaration
          return InferenceRuleNotApplicable;
        } else if (isLtolQuant(instance)) {
          if (instance.kinds.some((k) => k.ref?.name === undefined)) {
            throw new Error("Not a valid agent instance.");
          }
          //const agents = instance.kinds.map((k) => typir.factory.Classes.get(k.ref?.name!));
          // TODO: Add inference rule for LtolQuant
          // get fields of all the classes, do set intersection, infer type if still in set
          // else issue warning?
          //const fields = agents[0].getType()?.getFields(false);
          // TODO: return correct type
          return InferenceRuleNotApplicable;
        } else if (instance === undefined) {
          return InferenceRuleNotApplicable;
        } else {
          assertUnreachable(instance);
        }
      },
    });

    // TODO: maybe this validation rule can be implemented upon class creation
    typir.validation.Collector.addValidationRulesForAstNodes({
      Instance: (node, accept, typir) => {
        typir.validation.Constraints.ensureNodeIsAssignable(node.init, typeBool, accept, () => ({
          message: "Agent inititalization needs to evaluate to 'bool'.",
          languageProperty: "init",
          languageNode: node,
        }));
      },
      Ltol: (node, accept, typir) => {
        typir.validation.Constraints.ensureNodeIsAssignable(node.expr, typeBool, accept, () => ({
          message: "SPEC needs to evaluate to 'bool'.",
          languageProperty: "expr",
          languageNode: node,
        }));
      },
      ChannelObs: (node, accept, typir) => {
        // Do not need to check broadcast symbol
        if (node.bcast !== undefined) return;
        typir.validation.Constraints.ensureNodeIsAssignable(node.chan?.ref?.$container, typeChannel, accept, () => ({
          message: "Channel reference needs to evaluate to 'channel'.",
          languageProperty: "chan",
          languageNode: node,
        }));
      },
    });
  }

  onNewAstNode(languageNode: AstNode, typir: TypirLangiumServices<RCheckAstType>): void {
    if (isEnum(languageNode)) {
      // Exclude channel enum here
      if (languageNode.name === "channel") return;

      // The container of Enum node is always the root node
      const documentUri = languageNode.$container.$document!.uri;

      // Create new enum type
      const enumName = `${documentUri}::${languageNode.name}`;
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
        // TODO: This causes the lag in the guard parameters, maybe there is some way
        //       to clear the errors before validating the new astnode
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
      typir.factory.Classes.create({
        className: agentName,
        fields: [
          { name: "automaton-state", type: "int" },
          ...languageNode.locals.map((l) => ({ name: l.name, type: l })),
          ...this.getProcessNames(languageNode).map((n) => ({ name: n, type: "bool" })),
        ],
        methods: [],
      })
        .inferenceRuleForClassDeclaration({
          languageKey: Agent,
          matching: (node: Agent) => languageNode === node,
        })
        .inferenceRuleForFieldAccess({
          languageKey: QualifiedRef,
          matching: (node: QualifiedRef) => {
            const qualifier = node.instance.ref;
            // Handle LtolQuant inference seperately
            if (isLtolQuant(qualifier)) return false;

            return qualifier?.agent.ref === languageNode;
          },
          field: (node: QualifiedRef) => node.variable.ref!.name!,
        })
        .inferenceRuleForFieldAccess({
          languageKey: AutomatonState,
          matching: (node: AutomatonState) => languageNode === node.instance.ref?.agent.ref,
          field: () => "automaton-state",
        })
        .finish();
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
        // TODO: why is this branch reachable??
        //assertUnreachable(process satisfies never);
      }
    }

    return processNames;
  }

  protected getTypeName(type: AnnotatedTypeAfterValidation): string | undefined {
    return type.name.split("::").pop();
  }
}
