/**
 * @module dsql/functions
 * @description DSQL 内置函数：sqrt/cbrt/root/contains/length/lower/upper/empty 的注册与调用
 */

import { EMPTY, type FieldValue } from "@dsql/types";

/**
 * 调用内置函数（args 为已求值的参数）。参数不合法一律返回 null（非致命，不抛错）。
 *
 * @param name - 函数名（词法层已标记的小写函数名）
 * @param args - 已求值的参数列表
 * @returns 函数计算结果；未知函数或参数不合法时返回 null
 */
export function callFunction(name: string, args: FieldValue[]): FieldValue {
  const fn = FUNCTIONS[name];
  if (!fn) return null; // 非致命：未知函数（词法层已拦截绝大多数）
  return fn(...args);
}

type Fn = (...args: FieldValue[]) => FieldValue;

const num = (v: FieldValue): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const safe = (v: number): FieldValue => (Number.isFinite(v) ? v : null);

const FUNCTIONS: Record<string, Fn> = {
  sqrt: (x) => {
    const n = num(x);
    return n == null || n < 0 ? null : safe(Math.sqrt(n));
  },
  cbrt: (x) => {
    const n = num(x);
    return n == null ? null : safe(Math.cbrt(n));
  },
  root: (x, nArg) => {
    const v = num(x);
    const n = num(nArg);
    if (v == null || n == null || n === 0) return null;
    if (v < 0 && Math.abs(n % 2) !== 1) return null; // 负数仅奇数次方根有意义
    return safe(v < 0 ? -Math.pow(-v, 1 / n) : Math.pow(v, 1 / n));
  },
  contains: (haystack, needle) => contains(haystack, needle),
  length: (value) => {
    if (Array.isArray(value)) return value.length;
    if (typeof value === "string") return value.length;
    return null;
  },
  lower: (value) => (typeof value === "string" ? value.toLowerCase() : value),
  upper: (value) => (typeof value === "string" ? value.toUpperCase() : value),
  // DSQL 1.5：当且仅当 x 为 empty 值（字段存在但未赋值）时 true；
  // ""、[]、0、false、null、缺失字段均 false —— empty 不处理字符串与数组，仅兜底「未赋值」
  empty: (value) => value === EMPTY,
};

/** v1.2：区分大小写。数组用严格相等匹配元素；字符串用子串包含。 */
function contains(haystack: FieldValue, needle: FieldValue): FieldValue {
  if (needle == null) return false;
  if (Array.isArray(haystack)) return haystack.some((item) => item === needle);
  if (typeof haystack === "string") return haystack.includes(String(needle));
  return false;
}
