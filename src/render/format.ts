/**
 * @module render/format
 * @description 结果值显示格式化：三视图与导出共用的单元格文本规则（纯函数，零宿主依赖）
 */

import { EMPTY } from "@dsql/types";

/**
 * 单元格显示文本：null / empty 值 → —，数组 → 逗号连接，布尔 → 是/否，非整数按位数修剪，其余原样。
 * empty 值（`字段:` 未赋值，§6.3）与 null 同口径显示，且不得以 `Symbol(...)` 内部形态外露
 * （唯一出口，三视图渲染与 CSV 导出共用）。
 *
 * @param value - 待格式化的单元格值
 * @param places - 非整数的小数显示位（非法值回落 4）
 * @returns 显示文本
 */
export function formatCell(value: unknown, places = 4): string {
  if (value == null || value === EMPTY) return "—";
  if (Array.isArray(value)) return value.map((v) => formatCell(v, places)).join(", ");
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number" && !Number.isInteger(value)) {
    const p = Number.isInteger(places) && places >= 0 && places <= 100 ? places : 4;
    return String(parseFloat(value.toFixed(p)));
  }
  return String(value);
}
