/**
 * @module dsql/types
 * @description 全局共享类型与常量（唯一类型出口）：数据模型、看板定义与校形
 */

export const SIDEBAR_VIEW_TYPE = "datashow-sidebar-view";
export const PANEL_VIEW_TYPE = "datashow-panel-view";

/**
 * DSQL v2.0 视图类型。
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

/**
 * 看板定义：数据即 DSQL（DataShow Query Language），在看板面板中编辑，
 * 设置页只维护看板的身份信息（名称/类型/说明）。
 */
export interface BoardDef extends Record<string, unknown> {
  id: string;
  /** 看板名称（侧栏显示名） */
  name: string;
  /**
   * 看板分类（用户自由填写，侧栏分组依据）。
   * 与 ViewType 解耦——本字段是中文/自由分类，不是视图类型。
   */
  type: string;
  /** 看板作用描述 */
  description: string;
  /** DSQL 查询语句 */
  sql: string;
  /**
   * 视图模式覆盖（v2.0 重命名自 viewOverride）。
   * - "" = 跟随 SQL（缺省 TABLE_VIEW，详见 DSQL-EBNF.md）
   * - "TABLE_VIEW" / "LIST_VIEW" / "CARD_VIEW" = 强制覆盖
   */
  viewType: ViewType | "";
}

export interface DatashowSettings {
  /** 看板面板在新标签页打开；关闭则复用已有面板标签 */
  openInNewTab: boolean;
  /** 显示 DSQL 调试信息（每操作信息、字段找不到等），默认开 */
  showDebug: boolean;
  /** 数值列非整数显示的小数位（非负整数；超过浮点精度重置默认 4，仅显示层） */
  decimalPlaces: number;
  /** 看板定义（在设置中管理） */
  boards: BoardDef[];
}

/**
 * 生成看板唯一 ID。
 *
 * @returns 优先 crypto.randomUUID；不支持的环境退化为时间戳 + 随机串
 */
export function makeBoardId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 首次安装时的默认看板：名为「默认看板」，内容为空。
 *
 * @returns 空白看板定义
 */
export function makeDefaultBoard(): BoardDef {
  return {
    id: makeBoardId(),
    name: "默认看板",
    type: "",
    description: "",
    sql: "",
    viewType: "",
  };
}

export const DEFAULT_SETTINGS: DatashowSettings = {
  openInNewTab: true,
  showDebug: false,
  decimalPlaces: 4,
  boards: [makeDefaultBoard()],
};

/** 面板视图的状态：当前展示的看板 id */
export interface PanelViewState extends Record<string, unknown> {
  boardId: string;
}

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

export type FieldValue = string | number | boolean | FieldValue[] | null;

/**
 * DSQL 1.5 empty 值哨兵：字段存在但未赋值（frontmatter `字段:`，冒号后无内容）。
 * 除 empty() 谓词外，一切运算按 null 传播（算术 → null + warning，比较 → false，真值为假）。
 */
export const EMPTY = Symbol("DSQL:empty") as unknown as FieldValue;

/**
 * 载入设置时的看板字段校形：缺失字段补默认值，不认识的字段丢弃。
 *
 * 字段迁移（R2 修订）：
 *   1. `viewType` 合法 → 直接采用
 *   2. `viewType` 非法/空，但 `viewOverride` 合法 → 采用 `viewOverride`（旧数据兼容）
 *   3. 两者均非法/空 → ""
 *
 * `type` 字段不校验——保持自由分类语义（与 ViewType 解耦）。
 *
 * @param raw - 载入的原始看板字段（data.json 中未经校验的数据）
 * @returns 校形后的看板定义
 */
export function normalizeBoard(raw: Record<string, unknown>): BoardDef {
  const viewTypeRaw = typeof raw.viewType === "string" ? raw.viewType : "";
  const viewOverrideRaw = typeof raw.viewOverride === "string" ? raw.viewOverride : "";
  const finalViewType: ViewType | "" = isViewType(viewTypeRaw)
    ? viewTypeRaw
    : isViewType(viewOverrideRaw)
      ? viewOverrideRaw
      : "";
  return {
    id: typeof raw.id === "string" ? raw.id : makeBoardId(),
    name: typeof raw.name === "string" ? raw.name : "未命名看板",
    type: typeof raw.type === "string" ? raw.type : "",
    description: typeof raw.description === "string" ? raw.description : "",
    sql: typeof raw.sql === "string" ? raw.sql : "",
    viewType: finalViewType,
  };
}
