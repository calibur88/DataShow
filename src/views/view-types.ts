/**
 * @module views/view-types
 * @description 视图类型常量与面板视图状态：`registerView` 与 `getLeavesOfType` 共用
 */

export const SIDEBAR_VIEW_TYPE = "datashow-sidebar-view";
export const PANEL_VIEW_TYPE = "datashow-panel-view";

/** 面板视图的状态：当前展示的看板 id */
export interface PanelViewState extends Record<string, unknown> {
  boardId: string;
}
