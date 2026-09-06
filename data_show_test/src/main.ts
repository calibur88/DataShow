import { Plugin, WorkspaceLeaf } from "obsidian";
import { VaultScanner } from "./index/scanner";
import { DataStore } from "./index/store";
import { DatashowSettingTab } from "./settings";
import { DatashowPanelView } from "./views/panel";
import { DatashowSidebarView } from "./views/sidebar";
import {
  DEFAULT_SETTINGS,
  PANEL_VIEW_TYPE,
  SIDEBAR_VIEW_TYPE,
  makeDefaultBoard,
  normalizeBoard,
  type BoardDef,
  type DatashowSettings,
  type PanelViewState,
} from "./types";

export default class DatashowPlugin extends Plugin {
  settings: DatashowSettings = DEFAULT_SETTINGS;

  /** L2 数据仓库：查询层与表现层共用。 */
  store = new DataStore();

  private scanner: VaultScanner | null = null;
  private boardListeners = new Set<() => void>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new DatashowSidebarView(leaf, this));
    this.registerView(PANEL_VIEW_TYPE, (leaf) => new DatashowPanelView(leaf, this));

    this.addRibbonIcon("layout-dashboard", "打开 DataShow 看板", () =>
      this.activateSidebarView(),
    );

    this.addCommand({
      id: "open-sidebar",
      name: "打开看板侧栏",
      callback: () => this.activateSidebarView(),
    });

    this.addSettingTab(new DatashowSettingTab(this.app, this));

    // L2 索引：事件监听经插件注册，卸载时自动清理。
    this.scanner = new VaultScanner(this.app, this.store);
    this.scanner.start((ref) => this.registerEvent(ref as never));
  }

  onclose(): void {
    this.scanner = null;
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<DatashowSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data,
      boards: Array.isArray(data?.boards)
        ? data!.boards!.map((b) => normalizeBoard(b as unknown as Record<string, unknown>))
        : this.defaultBoards(),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    for (const cb of this.boardListeners) cb();
  }

  /** 订阅看板设置变化（侧栏/面板据此刷新），返回取消订阅函数。 */
  addBoardListener(cb: () => void): () => void {
    this.boardListeners.add(cb);
    return () => this.boardListeners.delete(cb);
  }

  /** 首次安装时的默认看板：名为「默认看板」，内容为空。 */
  defaultBoards(): BoardDef[] {
    return [makeDefaultBoard()];
  }

  /** 打开（或聚焦）侧栏视图。 */
  async activateSidebarView(): Promise<void> {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE)[0];
    if (existing) {
      workspace.revealLeaf(existing);
      return;
    }
    const leaf = workspace.getLeftLeaf(false) ?? workspace.getLeaf(true);
    await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }

  /** 在主工作区打开看板面板（新标签页或复用已有面板标签）。 */
  async openBoard(boardId: string): Promise<void> {
    const { workspace } = this.app;
    const state: PanelViewState = { boardId };

    if (!this.settings.openInNewTab) {
      const existing = workspace.getLeavesOfType(PANEL_VIEW_TYPE)[0];
      if (existing) {
        await existing.setViewState({ type: PANEL_VIEW_TYPE, active: true, state });
        workspace.revealLeaf(existing);
        return;
      }
    }

    const leaf: WorkspaceLeaf = workspace.getLeaf(this.settings.openInNewTab ? "tab" : false);
    await leaf.setViewState({ type: PANEL_VIEW_TYPE, active: true, state });
    workspace.revealLeaf(leaf);
  }
}
