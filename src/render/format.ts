/**
 * @module render/format
 * @description 结果值显示格式化：三视图与导出共用的单元格文本规则（纯函数，零宿主依赖）
 *
 * 两套口径并存：
 * - **默认口径**（frontmatter / 表达式 / 聚合的既有行为）：null / empty → `—`，数组 → `, ` 连接，
 *   布尔 → `是` / `否`，非整数按位数修剪；
 * - **域扩展口径**（DSQL 2.6，§6.13.7）：域对象 → `[字段:值][字段:值]`（字段间紧邻无分隔，
 *   顺序 = 子域 `**SELECT**` 声明顺序）；`$槽位$` 值 → `true` / `false`、数组 `,` 无空格、
 *   不加 `[]`、空值仍为 `—`。
 *
 * 口径选择由**值形态**决定，调用方不传任何模式参数：域对象是唯一的对象值形态
 * （frontmatter 不会产出对象）；`$槽位$` 值由执行层包一层 `DomainSlotValue` 标记
 * （见 `@dsql/types`），故两种布尔 / 数组形态不会互相污染。
 */

import { EMPTY, isDomainSlotValue } from "@dsql/types";

/**
 * 单元格显示文本（三视图渲染、CSV 导出、结果区搜索文本的唯一出口）。
 * empty 值（`字段:` 未赋值，§6.3）与 null 同口径显示，且不得以 `Symbol(...)` 内部形态外露。
 *
 * @param value - 待格式化的单元格值
 * @param places - 非整数的小数显示位（非法值回落 4）
 * @returns 显示文本
 */
export function formatCell(value: unknown, places = 4): string {
  if (isDomainSlotValue(value)) return formatDomainValue(value.value, places);
  if (value == null || value === EMPTY) return "—";
  if (Array.isArray(value)) return value.map((v) => formatCell(v, places)).join(", ");
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return formatDomainObject(value as Record<string, unknown>, places);
  return formatScalar(value, places);
}

/**
 * 域扩展值 → 文本（`$槽位$` 值即整个值自身；域对象字段值递归走此口径）。
 * 布尔取 `true` / `false`（不转「是 / 否」）；数组元素 `,` 连接、无空格、不加 `[]`。
 */
function formatDomainValue(value: unknown, places: number): string {
  if (value == null || value === EMPTY) return "—";
  if (Array.isArray(value)) return value.map((v) => formatDomainValue(v, places)).join(",");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return formatDomainObject(value as Record<string, unknown>, places);
  return formatScalar(value, places);
}

/**
 * 域对象 → `[字段:值][字段:值]`：每字段独立 `[...]` 包裹、`名:值` 冒号无空格、字段间紧邻无分隔符。
 * 字段顺序取对象的插入顺序（= 子域 `**SELECT**` 的声明顺序）。
 */
function formatDomainObject(obj: Record<string, unknown>, places: number): string {
  return Object.entries(obj)
    .map(([key, item]) => `[${key}:${formatDomainValue(item, places)}]`)
    .join("");
}

/** 标量显示：非整数按位数修剪（非法位数回落 4），其余原样。 */
function formatScalar(value: unknown, places: number): string {
  if (typeof value === "number" && !Number.isInteger(value)) {
    const p = Number.isInteger(places) && places >= 0 && places <= 100 ? places : 4;
    return String(parseFloat(value.toFixed(p)));
  }
  return String(value);
}
