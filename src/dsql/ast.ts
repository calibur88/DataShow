/**
 * @module dsql/ast
 * @description DSQL v2.0 AST：表达式、数据源、排序子句与查询结构的类型定义
 */

import type { ViewType } from "@dsql/types";

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
  | VariableExpr;

export interface LitExpr {
  kind: "lit";
  value: import("@dsql/types").FieldValue;
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
  priority: import("@dsql/types").FieldValue[] | null;
}

export interface SortClause {
  keys: SortKey[];
  /** 子句级方向（键未指定时使用）；null = asc */
  dir: "asc" | "desc" | null;
}

export interface Query {
  /** DSQL v2.0：TABLE_VIEW / LIST_VIEW / CARD_VIEW；缺省 TABLE_VIEW */
  view: ViewType;
  withoutId: boolean;
  /** "*" = 自动列（结果行字段并集） */
  select: ColumnSel[] | "*";
  from: Source;
  where: Expr | null;
  sort: SortClause | null;
  limit: number | null;
}
