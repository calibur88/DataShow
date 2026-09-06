/** DSQL v1.2 AST。 */

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
  | BinaryExpr;

export interface LitExpr {
  kind: "lit";
  value: import("../types").FieldValue;
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
}

export interface SortKey {
  expr: Expr;
  /** 键级方向；null = 用子句级方向 */
  dir: "asc" | "desc" | null;
  /** 自定义优先级值列表（**SORT** 键 **BY** (...)），作用于本键 */
  priority: import("../types").FieldValue[] | null;
}

export interface SortClause {
  keys: SortKey[];
  /** 子句级方向（键未指定时使用）；null = asc */
  dir: "asc" | "desc" | null;
}

export interface Query {
  view: "table" | "list";
  withoutId: boolean;
  /** "*" = 自动列（结果行字段并集） */
  select: ColumnSel[] | "*";
  from: Source;
  where: Expr | null;
  sort: SortClause | null;
  limit: number | null;
}
