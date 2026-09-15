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
  /** DSQL 1.4：**TOTAL** 全表聚合项（**AS** 强制 `$槽位$`，值进入变量表）；聚合项自声明自投影（§6.7） */
  total?: true;
  /** DSQL 2.4：**AS** `$变量$` 输出别名（变量命名空间；与行字段池互不校验——两池隔离，§6.7） */
  aliasVar?: true;
  /** DSQL 2.3：裸 $x$ 槽位声明项（expr 为 variable 且无别名）；由 TOTAL / COUNT 填充，未填充静默忽略 */
  slot?: true;
}

export interface SortKey {
  expr: Expr;
  /** 键级方向；null = 默认 `**ASC**`（§6.4；方向写在末尾时归属最后一个键） */
  dir: "asc" | "desc" | null;
  /** 自定义优先级值列表（**SORT** 键 **BY** (...)），作用于本键 */
  priority: import("./types").FieldValue[] | null;
}

export interface SortClause {
  keys: SortKey[];
}

/**
 * DSQL 2.4 WHILE 循环驱动子句：`**WHILE** [起始, 结束]`。
 * 形态唯一（两个 NUMBER 字面量、方括号包裹、逗号分隔）；两边界须为非负整数且 起始 < 结束，
 * 均由 parse 期静态校验（违反即 parse 期致命）；迭代次数 = 结束 - 起始。
 * 无轮次变量：起始的绝对值不影响结果，只决定迭代次数。
 */
export interface WhileNode {
  /** 起始边界（非负整数字面量，parse 期校验） */
  start: number;
  /** 结束边界（非负整数字面量，parse 期校验，须大于起始） */
  end: number;
  /** **WHILE** 关键字的 token 位置（解析期错误定位用） */
  line: number;
  col: number;
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
  /** DSQL 2.2：SEARCH 正文抽取子句（DSQL 2.4 起前件为 WHILE；执行在聚合遍之前） */
  search: SearchItemNode[] | null;
  /** DSQL 2.4：WHILE 循环驱动子句（前件 FROM；与 SEARCH 必须同时出现） */
  while: WhileNode | null;
  /** DSQL 2.3：COUNT 分类计数子句（前件 FROM；执行在 WHERE 之后、SORT 之前） */
  count: CountItemNode[] | null;
  sort: SortClause | null;
  limit: number | null;
  /**
   * DSQL 2.6：域扩展查询（顶层 `**SELECT** <域>` + 块 `{ }`）。
   * 非 null 时走域扩展算法（本结构的其余旧字段仅为占位），null 时走 DSQL 2.5 旧算法。
   */
  domains?: DomainQuery | null;
}

/**
 * DSQL 2.3 COUNT 计数项：显式比较语句在 WHERE 过滤后行集上求真计数（标量），
 * 填充 SELECT 声明的 $槽位$。line / col 是槽位的 token 位置（parse 期冲突错误用）。
 */
export interface CountItemNode {
  /** 显式比较（cmp_op 二元节点；裸操作数 parse 期致命） */
  cmp: BinaryExpr;
  /** 目标槽位名（裸名） */
  slot: string;
  line: number;
  col: number;
}

/**
 * DSQL 2.2 SEARCH 抽取项：正则从行 body 抽内容挂成行字段（与 frontmatter / file.* 平级）。
 * DSQL 2.4 起由 WHILE 驱动迭代：每轮迭代各模板游标推进一次，取第 k 个匹配
 * （不足 → 补 null，不提前停）；起始匹配仍是首个匹配。
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

/* ---------- DSQL 2.6 域扩展（块 { } 语法） ---------- */

/** 顶层 `**SELECT**` 项：只接受单级 `<域>` 或 `$槽位$`（`<域>::字段` 为语法错误） */
export interface DomainRef {
  kind: "domain";
  /** 域名（不含尖括号） */
  name: string;
  line: number;
  col: number;
}

export interface SlotRef {
  kind: "slot";
  /** 槽位裸名 */
  name: string;
  line: number;
  col: number;
}

export type TopSelectItem = DomainRef | SlotRef;

/** 跨域引用 `<域>::字段`（词法层保证只允许一级） */
export interface CrossRef {
  domain: string;
  field: string;
  line: number;
  col: number;
}

/** **YIELD** 运算符：**IN** 单射拆分逐元素判断 / **DIFF** 左参全集减右参逐行值 */
export type YieldOp = "in" | "diff";

export interface YieldItem {
  op: YieldOp;
  left: CrossRef;
  right: CrossRef;
  /** 输出槽位裸名；null = 无 **AS**（无绑定、不投影，计算照常执行） */
  slot: string | null;
  line: number;
  col: number;
}

export interface YieldClause {
  items: YieldItem[];
  line: number;
  col: number;
}

/** 子查询 `**SELECT**` 字段项：裸标识符（行字段）或单级 `<域>`（域引用） */
export type SubFieldRef =
  | { kind: "field"; name: string }
  | { kind: "domain"; name: string; line: number; col: number };

/** 子查询：`**SELECT** select_list **FROM** source [**WHERE** expr]`（**FROM** 必填） */
export interface SubQuery {
  select: SubFieldRef[];
  from: Source;
  where: Expr | null;
}

/** 子域：`{ sub_select { subdomain } } **AS** <域>`（**AS** 必填） */
export interface SubDomain {
  sub: SubQuery;
  /** 嵌套子域（有序） */
  children: SubDomain[];
  /** 域名（`**AS** <域>` 的裸名） */
  name: string;
  /** `<域>` token 位置（未声明域 / 不外暴露等错误定位用） */
  line: number;
  col: number;
}

/** 块内条目（保持文本顺序：**YIELD** 严格查找依赖它） */
export type BlockItem =
  | { kind: "subdomain"; node: SubDomain }
  | { kind: "yield"; node: YieldClause };

/** 域绑定（语义分析产物；同名域在不同层各为独立绑定） */
export interface DomainBinding {
  /** 绑定唯一编号（按声明顺序） */
  id: number;
  name: string;
  /** 父作用域绑定 id（根块子域为 null） */
  parent: number | null;
  /** 嵌套深度（根块子域为 0） */
  depth: number;
  /** 求值顺序（拓扑序，越小越先算——子查询 SELECT 前向引用不构成文本序约束） */
  order: number;
  sub: SubQuery;
  /** 与 `sub.select` 一一对应的域引用解析结果（-1 = 该位是行字段，其余为绑定 id） */
  refs: number[];
  /** 嵌套子域绑定 id（有序） */
  children: number[];
}

/** 顶层投影列：单级 `<域>` 或 **YIELD** 填充的 `$槽位$` */
export type DomainColumn =
  | { kind: "domain"; def: number; alias: string }
  | { kind: "slot"; slot: string; alias: string };

/** **YIELD** 项（域引用已解析为绑定 id） */
export interface DomainYieldItem {
  op: YieldOp;
  left: { def: number; field: string };
  right: { def: number; field: string };
  slot: string | null;
}

/** 域扩展查询的语义分析产物（执行期直接消费） */
export interface DomainPlan {
  bindings: DomainBinding[];
  columns: DomainColumn[];
  yields: DomainYieldItem[];
  /** 参与行展开（笛卡尔积）的域绑定 id（按声明序去重；无 **YIELD** 时 = 根块全部子域） */
  rowDomains: number[];
}

/** 域扩展查询（有 block 时替代旧算法；无 block 的查询不构造本节点） */
export interface DomainQuery {
  select: TopSelectItem[];
  block: BlockItem[];
  plan: DomainPlan;
}
