/**
 * @module dsql/types
 * @description DSQL 数据模型与视图类型：行结构、字段值、视图关键词
 * （语言层唯一类型出口，零宿主依赖，可随 DSQL 独立发版）
 */

/**
 * DSQL 视图类型。
 * - TABLE_VIEW / LIST_VIEW / CARD_VIEW 三者平等，均可写入 SQL 并持久化
 * - 旧 TABLE / LIST 关键词在 v2.0 直接抛语法错误，不做兼容
 */
export type ViewType = "TABLE_VIEW" | "LIST_VIEW" | "CARD_VIEW";

/**
 * 视图类型守卫。
 *
 * @param v - 待检查的值
 * @returns 值为三个合法视图类型之一时返回 true
 */
export function isViewType(v: unknown): v is ViewType {
  return v === "TABLE_VIEW" || v === "LIST_VIEW" || v === "CARD_VIEW";
}

/** 内置已实装的视图类型（结果区下拉可选） */
export const IMPLEMENTED_VIEWS = ["TABLE_VIEW", "LIST_VIEW", "CARD_VIEW"] as const;
export type ImplementedView = (typeof IMPLEMENTED_VIEWS)[number];

export const VIEW_LABELS: Record<string, string> = {
  TABLE_VIEW: "表格",
  LIST_VIEW: "列表",
  CARD_VIEW: "卡片",
};

/* ================= 索引层（L2）数据模型 ================= */

/** file.* 虚拟列 */
export interface FileMeta {
  path: string;
  name: string;
  folder: string;
  ext: string;
  size: number;
  ctime: number;
  mtime: number;
  /** 已解析的出链目标路径 */
  outlinks: string[];
  /** 入链来源路径 */
  inlinks: string[];
}

/** 一篇笔记 = 一行 */
export interface DataRow {
  /** vault 内路径（主键） */
  path: string;
  file: FileMeta;
  /** frontmatter 全部键值（数组保持数组；链接解析为路径字符串） */
  fields: Record<string, FieldValue>;
}

/**
 * 域对象（DSQL 2.6）：`<域>` 子查询投影出的一行 = 一组「字段名 → 值」。
 * 仅由域扩展查询（块 `{ }` 语法）产出，frontmatter 不会出现该形态。
 */
export type FieldObject = { [key: string]: FieldValue };

export type FieldValue = string | number | boolean | FieldValue[] | FieldObject | null;

/**
 * DSQL 1.5 empty 值哨兵：字段存在但未赋值（frontmatter `字段:`，冒号后无内容）。
 * 除 empty() 谓词外，一切运算按 null 传播（算术 → null 不计 warning——DSQL 2.2 修订；
 * 比较 → 同一性，真值为假）。
 */
export const EMPTY = Symbol("DSQL:empty") as unknown as FieldValue;

/* ================= DSQL 2.6 域扩展：显示层标记（语言层不做任何判断） ================= */

/**
 * 域扩展 `$槽位$` 值的显示层标记。
 *
 * 域扩展产出两类值，各有一套输出口径，与其余查询的既有口径不同：
 * - **域对象**（唯一的对象值形态，天然可辨）→ `[字段:值][字段:值]`；
 * - **`$槽位$` 值**（`**IN**` 的布尔 / `**DIFF**` 的数组）→ `true` / `金针,铁针`（`,` 无空格）。
 * 后者与普通查询里的布尔（`是`/`否`）、数组（`, ` 连接）形态完全相同，`formatCell` 仅凭值
 * 无法分辨来源，故在域扩展合成行时包一层本标记：`formatCell` 按域口径渲染，
 * `toJsonValue`（JSON 导出）解包为原值——**解析 / 求值 / 执行逻辑均不读它**。
 */
export class DomainSlotValue {
  constructor(readonly value: FieldValue) {}
}

/**
 * 域扩展槽位值标记判定（`render/format` 与 `render/export` 共用）。
 *
 * @param v - 待判定的值
 * @returns 是否为域扩展槽位值标记
 */
export function isDomainSlotValue(v: unknown): v is DomainSlotValue {
  return v instanceof DomainSlotValue;
}
