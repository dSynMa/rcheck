import { assertUnreachable, AstNode } from "langium";
import {
  InferenceRuleNotApplicable, InferOperatorWithMultipleOperands,
  InferOperatorWithSingleOperand, isClassType, NO_PARAMETER_NAME, Type,
  TypirServices, ValidationProblemAcceptor
} from "typir";
import {
  LangiumTypeSystemDefinition, TypirLangiumServices
} from "typir-langium";
import {
  Agent, Assign, AutomatonState, BinExpr, BinObs, Box, Diamond, Enum, ExistsObs,
  Finally, ForallObs, Get, Globally, Guard, GuardCall, isAgent, isAssign,
  isBinExpr, isBinObs, isBoolLiteral, isBox, isBroadcast, isCase, isChannelObs,
  isChannelRef, isDiamond, isEnum, isExistsObs, isForallObs, isGet, isGetterObs,
  isGuard, isInstance, isLiteralObs, isLocal, isLtolMod, isLtolQuant, isMsgStruct,
  isMyself, isNeg, isNumberLiteral, isParam, isPropVar, isRange, isReceive,
  isRelabel, isSend, isSenderObs, isSupply, isUMinus, MsgStruct, Neg, Next, Param,
  PropVar, QualifiedRef, RCheckAstType, Receive, Relabel, Send, Supply,
  SupplyLocationExpr, UMinus
} from "./generated/ast.js";
import {
  getClassDetails, getTypeName, intersectMaps, IntRange, isComparisonOp,
  validateAssignment
} from "./util.js";

export class RCheckTypeSystem implements LangiumTypeSystemDefinition<RCheckAstType> {
  onInitialize(typir: TypirLangiumServices<RCheckAstType>): void {
    // Define the primitive types
    const typeBool = typir.factory.Primitives.create({ primitiveName: "bool" })
      .inferenceRule({ filter: isBoolLiteral })
      .inferenceRule({ filter: isLiteralObs })
      .inferenceRule({ filter: isChannelObs })
      .inferenceRule({ filter: isSenderObs })
      .inferenceRule({ filter: isGetterObs })
      .inferenceRule({ filter: isGet })
      .inferenceRule({ filter: isSupply })
      .inferenceRule({ filter: isSend })
      .inferenceRule({ filter: isReceive })
      .inferenceRule({
        languageKey: [Param, MsgStruct, PropVar],
        matching: (node: Param | MsgStruct | PropVar) => node.builtinType === "bool",
      })
      .finish();

    const typeInt = typir.factory.Primitives.create({ primitiveName: "int" })
      .inferenceRule({ filter: isNumberLiteral })
      .inferenceRule({
        languageKey: [Param, MsgStruct, PropVar],
        matching: (node: Param | MsgStruct | PropVar) => node.builtinType === "int",
      })
      .finish();

    const typeRange = typir.factory.Primitives.create({
      primitiveName: "range",
    })
      .inferenceRule({ filter: isRange })
      .inferenceRule({
        languageKey: [Param, MsgStruct, PropVar],
        matching: (node: Param | MsgStruct | PropVar) => node.rangeType !== undefined,
      })
      .finish();

    typir.Conversion.markAsConvertible(typeRange, typeInt, "IMPLICIT_EXPLICIT");

    const typeLocation = typir.factory.Primitives.create({
      primitiveName: "location",
    })
      .inferenceRule({
        languageKey: [Param, MsgStruct, PropVar],
        matching: (node: Param | MsgStruct | PropVar) => node.builtinType === "location",
      })
      .inferenceRule({ filter: isMyself })
      .inferenceRule({
        languageKey: SupplyLocationExpr,
        matching: (node: SupplyLocationExpr) => node.myself !== undefined || node.any !== undefined,
      })
      .inferenceRule({ filter: isInstance })
      .finish();

    const typeChannel = typir.factory.Primitives.create({
      primitiveName: "channel",
    })
      .inferenceRule({ filter: isChannelRef })
      .inferenceRule({ filter: isBroadcast })
      .inferenceRule({
        languageKey: [Param, MsgStruct, PropVar],
        matching: (node: Param | MsgStruct | PropVar) => node.customType?.ref?.name === "channel",
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
        signatures: [
          { left: typeInt, right: typeInt, return: typeInt },
          { left: typeRange, right: typeRange, return: typeRange },
          { left: typeInt, right: typeRange, return: typeRange },
          { left: typeRange, right: typeInt, return: typeRange },
        ],
      })
        .inferenceRule({ ...binaryInferenceRule })
        .finish();
    }
    for (const operator of ["<", "<=", ">", ">="]) {
      typir.factory.Operators.createBinary({
        name: operator,
        signatures: [
          { left: typeInt, right: typeInt, return: typeBool },
          { left: typeRange, right: typeRange, return: typeBool },
          { left: typeInt, right: typeRange, return: typeBool },
          { left: typeRange, right: typeInt, return: typeBool },
        ],
      })
        .inferenceRule(binaryInferenceRule)
        .finish();
    }
    for (const operator of ["&", "|", "->", "U", "R", "W"]) {
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
          validation: (node, _operatorName, _operatorType, accept, typir) => {
            const leftType = typir.Inference.inferType(node.left);
            const rightType = typir.Inference.inferType(node.right);
            if (
              (leftType === typeRange && rightType === typeInt) ||
              (leftType === typeInt && rightType === typeRange) ||
              (leftType === typeRange && rightType === typeRange)
            ) {
              const leftRange = IntRange.fromRangeExpr(node.left);
              const rightRange = IntRange.fromRangeExpr(node.right);
              if (!leftRange.intersects(rightRange)) {
                accept({
                  message: `This comparison will always return '${
                    node.operator === "!=" ? "true" : "false"
                  }' as the ranges '${leftRange}' and '${rightRange}' have no overlap.`,
                  languageNode: node,
                  languageProperty: "operator",
                  severity: "warning",
                });
              }
            } else {
              typir.validation.Constraints.ensureNodeIsEquals(node.left, node.right, accept, (actual, expected) => ({
                message: `This comparison will always return '${node.operator === "!=" ? "true" : "false"}' as '${
                  node.left.$cstNode?.text
                }' and '${node.right.$cstNode?.text}' have the different types '${getTypeName(
                  actual
                )}' and '${getTypeName(expected)}'.`,
                languageNode: node,
                languageProperty: "operator",
                severity: "warning",
              }));
            }
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
        operands: (node: Relabel) => [node.var.ref!, node.expr],
        validation: (node, _operator, _functionType, accept, typir) =>
          validateAssignment(node.var.ref!, node.expr, true, getTypeName, accept, typir),
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
        validation: (node, _operator, _functionType, accept, typir) =>
          validateAssignment(node.left.ref!, node.right, true, getTypeName, accept, typir),
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

    // Inference rule for unary operators
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
    typir.factory.Operators.createUnary({
      name: "-",
      signatures: [
        { operand: typeInt, return: typeInt },
        { operand: typeRange, return: typeRange },
      ],
    })
      .inferenceRule(unaryInferenceRule)
      .finish();
    for (const operator of ["!", "F", "G", "X", "forall", "exists"]) {
      typir.factory.Operators.createUnary({
        name: operator,
        signature: { operand: typeBool, return: typeBool },
      })
        .inferenceRule(unaryInferenceRule)
        .finish();
    }
    // Handle variable references
    typir.Inference.addInferenceRulesForAstNodes({
      Local: (languageNode) => {
        if (languageNode.builtinType === "bool") { return typeBool; }
        else if (languageNode.builtinType === "int") { return typeInt; }
        else if (languageNode.builtinType === "location") { return typeLocation; }
        else if (languageNode.rangeType !== undefined) { return languageNode.rangeType; }
        else if (languageNode.customType !== undefined) {
          const refText = languageNode.customType.$refText;
          if (refText === "channel") { return typeChannel; }
          const documentUri = languageNode.$container.$container.$document?.uri;
          const enumName = `${documentUri}::${refText}`;
          const lookup = typir.factory.Primitives.get({ primitiveName: enumName });
          return lookup !== undefined ? lookup : InferenceRuleNotApplicable;
        }
        return InferenceRuleNotApplicable;
      },
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
          if (instance.kinds.some((k) => k.ref === undefined)) {
            throw new Error("Not a valid agent instance.");
          }

          const agentFields = instance.kinds.map((k) => {
            const agentType = typir.Inference.inferType(k.ref!);

            if (agentType instanceof Type) {
              if (isClassType(agentType)) {
                return agentType.getFields(false);
              } else {
                throw new Error("Encountered unexpected non-class type.");
              }
            } else if (agentType instanceof Array) {
              throw new Error("Encountered duplicate class type.");
            } else {
              assertUnreachable(agentType);
            }
          });

          const intersection = intersectMaps(agentFields);
          const variableType = intersection.get(languageNode.variable.$refText);

          if (variableType === undefined) {
            // Field does not exist on agent intersection
            typir.validation.Collector.addValidationRule((node, accept) => {
              if (node === languageNode) {
                accept({
                  languageNode: node,
                  languageProperty: "variable",
                  severity: "error",
                  message: `Property '${languageNode.variable.$refText}' does not exist on type '${instance.kinds
                    .map((k) => k.ref?.name)
                    .join(" | ")}'.`,
                });
              }
            });
            return typeAny;
          } else {
            return variableType;
          }
        } else if (instance === undefined) {
          return InferenceRuleNotApplicable;
        } else {
          assertUnreachable(instance);
        }
      },
      ChannelExpr: (languageNode) => {
        if (languageNode.bcast !== undefined) {
          return typeChannel;
        } else if (languageNode.channel?.ref !== undefined) {
          return languageNode.channel.ref;
        } else {
          return InferenceRuleNotApplicable;
        }
      },
      GetLocationExpr: (languageNode) => languageNode.predicate,
      SupplyLocationExpr: (languageNode) => {
        const location = languageNode.location?.ref;
        if (location !== undefined) {
          return location;
        } else {
          return InferenceRuleNotApplicable;
        }
      },
    });

    const validateCmdHeader = (
      node: Send | Receive | Get | Supply,
      accept: ValidationProblemAcceptor<AstNode>,
      typir: TypirServices<AstNode>
    ) => {
      typir.validation.Constraints.ensureNodeIsEquals(node.psi, typeBool, accept, (actual, expected) => ({
        message: `Type mismatch in command guard expression: expected '${getTypeName(
          expected
        )}', but got '${getTypeName(actual)}'.`,
        languageProperty: "psi",
        languageNode: node,
      }));
    };
    const validateChannelExpr = (
      node: Send | Receive,
      accept: ValidationProblemAcceptor<AstNode>,
      typir: TypirServices<AstNode>
    ) => {
      typir.validation.Constraints.ensureNodeIsEquals(node.chanExpr, typeChannel, accept, (actual, expected) => ({
        message: `Type mismatch in command channel expression: expected '${getTypeName(
          expected
        )}', but got '${getTypeName(actual)}'.`,
        languageProperty: "chanExpr",
        languageNode: node,
      }));
    };
    const validateSupplyLocation = (
      node: Supply,
      accept: ValidationProblemAcceptor<AstNode>,
      typir: TypirServices<AstNode>
    ) => {
      typir.validation.Constraints.ensureNodeIsEquals(node.where, typeLocation, accept, (actual, expected) => ({
        message: `Type mismatch in command where: expected '${getTypeName(expected)}', but got '${getTypeName(
          actual
        )}'.`,
        languageProperty: "where",
        languageNode: node,
      }));
    };
    const validateGetLocation = (
      node: Get,
      accept: ValidationProblemAcceptor<AstNode>,
      typir: TypirServices<AstNode>
    ) => {
      const actual = typir.Inference.inferType(node.where);
      if (actual instanceof Type && actual.getIdentifier() !== "bool" && actual.getIdentifier() !== "location") {
        accept({
          message: `Type mismatch in command where: expected 'bool | location', but got '${
            actual instanceof Type ? typir.Printer.printTypeName(actual) : "inference problem"
          }'.`,
          languageProperty: "where",
          languageNode: node,
          severity: "error",
        });
      }
    };

    typir.validation.Collector.addValidationRulesForAstNodes({
      Ltol: (node, accept, typir) => {
        typir.validation.Constraints.ensureNodeIsEquals(node.expr, typeBool, accept, () => ({
          message: "SPEC needs to evaluate to 'bool'.",
          languageProperty: "expr",
          languageNode: node,
        }));
      },
      ChannelObs: (node, accept, typir) => {
        // Do not need to check broadcast symbol
        if (node.bcast !== undefined) return;
        typir.validation.Constraints.ensureNodeIsEquals(node.chan?.ref?.$container, typeChannel, accept, () => ({
          message: "Channel reference needs to evaluate to 'channel'.",
          languageProperty: "chan",
          languageNode: node,
        }));
      },
      Send: (node, accept, typir) => {
        validateCmdHeader(node, accept, typir);
        validateChannelExpr(node, accept, typir);
        typir.validation.Constraints.ensureNodeIsEquals(node.sendGuard, typeBool, accept, (actual, expected) => ({
          message: `Type mismatch in command guard: expected '${getTypeName(expected)}', but got '${getTypeName(
            actual
          )}'.`,
          languageProperty: "sendGuard",
          languageNode: node,
        }));
      },
      Receive: (node, accept, typir) => {
        validateCmdHeader(node, accept, typir);
        validateChannelExpr(node, accept, typir);
      },
      Get: (node, accept, typir) => {
        validateCmdHeader(node, accept, typir);
        validateGetLocation(node, accept, typir);
      },
      Supply: (node, accept, typir) => {
        validateCmdHeader(node, accept, typir);
        validateSupplyLocation(node, accept, typir);
      },
      Guard: (node, accept, typir) => {
        typir.validation.Constraints.ensureNodeIsEquals(node.body, typeBool, accept, (actual, expected) => ({
          message: `Type mismatch in guard definition: expected '${getTypeName(expected)}', but got '${getTypeName(
            actual
          )}'.`,
          languageProperty: "body",
          languageNode: node.body,
        }));
      },
      Agent: (node, accept, typir) => {
        typir.validation.Constraints.ensureNodeIsEquals(node.init, typeBool, accept, (actual, expected) => ({
          message: `Type mismatch in agent initialization: expected '${getTypeName(expected)}', but got '${getTypeName(
            actual
          )}'.`,
          languageProperty: "init",
          languageNode: node.init,
        }));
        typir.validation.Constraints.ensureNodeIsEquals(node.recvguard, typeBool, accept, (actual, expected) => ({
          message: `Type mismatch in agent receive-guard: expected '${getTypeName(expected)}', but got '${getTypeName(
            actual
          )}'.`,
          languageProperty: "recvguard",
          languageNode: node.recvguard,
        }));
      },
      Instance: (node, accept, typir) =>
        typir.validation.Constraints.ensureNodeIsEquals(node.init, typeBool, accept, (actual, expected) => ({
          message: `Type mismatch in instance initialization: expected '${getTypeName(
            expected
          )}', but got '${getTypeName(actual)}'.`,
          languageProperty: "init",
          languageNode: node.init,
        })),
      CompoundExpr: (node, accept, typir) => {
        if (node.$type !== "BinExpr" || !isComparisonOp(node.operator)) {
          return;
        }
        const leftType = typir.Inference.inferType(node.left);
        const rightType = typir.Inference.inferType(node.right);
        if ((leftType === typeRange || leftType === typeInt) && (rightType === typeInt || rightType === typeRange)) {
          const leftRange = IntRange.fromRangeExpr(node.left);
          const rightRange = IntRange.fromRangeExpr(node.right);
          const { isAlwaysTrue, isAlwaysFalse } = IntRange.isStaticOutcome(leftRange, rightRange, node.operator);
          if (!isAlwaysTrue && !isAlwaysFalse) {
            return;
          }
          let reason;
          switch (node.operator) {
            case "<":
              reason = isAlwaysTrue
                ? `every value of '${leftRange}' is strictly less than every value of '${rightRange}'`
                : `every value of '${leftRange}' is greater than or equal to every value of '${rightRange}'`;
              break;
            case "<=":
              reason = isAlwaysTrue
                ? `the max of '${leftRange}' is less than or equal to the min of '${rightRange}'`
                : `the min of '${leftRange}' is greater than the max of '${rightRange}'`;
              break;
            case ">":
              reason = isAlwaysTrue
                ? `every value of '${leftRange}' is strictly greater than every value of '${rightRange}'`
                : `every value of '${leftRange}' is less than or equal to every value of '${rightRange}'`;
              break;
            case ">=":
              reason = isAlwaysTrue
                ? `the min of '${leftRange}' is greater than or equal to the max of '${rightRange}'`
                : `the max of '${leftRange}' is less than the min of '${rightRange}'`;
              break;
          }

          accept({
            message: `This comparison will always return '${isAlwaysTrue ? "true" : "false"}' as ${reason}.`,
            languageNode: node,
            languageProperty: "operator",
            severity: "warning",
          });
        }
      },
    });
  }

  onNewAstNode(languageNode: AstNode, typir: TypirLangiumServices<RCheckAstType>): void {
    if (isEnum(languageNode)) {
      // Exclude channel enum here
      if (languageNode.name === "channel") return;
      // The container of Enum node is always the root node
      const documentUri = languageNode.$container.$document!.uri;
      const enumName = `${documentUri}::${languageNode.name}`;

      // Skip type definition in case of duplicates
      if (typir.factory.Primitives.get({ primitiveName: enumName }) !== undefined) return;

      // Create new enum type
      typir.factory.Primitives.create({ primitiveName: enumName })
        .inferenceRule({
          languageKey: [Param, MsgStruct, PropVar],
          matching: (node: Param | MsgStruct | PropVar) => languageNode === node.customType?.ref,
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
        inputParameters: languageNode.params.map((p) => ({
          name: p.name,
          type: p,
        })),
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
      // Skip class definition in case of duplicates
      if (languageNode.name === undefined || typir.factory.Classes.get(languageNode.name).getType() !== undefined) {
        return;
      }

      typir.factory.Classes.create(getClassDetails(languageNode))
        .inferenceRuleForClassDeclaration({
          languageKey: Agent,
          matching: (node: Agent) => languageNode === node,
        })
        .inferenceRuleForFieldAccess({
          languageKey: QualifiedRef,
          matching: (node: QualifiedRef) => {
            const qualifier = node.instance.ref;
            // Handle LtolQuant inference separately
            if (isLtolQuant(qualifier)) return false;

            return qualifier?.agent.ref === languageNode;
          },
          field: (node: QualifiedRef) => node.variable.ref!,
        })
        .inferenceRuleForFieldAccess({
          languageKey: AutomatonState,
          matching: (node: AutomatonState) => languageNode === node.instance.ref?.agent.ref,
          field: () => "automaton-state",
        })
        .finish();
    }
  }
}
