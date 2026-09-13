/**
 * @module views/panel
 * @description 看板面板视图壳：ItemView 生命周期与依赖注入，业务逻辑全在 render/panel-view
 */

import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type { PanelDeps } from "@host/types";
import { createPanelController, type PanelController } from "@render/panel-view";
import { PANEL_VIEW_TYPE, type PanelViewState } from "./view-types";

/** [ext] 查询刷新兜底：非 md 文件变更的去抖窗口（规范 §9） */
const EXT_REFRESH_DEBOUNCE_MS = 300;

/**
 * 主工作区看板面板：只负责视图生命周期与状态读写，
 * 渲染与交互由 `render/panel-view` 的控制器承担。
 */
export class DatashowPanelView extends ItemView {
  private state: PanelViewState | null = null;
  private panel: PanelController | null = null;
  private unsubVaultChange: (() => void) | null = null;
  private extRefreshTimer: number | null = null;

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
    // [ext] 查询刷新兜底：vault 变更事件在 views 层接收，回调里按当前 SQL 是否含
    // "["（[ext] 过滤，词法上 [ 只能是 extfilter）决定是否去抖重跑；无 [ext] 不响应
    this.unsubVaultChange = this.deps.onVaultChange(() => this.onVaultChange());
    await this.panel.mount();
  }

  async onClose(): Promise<void> {
    this.clearExtRefreshTimer();
    this.unsubVaultChange?.();
    this.unsubVaultChange = null;
    this.panel?.dispose();
    this.panel = null;
    this.contentEl.empty();
  }

  /** vault 变更（modify / create / delete / rename，含非 md）→ 去抖后重跑当前查询。 */
  private onVaultChange(): void {
    const board = this.deps.settings().boards.find((b) => b.id === this.state?.boardId);
    if (!board || !board.sql.includes("[")) return; // 无 [ext] 的查询不订阅重跑
    this.clearExtRefreshTimer();
    this.extRefreshTimer = window.setTimeout(() => {
      this.extRefreshTimer = null;
      this.panel?.rerun();
    }, EXT_REFRESH_DEBOUNCE_MS);
  }

  private clearExtRefreshTimer(): void {
    if (this.extRefreshTimer !== null) {
      window.clearTimeout(this.extRefreshTimer);
      this.extRefreshTimer = null;
    }
  }
}
