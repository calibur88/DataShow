/**
 * @module views/panel
 * @description 看板面板视图壳：ItemView 生命周期与依赖注入，业务逻辑全在 render/panel-view
 */

import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type { PanelDeps } from "@host/types";
import { createPanelController, type PanelController } from "@render/panel-view";
import { PANEL_VIEW_TYPE, type PanelViewState } from "./view-types";

/**
 * 主工作区看板面板：只负责视图生命周期与状态读写，
 * 渲染与交互由 `render/panel-view` 的控制器承担。
 */
export class DatashowPanelView extends ItemView {
  private state: PanelViewState | null = null;
  private panel: PanelController | null = null;

  constructor(leaf: WorkspaceLeaf, private deps: PanelDeps) {
    super(leaf);
  }

  getViewType(): string {
    return PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    const board = this.deps.settings().boards.find((b) => b.id === this.state?.boardId);
    return board ? `DataShow: ${board.name}` : "DataShow 看板";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  getState(): PanelViewState {
    return this.state ?? { boardId: "" };
  }

  async setState(state: PanelViewState, result: ViewStateResult): Promise<void> {
    this.state = state;
    await super.setState(state, result);
    if (this.contentEl.isShown()) await this.panel?.render();
  }

  async onOpen(): Promise<void> {
    this.panel = createPanelController(
      this.contentEl,
      () => this.state?.boardId ?? "",
      () => this.contentEl.isShown(),
      this.deps,
    );
    await this.panel.mount();
  }

  async onClose(): Promise<void> {
    this.panel?.dispose();
    this.panel = null;
    this.contentEl.empty();
  }
}
