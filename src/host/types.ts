/**
 * @module host/types
 * @description 宿主接口与依赖契约的唯一出口。纯类型文件，禁止放置任何运行时值
 *
 * 读写约定：
 * - 读路径（readFrontmatter / read / readText）失败一律返回 null，由调用方降级，core 内不抛不 try；
 * - 写路径（setField / replaceAll / save / openFile）失败以 reject(Error) 上抛，message 可直接展示给用户。
 */

import type { DataRow, FieldValue } from "@dsql/types";
import type { BoardDef, DatashowSettings } from "@settings/schema";

// ---------------------------------------------------------------- 源文件元数据

/**
 * 宿主侧文件元数据（索引输入）。
 * 与 `dsql/types` 的 `FileMeta`（行内 file.* 虚拟列）不同：本接口不含链路，
 * 链路由 `IVaultHost` 单独提供
 */
export interface IFileMeta {
  /** vault 内路径（主键） */
  path: string;
  /** 不含扩展名的文件名 */
  basename: string;
  /** 父文件夹路径；仓库根目录为 "/" */
  folder: string;
  /** 不含点的扩展名 */
  ext: string;
  size: number;
  ctime: number;
  mtime: number;
}

// -------------------------------------------------------------------- 摄取警告

/** 摄取期容错警告（DSQL 1.5）：如重复键剔除。按文件路径归档，随查询调试信息一并输出。 */
export interface IngestWarning {
  type: string;
  file: string;
  field?: string;
  message: string;
  /** 原始键值对档案（重复键场景保留原文行，供排查） */
  rawLines?: string[];
}

// ---------------------------------------------------------------------- 宿主事件

/** 宿主变更事件。只表达「需要重扫」，不承载任何 UI 语义 */
export interface VaultEventHandlers {
  /** 全量解析完成（首次扫描或批量改动解析结束） */
  onResolved?(): void;
  /** 某文件内容变更 */
  onChanged?(path: string): void;
  /** 某文件被删除（可能是文件夹；宿主负责展开为具体路径） */
  onDeleted?(path: string): void;
  /** 某文件被重命名 / 移动 */
  onRenamed?(oldPath: string, newPath: string): void;
}

// ---------------------------------------------------------------------- 宿主接口

/** 数据源能力：列文件、读元数据与正文、订阅变更 */
export interface IVaultHost {
  listMarkdownFiles(): Promise<IFileMeta[]>;
  /** 读取 frontmatter；无 frontmatter 或读取失败时返回 null */
  readFrontmatter(path: string): Promise<Record<string, unknown> | null>;
  /** 已解析的出链目标路径 */
  getOutlinks(path: string): Promise<string[]>;
  /** 入链来源路径 */
  getInlinks(path: string): Promise<string[]>;
  /** 读原始文本（摄取容错用，如重复键检测）；文件不存在时返回 null */
  readText(path: string): Promise<string | null>;
  /** 订阅宿主变更；返回注销函数，由装配方在卸载时调用 */
  subscribe(handlers: VaultEventHandlers): () => void;
}

/** 打开与跳转能力 */
export interface IOpener {
  /** 打开笔记。newLeaf 为真时优先新标签页，否则复用已有标签页 */
  openFile(path: string, options?: { newLeaf?: boolean }): Promise<void>;
}

/** YAML 编解码契约。宿主提供实现，core 只认本接口 */
export interface IYamlCodec {
  /** 解析文本；失败时抛出 Error（message 可直接展示给用户） */
  parse(text: string): unknown;
  stringify(value: unknown): string;
}

/** frontmatter 数据侧能力：读写属性，不含任何 UI */
export interface IFrontmatterHost {
  /** 读取属性；文件不存在或无 frontmatter 时返回 null */
  read(path: string): Promise<Record<string, unknown> | null>;
  /** 写入单个字段（原子写回） */
  setField(path: string, fieldPath: string, value: FieldValue): Promise<void>;
  /** 整体替换属性（先清空再写入） */
  replaceAll(path: string, fields: Record<string, unknown>): Promise<void>;
}

/** frontmatter 编辑弹窗能力：宿主 UI 侧，仅被 UI 层调用 */
export interface IFrontmatterEditor {
  /** 打开属性编辑弹窗；保存成功后回调 onSaved */
  openEditor(path: string, onSaved: () => void): void;
}

/** 持久化能力。key 用于区分 settings / 缓存 / 视图状态，避免互相覆盖 */
export interface IStorageHost {
  /** 读取；不存在时返回 null */
  load<T>(key: string): Promise<T | null>;
  save(key: string, data: unknown): Promise<void>;
}

/** 用户反馈与日志能力 */
export interface IUiHost {
  /** 轻提示（宿主的通知条） */
  notify(message: string): void;
  /** 警告：可恢复的降级（如文件已不存在） */
  warn(message: string, ...args: unknown[]): void;
  /** 错误：写回失败等需要用户知晓的失败 */
  error(message: string, ...args: unknown[]): void;
}

// ---------------------------------------------------------------------- UI 数据源

/** UI 只读的数据视图：行快照 + 变更订阅 + 摄取警告 */
export interface IRowSource {
  /** 全部行（按路径排序的快照） */
  all(): DataRow[];
  /** 当前归档的摄取警告 */
  ingestWarnings(): IngestWarning[];
  /** 订阅数据变更；返回注销函数 */
  subscribe(listener: () => void): () => void;
}

// ---------------------------------------------------------------------- 依赖契约

/** 看板面板的依赖契约。UI 只吃本接口，不感知插件与宿主类型 */
export interface PanelDeps {
  rows: IRowSource;
  /** 取当前设置（含看板定义），每次调用返回最新值 */
  settings(): DatashowSettings;
  /** 持久化设置并广播看板变更 */
  saveSettings(): Promise<void>;
  /** 订阅看板（设置）变更；返回注销函数 */
  onBoardsChange(listener: () => void): () => void;
  opener: IOpener;
  frontmatter: IFrontmatterHost;
  editor: IFrontmatterEditor;
  ui: IUiHost;
}

/** 侧栏的依赖契约 */
export interface SidebarDeps {
  settings(): DatashowSettings;
  saveSettings(): Promise<void>;
  /** 在主工作区打开指定看板 */
  openBoard(boardId: string): Promise<void>;
  onBoardsChange(listener: () => void): () => void;
}

/** 设置页的依赖契约 */
export interface SettingsTabDeps {
  settings(): DatashowSettings;
  saveSettings(): Promise<void>;
  /** 首次安装 / 恢复默认时的默认看板列表 */
  defaultBoards(): BoardDef[];
}
