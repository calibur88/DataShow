/**
 * @module settings/schema
 * @description 设置与看板的形状定义：类型声明、存储槽位与内容版本号（零宿主依赖）
 *
 * 定性：`data.json` 里 `boards` 是**用户内容**（含 DSQL 语句，属用户资产，导出与迁移必须整体保留），
 * 其余字段是**展示偏好**（丢掉可回默认）。两者共用一块 data.json 一并读写，槽位键见 `SETTINGS_KEY`；
 * 读写能力由 `host` 的 `IStorageHost` 提供，校形与版本迁移见 `settings/normalize`。
 * 接口按「能力」命名（Storage = 读写一块持久化数据），不按数据语义命名，数据语义由本层承载。
 */

import type { ViewType } from "@dsql/types";

/** 存储槽位键：IStorageHost 用本键读写整块设置 */
export const SETTINGS_KEY = "settings";

/** 内容 schema 版本：结构变更时递增，迁移规则见 settings/normalize */
export const CONTENT_SCHEMA_VERSION = 1;

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
  /** 显示 DSQL 调试信息（每操作信息、字段找不到等） */
  showDebug: boolean;
  /** 数值列非整数显示的小数位（非负整数；超过浮点精度重置默认 4，仅显示层） */
  decimalPlaces: number;
  /** 看板定义（用户内容，在设置中管理） */
  boards: BoardDef[];
  /** 侧栏已折叠的分类名（重启后保留折叠状态） */
  collapsedGroups: string[];
  /** 内容 schema 版本；缺失按 CONTENT_SCHEMA_VERSION 处理 */
  schemaVersion?: number;
}
