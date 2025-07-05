import { NodeFileSystem } from "langium/node";
import { extractAstNode } from "../cli/cli-util.js";
import { Agent, Assign, BaseProcess, BinExpr, CompoundExpr, isBinExpr, isChoice, isGet, isLocal, isMsgStruct, isNumberLiteral, isParam, isPropVar, isPropVarRef, isQualifiedRef, isReceive, isRef, isRelabel, isRep, isSend, isSequence, isSupply, isTarget, isUMinus, Local, Model, PropVar, Relabel, Sequence, Target } from "./generated/ast.js";
import { createRCheckServices } from "./r-check-module.js";
import { AstNode } from "langium";
import { ClassTypeDetails, AnnotatedTypeAfterValidation, ValidationProblemAcceptor, TypirServices } from "typir";

export async function parseToJson(fileName: string) {
    const services = createRCheckServices(NodeFileSystem).RCheck;
    const model = await extractAstNode<Model>(fileName, services);
    return JSON.stringify(model, getAstReplacer());
}

export function parseToJsonSync(fileName: string) { 
    let result = "";
    (async () => await parseToJson(fileName).then((x) => result = x))();
    return result;
}

const getAstReplacer = () => {
    /**
     * Used with JSON.stringify() to make a JSON of a Langium AST.
     */

    // Extra measure to remove circular references. See
    // https://stackoverflow.com/a/53731154
    const seen = new WeakSet();
    return (key: any, value: any) => {
        // Remove Langium nodes that we won't need
        if (
            key === "references" || key === "$cstNode" || key === "$refNode" ||
            key === "_ref" || key === "ref"
            ||
            key === "$nodeDescription" || key === "_nodeDescription") {
            return;
        }
        // Remove seen nodes
        if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }
        return value;
    };
};

type ComparisonOp = "<" | "<=" | ">" | ">=";

export class IntRange {
  private lower: number;
  private upper: number;

  constructor(lower: number, upper: number) {
    this.lower = lower;
    this.upper = upper;
  }

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

  public static isStaticOutcome(
    leftRange: IntRange,
    rightRange: IntRange,
    operator: ComparisonOp
  ): { isAlwaysTrue: boolean; isAlwaysFalse: boolean } {
    switch (operator) {
      case "<":
        return {
          isAlwaysTrue: leftRange.upper < rightRange.lower,
          isAlwaysFalse: leftRange.lower >= rightRange.upper,
        };
      case "<=":
        return {
          isAlwaysTrue: leftRange.upper <= rightRange.lower,
          isAlwaysFalse: leftRange.lower > rightRange.upper,
        };
      case ">":
        return {
          isAlwaysTrue: leftRange.lower > rightRange.upper,
          isAlwaysFalse: leftRange.upper <= rightRange.lower,
        };
      case ">=":
        return {
          isAlwaysTrue: leftRange.lower >= rightRange.upper,
          isAlwaysFalse: leftRange.upper < rightRange.lower,
        };
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

export const isComparisonOp = (o: BinExpr["operator"]): o is ComparisonOp => {
  return o === "<" || o === "<=" || o === ">" || o === ">=";
};

export const getClassDetails = (agent: Agent): ClassTypeDetails<AstNode> => {
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

  const processes = getProcessNames(agent)
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
};

export const getProcessNames = (agent: Agent): string[] => {
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
};

export const getTypeName = (type: AnnotatedTypeAfterValidation): string | undefined => {
  return type.name.split("::").pop();
};

export const intersectMaps = <K, V>(maps: Map<K, V>[]): Map<K, V> => {
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
};

export const validateAssignment = (
  node: Relabel | Assign,
  getTypeName: (type: AnnotatedTypeAfterValidation) => string | undefined,
  accept: ValidationProblemAcceptor<AstNode>,
  typir: TypirServices<AstNode>
) => {
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
          property === "var" ? "relabelled" : "assigned"
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
        property === "var" ? "relabelled with expression of type" : "assigned to variable of type"
      } '${getTypeName(property === "var" ? actual : expected)}'.`,
      languageNode: node,
      languageProperty: property,
      severity: "error",
    }));
  }
};
