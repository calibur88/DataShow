/**
 * @module dsql/expr
 * @description 表达式求值（面板渲染单元格与执行器共用）：字段解析 + 算术 / 比较 / 逻辑 / 函数
 *
 * §6.3 口径全部落在 coerce（隐式数值转换 / 真值 / 比较 / 字节序）——文件内不重复实现，
 * 保证「类型不匹配 / 除零 / 缺字段」的非致命语义与 TOTAL / SORT 完全同源。
 */

import type { BinOp, Expr } from "./ast";
import { compareOrdering, isNonPrimitive, looseEquals, stripEmpty, stringValue, toNumber, truthy } from "./coerce";
import { callFunction } from "./functions";
import type { DataRow, FieldValue } from "./types";

/** 字段访问追踪器（调试：记录字段缺失） */
export type FieldTracker = (row: DataRow, path: string, value: FieldValue) => FieldValue;

/** 警告接收器（调试：类型不匹配 / 除零等） */
export type WarnSink = (message: string, type?: string) => void;

/**
 * 求值表达式（面板渲染单元格与执行器共用）。类型不匹配等非致命 → null。
 *
 * @param expr - 表达式 AST
 * @param row - 当前行
 * @param ctx - this 上下文行（无则 null）
 * @param track - 可选字段访问追踪器（调试：记录字段缺失）
 * @param warn - 可选警告接收器（调试：类型不匹配等）
 * @param vars - 可选变量表（$变量$ 取值）
 * @returns 求值结果；非致命错误返回 null
 */
export function evaluateExpr(
  expr: Expr,
  row: DataRow,
  ctx: DataRow | null,
  track?: FieldTracker,
  warn?: WarnSink,
  vars?: ReadonlyMap<string, FieldValue>,
): FieldValue {
  switch (expr.kind) {
    case "lit":
      return expr.value;
    case "variable":
      return vars?.get(expr.name) ?? null;
    case "extFilter":
      // 行级判断（禁止恒 true 的并集偷懒）：exts 为空（[]）→ 恒 true；
      // 否则按该节点自己的 exts 严格相等匹配（原样字符串，无归一化）。
      // [txt] AND [mp4] 由此得空结果；[txt] OR status %==% 'x' 的 OR 意图由此保留。
      return expr.exts.length === 0 || expr.exts.includes(row.file.ext);
    case "field": {
      const v = resolveField(row, expr.path, ctx);
      return track ? track(row, expr.path, v) : v;
    }
    case "call": {
      const args = expr.args.map((a) => evaluateExpr(a, row, ctx, track, warn, vars));
      // 未知函数在词法层拦截（lexer/parser 只放行 FUNCTIONS 表内名字），此处无需兜底
      return callFunction(expr.name, expr.name === "empty" ? args : args.map(stripEmpty));
    }
    case "unary": {
      if (expr.op === "not") return !truthy(evaluateExpr(expr.expr, row, ctx, track, warn, vars));
      // 一元正负号仅作用于数值（§6.3）：非数值 → null，不计 warning
      const v = stripEmpty(evaluateExpr(expr.expr, row, ctx, track, warn, vars));
      return typeof v === "number" ? (expr.op === "-" ? -v : v) : null;
    }
    case "binary":
      return evalBinary(expr.op, expr.left, expr.right, row, ctx, track, warn, vars);
  }
}

function evalBinary(
  op: BinOp,
  left: Expr,
  right: Expr,
  row: DataRow,
  ctx: DataRow | null,
  track?: FieldTracker,
  warn?: WarnSink,
  vars?: ReadonlyMap<string, FieldValue>,
): FieldValue {
  if (op === "and") {
    return truthy(evaluateExpr(left, row, ctx, track, warn, vars)) && truthy(evaluateExpr(right, row, ctx, track, warn, vars));
  }
  if (op === "or") {
    return truthy(evaluateExpr(left, row, ctx, track, warn, vars)) || truthy(evaluateExpr(right, row, ctx, track, warn, vars));
  }
  const l = stripEmpty(evaluateExpr(left, row, ctx, track, warn, vars));
  const r = stripEmpty(evaluateExpr(right, row, ctx, track, warn, vars));

  switch (op) {
    case "==":
      return looseEquals(l, r);
    case "!=":
      return !looseEquals(l, r);
    case ">":
    case "<":
    case ">=":
    case "<=": {
      return compareOrdering(op, l, r);
    }
    case "||":
      return l == null || r == null ? null : `${stringValue(l)}${stringValue(r)}`;
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
    case "^": {
      // null / empty 守卫：结果 null，不计 warning（empty 已在上方 stripEmpty 归 null）
      if (l == null || r == null) return null;
      // 非原始值守卫（数组 / 域对象）：禁止 Number([5]) === 5 式静默转换
      if (isNonPrimitive(l) || isNonPrimitive(r)) {
        warn?.(`算术运算 %${op}% 作用于非原始值（数组 / 域对象）`, "类型不匹配");
        return null;
      }
      const ln = toNumber(l);
      const rn = toNumber(r);
      if (ln === null || rn === null) {
        warn?.(`算术运算 %${op}% 作用于非数字`, "类型不匹配");
        return null;
      }
      return applyArithmetic(op, ln, rn, warn);
    }
  }
  return null;
}

/** 算术求值：除零 / 取模零 → null；结果非有限数（NaN / ±Infinity）→ null（计入 warnings）。 */
function applyArithmetic(op: "+" | "-" | "*" | "/" | "%" | "^", ln: number, rn: number, warn?: WarnSink): FieldValue {
  const fin = (n: number): FieldValue => {
    if (!Number.isFinite(n)) {
      warn?.(`%${op}% 结果非有限数`, "类型不匹配");
      return null;
    }
    return n;
  };
  switch (op) {
    case "+": return fin(ln + rn);
    case "-": return fin(ln - rn);
    case "*": return fin(ln * rn);
    case "/":
      if (rn === 0) { warn?.("%/% 除零", "除零"); return null; }
      return fin(ln / rn);
    case "%":
      if (rn === 0) { warn?.("%%% 取模零", "除零"); return null; }
      return fin(ln % rn);
    case "^": {
      const p = Math.pow(ln, rn);
      if (!Number.isFinite(p)) { warn?.("%^% 结果非有限数（如负数开偶次方）", "类型不匹配"); return null; }
      return p;
    }
  }
}

/**
 * 字段解析：file.* → 文件元数据；this.* → 上下文行；其余 → frontmatter 字段。
 *
 * @param row - 当前行
 * @param path - 字段路径（可含点）
 * @param ctx - this 上下文行（无则 null）
 * @returns 字段值；路径不存在返回 null
 */
export function resolveField(row: DataRow, path: string, ctx: DataRow | null): FieldValue {
  if (path.startsWith("this.")) {
    if (!ctx) return null;
    return resolveOn(ctx, path.slice(5));
  }
  return resolveOn(row, path);
}

function resolveOn(row: DataRow, path: string): FieldValue {
  const parts = path.split(".");
  if (parts[0] === "file") {
    const key = parts[1];
    if (parts.length === 2 && key in row.file) {
      return row.file[key as keyof typeof row.file] as FieldValue;
    }
    return null;
  }
  if (parts.length === 1) return row.fields[parts[0]] ?? null;
  return row.fields[parts[0]] ?? row.fields[path] ?? null;
}
