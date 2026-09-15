/**
 * @module dsql/coerce
 * @description §6.3 隐式数值转换与值语义的单一事实源
 * （算术 / 比较 / 排序 / TOTAL / 数值函数 / 真值 / UTF-8 字节序共用同一口径）
 */

import { EMPTY, type FieldValue } from "./types";

/**
 * §6.3 隐式数值转换：number 原样；boolean → 1 / 0；数字串 → 数值；
 * 空串 / 全空白 / 非数值串 / 数组 / 对象 / null → null（转不出）。
 *
 * number 不在此判有限性——NaN / ±Infinity 由调用方按 §6.3 处理（算术计入 warnings 后取 null）。
 * 非原始值（数组 / 域对象）由调用方先行守卫，本函数只认原始值。
 *
 * @param v - 待转换字段值
 * @returns 转换出的数值；转不出时返回 null
 */
export function toNumber(v: FieldValue): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** empty 值在除 empty() 外的一切运算中按 null 传播（DSQL 1.5 三值语义）。 */
export function stripEmpty(v: FieldValue): FieldValue {
  return v === EMPTY ? null : v;
}

/** 非原始值判定（数组 / 域对象；null 与原始类型为原始值）。 */
export function isNonPrimitive(v: FieldValue): boolean {
  return Array.isArray(v) || (typeof v === "object" && v !== null);
}

/**
 * 字符串化（连接与排序键共用）：布尔取字面量，其余走 String()。
 *
 * @param v - 待字符串化的值
 * @returns 文本形式
 */
export function stringValue(v: FieldValue): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * == / != ：null 参与 → 同一性（null == null 为 true，其余 false；!= 取反）；
 * 非原始值 → false（守卫写在一切 Number() / 隐式字符串化之前，[5] %==% "5" 不因 toString 漏成 true）；
 * 否则两边都能 Number() 转出有限数（空串 / 全空白视为转不出）→ 数值比；
 * 两边都转不出 → 字符串比（UTF-8 字节序）；一边能转一边不能 → false。
 *
 * @param l - 左值
 * @param r - 右值
 * @returns 是否相等
 */
export function looseEquals(l: FieldValue, r: FieldValue): boolean {
  if (l == null || r == null) return l === r;
  if (isNonPrimitive(l) || isNonPrimitive(r)) return false;
  const ln = toNumber(l);
  const rn = toNumber(r);
  if (ln !== null && rn !== null) return ln === rn;
  if (ln === null && rn === null) return compareUtf8(stringValue(l), stringValue(r)) === 0;
  return false;
}

/** > < >= <= ：口径同 looseEquals（null / 非原始值 → false；同载数值比、同不转字符串比、混合 → false）。 */
export function compareOrdering(op: ">" | "<" | ">=" | "<=", l: FieldValue, r: FieldValue): boolean {
  if (l == null || r == null) return false;
  if (isNonPrimitive(l) || isNonPrimitive(r)) return false;
  const ln = toNumber(l);
  const rn = toNumber(r);
  let c: number;
  if (ln !== null && rn !== null) c = ln - rn;
  else if (ln === null && rn === null) c = compareUtf8(stringValue(l), stringValue(r));
  else return false;
  return op === ">" ? c > 0 : op === "<" ? c < 0 : op === ">=" ? c >= 0 : c <= 0;
}

/**
 * 裸真值判断（DSQL 1.5 三值语义）：empty 值、null、0、false、空串、空数组 → 假；其余一切值为真。
 *
 * @param v - 待判断的值
 * @returns 真值判定结果
 */
export function truthy(v: FieldValue): boolean {
  return (
    v != null && v !== EMPTY && v !== 0 && v !== false &&
    !(Array.isArray(v) && v.length === 0) && v !== ""
  );
}

const utf8Encoder = new TextEncoder();

/**
 * UTF-8 字节序比较（确定性排序）：逐字节比较，公共前缀相等则继续向后比较
 * （递归下降），短字符串在前。例：你好AAAA < 你好AAAB；"a" < "你"（0x61 < 0xE4）。
 *
 * @param a - 左侧字符串
 * @param b - 右侧字符串
 * @returns 负数（a 在前）/ 0（相等）/ 正数（b 在前）
 */
export function compareUtf8(a: string, b: string): number {
  if (a === b) return 0; // 同一性快路径：跳过编码分配
  const ba = utf8Encoder.encode(a);
  const bb = utf8Encoder.encode(b);
  const n = Math.min(ba.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (ba[i] !== bb[i]) return ba[i] - bb[i];
  }
  return ba.length - bb.length;
}
