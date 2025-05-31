import { LangiumTypeSystemDefinition, TypirLangiumServices } from "typir-langium";
import {
  Agent,
  Assign,
  AutomatonState,
  BaseProcess,
  BinExpr,
  BinObs,
  Box,
  CompoundExpr,
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
  isPropVarRef,
  isQualifiedRef,
  isRange,
  isReceive,
  isRef,
  isRelabel,
  isRep,
  isSend,
  isSenderObs,
  isSequence,
  isSupply,
  isTarget,
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
  Target,
  UMinus,
} from "./generated/ast.js";
import { assertUnreachable, AstNode } from "langium";
import {
  AnnotatedTypeAfterValidation,
  ClassTypeDetails,
  InferOperatorWithMultipleOperands,
  InferOperatorWithSingleOperand,
  InferenceRuleNotApplicable,
  NO_PARAMETER_NAME,
  Type,
  TypirServices,
  ValidationProblemAcceptor,
  isClassType,
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
        matching: (node: Local | Param | MsgStruct | PropVar) => node.builtinType === "int",
      })
      .finish();

    const typeRange = typir.factory.Primitives.create({ primitiveName: "range" })
      .inferenceRule({ filter: isRange })
      .inferenceRule({
        languageKey: [Local, Param, MsgStruct, PropVar],
        matching: (node: Local | Param | MsgStruct | PropVar) => node.rangeType !== undefined,
      })
      .finish();

    typir.Conversion.markAsConvertible(typeRange, typeInt, "IMPLICIT_EXPLICIT");

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
                }' and '${node.right.$cstNode?.text}' have the different types '${this.getTypeName(
                  actual
                )}' and '${this.getTypeName(expected)}'.`,
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
          this.validateAssignment(node, this.getTypeName, accept, typir),
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
          this.validateAssignment(node, this.getTypeName, accept, typir),
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

          const intersection = this.intersectMaps(agentFields);
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
    });

    // TODO: maybe this validation rule can be implemented upon class creation
    typir.validation.Collector.addValidationRulesForAstNodes({
      Instance: (node, accept, typir) => {
        typir.validation.Constraints.ensureNodeIsEquals(node.init, typeBool, accept, () => ({
          message: "Agent initialization needs to evaluate to 'bool'.",
          languageProperty: "init",
          languageNode: node,
        }));
      },
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
        //       to clear the errors before validating the new AstNode
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
      // Skip class definition in case of duplicates
      if (languageNode.name === undefined || typir.factory.Classes.get(languageNode.name).getType() !== undefined) {
        return;
      }

      typir.factory.Classes.create(this.getClassDetails(languageNode))
        .inferenceRuleForClassDeclaration({
          languageKey: Agent,
          matching: (node: Agent) => languageNode === node,
          validation: (node, type, accept, typir) => {
            // TODO: add validation for agents here?
          },
        })
        .inferenceRuleForFieldAccess({
          languageKey: QualifiedRef,
          matching: (node: QualifiedRef) => {
            const qualifier = node.instance.ref;
            // Handle LtolQuant inference separately
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

  protected getClassDetails(agent: Agent): ClassTypeDetails<AstNode> {
    const fieldNames = new Set<string>(["automaton-state"]);

    const locals = agent.locals
      .map((l) => {
        if (fieldNames.has(l.name)) {
          return undefined;
        }
        fieldNames.add(l.name);
        return { name: l.name, type: l };
      })
      .filter((l): l is { name: string; type: Local } => l !== undefined);

    const processes = this.getProcessNames(agent)
      .map((n) => {
        if (fieldNames.has(n)) {
          return undefined;
        }
        fieldNames.add(n);
        return { name: n, type: "bool" };
      })
      .filter((p): p is { name: string; type: string } => p !== undefined);

    return {
      className: agent.name,
      fields: [{ name: "automaton-state", type: "int" }, ...processes, ...locals],
      methods: [],
    };
  }

  protected getProcessNames(agent: Agent): string[] {
    const stack: (BaseProcess | Sequence)[] = [agent.repeat];
    const processNames: string[] = [];

    while (stack.length !== 0) {
      const process = stack.pop();
      if (isSend(process) || isReceive(process) || isGet(process) || isSupply(process)) {
        if (process.name) {
          processNames.push(process.name);
        }
      }
      if (isChoice(process) || isSequence(process)) {
        stack.push(process.left);
        if (process.right !== undefined) {
          stack.push(process.right);
        }
      }
      if (isRep(process)) {
        stack.push(process.process);
      }
    }

    return processNames;
  }

  protected getTypeName(type: AnnotatedTypeAfterValidation): string | undefined {
    return type.name.split("::").pop();
  }

  protected intersectMaps<K, V>(maps: Map<K, V>[]): Map<K, V> {
    if (maps.length === 0) {
      return new Map<K, V>();
    }
    if (maps.length === 1) {
      return new Map(maps[0]);
    }

    const resultMap = new Map<K, V>();
    const firstMap = maps[0];

    // Iterate over the entries of the first map
    for (const [key, value] of firstMap.entries()) {
      let isInAllMaps = true;

      // Check if this key exists in all other maps with the same value
      for (let i = 1; i < maps.length; i++) {
        const currentMap = maps[i];
        if (!currentMap.has(key) || currentMap.get(key) !== value) {
          isInAllMaps = false;
          break;
        }
      }
      // If the key and value matched across all maps, add it to the result
      if (isInAllMaps) {
        resultMap.set(key, value);
      }
    }

    return resultMap;
  }

  protected validateAssignment(
    node: Relabel | Assign,
    getTypeName: (type: AnnotatedTypeAfterValidation) => string | undefined,
    accept: ValidationProblemAcceptor<AstNode>,
    typir: TypirServices<AstNode>
  ) {
    const targetNode = isRelabel(node) ? node.var.ref! : node.left.ref!;
    const exprNode = isRelabel(node) ? node.expr : node.right;
    const property = isRelabel(node) ? "var" : "left";

    const typeInt = typir.factory.Primitives.get({ primitiveName: "int" });
    const typeRange = typir.factory.Primitives.get({ primitiveName: "range" });

    const targetType = typir.Inference.inferType(targetNode);
    const exprType = typir.Inference.inferType(exprNode);

    if ((targetType === typeRange && exprType === typeInt) || (targetType === typeRange && exprType === typeRange)) {
      const targetRange = IntRange.fromRangeExpr(targetNode);
      const exprRange = IntRange.fromRangeExpr(exprNode);

      if (!targetRange.contains(exprRange)) {
        accept({
          message: `Range variable cannot be ${
            property === "var" ? "relabeled" : "assigned"
          } as the range '${targetRange}' does not contain the range of the expression '${exprRange}'.`,
          languageNode: node,
          languageProperty: property,
          severity: "error",
        });
      }
    } else {
      typir.validation.Constraints.ensureNodeIsAssignable(exprNode, targetNode, accept, (actual, expected) => ({
        message: `${property === "var" ? "Variable" : "Expression"} of type '${getTypeName(
          property === "var" ? expected : actual
        )}' cannot be ${
          property === "var" ? "relabeled with expression of type" : "assigned to variable of type"
        } '${getTypeName(property === "var" ? actual : expected)}'.`,
        languageNode: node,
        languageProperty: property,
        severity: "error",
      }));
    }
  }
}

class IntRange {
  private lower: number;
  private upper: number;

  constructor(lower: number, upper: number) {
    this.lower = lower;
    this.upper = upper;
  }

  // TODO: make this iterative?
  public static fromRangeExpr(expr: CompoundExpr | PropVar | Target): IntRange {
    if (isRef(expr) || isPropVar(expr) || isPropVarRef(expr) || isTarget(expr) || isQualifiedRef(expr)) {
      const decl = isPropVar(expr) || isTarget(expr) ? expr : expr.variable.ref;
      if (isLocal(decl) || isParam(decl) || isMsgStruct(decl) || isPropVar(decl)) {
        if (decl.rangeType !== undefined) {
          return new this(decl.rangeType.lower, decl.rangeType.upper);
        } else if (decl.builtinType === "int") {
          return new this(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
        } else {
          throw new Error(
            `Encountered declaration with unexpected type: ${decl.builtinType ?? decl.customType?.ref?.name}.`
          );
        }
      } else {
        throw new Error("Unexpected target found.");
      }
    } else if (isNumberLiteral(expr)) {
      return new this(expr.value, expr.value);
    } else if (isBinExpr(expr)) {
      const leftRange = IntRange.fromRangeExpr(expr.left);
      const rightRange = IntRange.fromRangeExpr(expr.right);
      switch (expr.operator) {
        case "+":
          return leftRange.plus(rightRange);
        case "-":
          return leftRange.minus(rightRange);
        case "*":
          return leftRange.times(rightRange);
        case "/":
          return leftRange.dividedBy(rightRange);
        default:
          throw new Error("Unexpected operator found.");
      }
    } else if (isUMinus(expr)) {
      return new this(0, 0).minus(IntRange.fromRangeExpr(expr.expr));
    } else {
      throw new Error(`Unexpected expression found: '${expr.$type}'.`);
    }
  }

  public plus(other: IntRange): IntRange {
    return new IntRange(this.lower + other.lower, this.upper + other.upper);
  }

  public minus(other: IntRange): IntRange {
    return new IntRange(this.lower - other.upper, this.upper - other.lower);
  }

  public times(other: IntRange): IntRange {
    const p1 = this.lower * other.lower;
    const p2 = this.lower * other.upper;
    const p3 = this.upper * other.lower;
    const p4 = this.upper * other.upper;
    return new IntRange(Math.min(p1, p2, p3, p4), Math.max(p1, p2, p3, p4));
  }

  public dividedBy(other: IntRange): IntRange {
    if (other.lower === 0 || other.upper === 0) {
      throw new Error("Division by a range that includes zero is not supported.");
    }
    const d1 = Math.trunc(this.lower / other.lower);
    const d2 = Math.trunc(this.lower / other.upper);
    const d3 = Math.trunc(this.upper / other.lower);
    const d4 = Math.trunc(this.upper / other.upper);

    return new IntRange(Math.min(d1, d2, d3, d4), Math.max(d1, d2, d3, d4));
  }

  public intersects(other: IntRange): boolean {
    return this.lower <= other.upper && other.lower <= this.upper;
  }

  public contains(other: IntRange): boolean {
    return this.lower <= other.lower && this.upper >= other.upper;
  }

  public toString(): string {
    if (isFinite(this.lower) && isFinite(this.upper)) {
      return this.lower === this.upper ? `${this.lower}` : `${this.lower}..${this.upper}`;
    }
    return "int";
  }
}
