/**
 * @module dsql/coerce
 * @description §6.3 隐式数值转换的单一事实源（算术 / 比较 / 排序 / TOTAL / 数值函数共用同一口径）
 */

import type { FieldValue } from "./types";

/**
 * §6.3 隐式数值转换：number 原样；boolean → 1 / 0；数字串 → 数值；
 * 空串 / 全空白 / 非数值串 / 数组 / null → null（转不出）。
 *
 * number 不在此判有限性——NaN / ±Infinity 由调用方按 §6.3 处理（算术计入 warnings 后取 null）。
 * 非原始值（数组）由调用方先行守卫，本函数只认原始值。
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
