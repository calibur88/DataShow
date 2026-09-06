/** 全局共享类型与常量（唯一类型出口）。 */

export const SIDEBAR_VIEW_TYPE = "datashow-sidebar-view";
export const PANEL_VIEW_TYPE = "datashow-panel-view";

/** 内置已实装的视图类型（结果区下拉可选） */
export const IMPLEMENTED_VIEWS = ["table", "list"] as const;
export type ImplementedView = (typeof IMPLEMENTED_VIEWS)[number];

export const VIEW_LABELS: Record<string, string> = {
  table: "表格",
  list: "列表",
};

/**
 * 看板定义：数据即 DSQL（DataShow Query Language），在看板面板中编辑，
 * 设置页只维护看板的身份信息（名称/类型/说明）。
 */
export interface BoardDef extends Record<string, unknown> {
  id: string;
  /** 看板名称（侧栏显示名） */
  name: string;
  /** 看板类型（用户自定义分类，可为空） */
  type: string;
  /** 看板作用描述 */
  description: string;
  /** DSQL 查询语句 */
  sql: string;
  /** 视图类型覆盖（空 = 跟随 DSQL 的 TABLE/LIST 关键字） */
  viewOverride: string;
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

export function makeBoardId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 首次安装时的默认看板：名为「默认看板」，内容为空。 */
export function makeDefaultBoard(): BoardDef {
  return {
    id: makeBoardId(),
    name: "默认看板",
    type: "",
    description: "",
    sql: "",
    viewOverride: "",
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

/** 载入设置时的看板字段校形：缺失字段补默认值，不认识的字段丢弃。 */
export function normalizeBoard(raw: Record<string, unknown>): BoardDef {
  return {
    id: typeof raw.id === "string" ? raw.id : makeBoardId(),
    name: typeof raw.name === "string" ? raw.name : "未命名看板",
    type: typeof raw.type === "string" ? raw.type : "",
    description: typeof raw.description === "string" ? raw.description : "",
    sql: typeof raw.sql === "string" ? raw.sql : "",
    viewOverride: typeof raw.viewOverride === "string" ? raw.viewOverride : "",
  };
}
