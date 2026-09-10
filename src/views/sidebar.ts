/**
 * @module views/sidebar
 * @description 看板侧栏视图壳：ItemView 生命周期与依赖注入，渲染由 render/sidebar-view 承担
 */

import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { SidebarDeps } from "@host/types";
import { createSidebarController, type SidebarController } from "@render/sidebar-view";
import { SIDEBAR_VIEW_TYPE } from "./view-types";

/**
 * 侧栏视图：只负责视图生命周期，
 * 看板清单的渲染与折叠持久化由 `render/sidebar-view` 的控制器承担。
 */
export class DatashowSidebarView extends ItemView {
  private sidebar: SidebarController | null = null;

  constructor(leaf: WorkspaceLeaf, private deps: SidebarDeps) {
    super(leaf);
  }

  getViewType(): string {
    return SIDEBAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "DataShow 看板";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    this.sidebar = createSidebarController(this.contentEl, () => this.contentEl.isShown(), this.deps);
    this.sidebar.mount();
  }

  async onClose(): Promise<void> {
    this.sidebar?.dispose();
    this.sidebar = null;
    this.contentEl.empty();
  }
}
