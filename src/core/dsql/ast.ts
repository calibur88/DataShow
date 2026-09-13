/**
 * @module dsql/ast
 * @description DSQL AST：表达式、数据源、SEARCH 抽取项、排序子句与查询结构的类型定义
 */

import type { ViewType } from "./types";

export type BinOp =
  | "==" | "!=" | ">" | "<" | ">=" | "<="   // 比较
  | "||"                                     // 连接
  | "+" | "-" | "*" | "/" | "%" | "^"        // 算术
  | "and" | "or";                            // 逻辑

export type Expr =
  | LitExpr
  | FieldExpr
  | CallExpr
  | UnaryExpr
  | BinaryExpr
  | VariableExpr
  | ExtFilterExpr;

export interface LitExpr {
  kind: "lit";
  value: import("./types").FieldValue;
}

export interface FieldExpr {
  kind: "field";
  /** 字段路径：file.name / this.status / 自定义字段（含中文） */
  path: string;
}

export interface CallExpr {
  kind: "call";
  name: string;
  args: Expr[];
}

export interface UnaryExpr {
  kind: "unary";
  op: "+" | "-" | "not";
  expr: Expr;
}

export interface BinaryExpr {
  kind: "binary";
  op: BinOp;
  left: Expr;
  right: Expr;
}

/** DSQL 1.4：$变量$ 引用（变量命名空间；value 为裸名） */
export interface VariableExpr {
  kind: "variable";
  /** 裸名（书写时 $平均分$ → name "平均分"） */
  name: string;
}

/**
 * [ext] 后缀过滤原子（仅 **WHERE** 表达式合法）：
 * - exts 为原样字符串（不归一化：不去点、不转大小写，匹配时严格相等）；
 * - 空数组 = `[]`（读取范围 ALL 语义；行级求值恒 true）；
 * - 文件级读取范围与按后缀分派见 core/index/ext-source 与执行器 collectExtFilters。
 */
export interface ExtFilterExpr {
  kind: "extFilter";
  exts: string[];
}

/* ---------- 数据源 ---------- */

export type Source = FolderSource | TagSource | OpSource;

export interface FolderSource {
  kind: "folder";
  path: string;
}

export interface TagSource {
  kind: "tag";
  tag: string;
}

export interface OpSource {
  kind: "op";
  op: "and" | "or";
  left: Source;
  right: Source;
}

/* ---------- 查询 ---------- */

export interface ColumnSel {
  expr: Expr;
  alias: string | null;
  /** DSQL 1.4：**TOTAL** 全表聚合项（alias 强制，值进入变量表） */
  total?: true;
}

export interface SortKey {
  expr: Expr;
  /** 键级方向；null = 用子句级方向 */
  dir: "asc" | "desc" | null;
  /** 自定义优先级值列表（**SORT** 键 **BY** (...)），作用于本键 */
  priority: import("./types").FieldValue[] | null;
}

export interface SortClause {
  keys: SortKey[];
  /** 子句级方向（键未指定时使用）；null = asc */
  dir: "asc" | "desc" | null;
}

export interface Query {
  /** v2.0：TABLE_VIEW / LIST_VIEW / CARD_VIEW；缺省 TABLE_VIEW */
  view: ViewType;
  withoutId: boolean;
  /** "*" = 自动列（结果行字段并集） */
  select: ColumnSel[] | "*";
  from: Source;
  /** v2.1：[ext] 后缀过滤（WHERE 原子，见 ExtFilterExpr） */
  where: Expr | null;
  /** DSQL 2.2：SEARCH 正文抽取子句（前件 FROM；执行在 WHERE 之前） */
  search: SearchItemNode[] | null;
  sort: SortClause | null;
  limit: number | null;
}

/**
 * DSQL 2.2 SEARCH 抽取项：正则从行 body 抽内容挂成行字段（与 frontmatter / file.* 平级）。
 * regex 在 parse 期编译一次、运行期复用；line / col 是别名的 token 位置
 * （prepare 期与 frontmatter / file.* 冲突报错用）。
 */
export interface SearchItemNode {
  /** 正则源（STRING 内容原样，转义规则见词法 §三） */
  pattern: string;
  /** parse 期编译产物（非法正则 / 未转义 \p{ 在 parse 期致命错误） */
  regex: RegExp;
  /** 裸标识符别名（挂到行字段的名） */
  alias: string;
  line: number;
  col: number;
}
