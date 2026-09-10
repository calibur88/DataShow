/**
 * @module main
 * @description 插件入口：只做装配——宿主适配器 → 索引器 → 视图注册 → 命令/ribbon
 *
 * 依赖方向：`main → views → render → controller → core → host/types`；
 * `import 'obsidian'` 仅允许出现在 main、views 与 host/obsidian 三处。
 */

import { Plugin, type WorkspaceLeaf } from "obsidian";
import { VaultIndexer } from "@controller/indexer";
import { ObsidianFrontmatterHost } from "@host/obsidian/frontmatter-host";
import { ObsidianFrontmatterEditor } from "@host/obsidian/frontmatter-modal";
import { ObsidianOpener } from "@host/obsidian/opener";
import { ObsidianStorageHost } from "@host/obsidian/storage-host";
import { ObsidianUiHost } from "@host/obsidian/ui-host";
import { ObsidianVaultHost } from "@host/obsidian/vault-host";
import { ObsidianYamlCodec } from "@host/obsidian/yaml-codec";
import type { IRowSource, IStorageHost } from "@host/types";
import { DataStore } from "@index/store";
import { DEFAULT_SETTINGS, makeDefaultBoard } from "@settings/defaults";
import { normalizeSettings } from "@settings/normalize";
import { SETTINGS_KEY, type BoardDef, type DatashowSettings } from "@settings/schema";
import { DatashowPanelView } from "@views/panel";
import { DatashowSettingTab } from "@views/settings-tab";
import { DatashowSidebarView } from "@views/sidebar";
import { PANEL_VIEW_TYPE, SIDEBAR_VIEW_TYPE, type PanelViewState } from "@views/view-types";

/** DataShow 插件主类：持有设置与行仓库，装配宿主适配器、视图、命令与索引器。 */
export default class DatashowPlugin extends Plugin {
  settings: DatashowSettings = DEFAULT_SETTINGS;

  /** 行仓库：查询层与表现层共用的唯一数据源。 */
  store = new DataStore();

  private readonly storage: IStorageHost = new ObsidianStorageHost(this);
  private readonly ui = new ObsidianUiHost();
  private indexer: VaultIndexer | null = null;
  private boardListeners = new Set<() => void>();

  /** 插件加载：读设置、注册视图与命令、启动索引器。 */
  async onload(): Promise<void> {
    await this.loadSettings();

    // ---- 宿主适配器：宿主能力的唯一来源，下游只认 host/types 的接口 ----
    const vaultHost = new ObsidianVaultHost(this.app);
    const opener = new ObsidianOpener(this.app);
    const codec = new ObsidianYamlCodec();
    const frontmatter = new ObsidianFrontmatterHost(this.app);
    const editor = new ObsidianFrontmatterEditor(this.app, codec);

    // ---- 索引器：宿主事件 → 行仓库；UI 只订阅行仓库，不直连宿主 ----
    const indexer = new VaultIndexer(vaultHost, this.store, this.ui);
    this.indexer = indexer;
    this.register(() => indexer.dispose());

    const rows: IRowSource = {
      all: () => this.store.all(),
      ingestWarnings: () => this.store.ingestWarnings(),
      subscribe: (cb) => this.store.subscribe(cb),
    };

    this.registerView(
      SIDEBAR_VIEW_TYPE,
      (leaf) =>
        new DatashowSidebarView(leaf, {
          settings: () => this.settings,
          saveSettings: () => this.saveSettings(),
          openBoard: (boardId) => this.openBoard(boardId),
          onBoardsChange: (cb) => this.addBoardListener(cb),
        }),
    );
    this.registerView(
      PANEL_VIEW_TYPE,
      (leaf) =>
        new DatashowPanelView(leaf, {
          rows,
          settings: () => this.settings,
          saveSettings: () => this.saveSettings(),
          onBoardsChange: (cb) => this.addBoardListener(cb),
          opener,
          frontmatter,
          editor,
          ui: this.ui,
        }),
    );

    this.addRibbonIcon("layout-dashboard", "打开 DataShow 看板", () => {
      void this.activateSidebarView();
    });

    this.addCommand({
      id: "open-sidebar",
      name: "打开看板侧栏",
      callback: () => {
        void this.activateSidebarView();
      },
    });

    this.addSettingTab(
      new DatashowSettingTab(this.app, this, {
        settings: () => this.settings,
        saveSettings: () => this.saveSettings(),
        defaultBoards: () => this.defaultBoards(),
      }),
    );

    indexer.start();
  }

  /** 插件卸载：断开索引器引用。 */
  onunload(): void {
    this.indexer = null;
    this.boardListeners.clear();
  }

  /** 读取并归一设置（整块校形 + 看板逐个校形）。 */
  async loadSettings(): Promise<void> {
    const raw = await this.storage.load<Partial<DatashowSettings>>(SETTINGS_KEY);
    this.settings = normalizeSettings(raw);
  }

  /** 持久化设置并通知看板订阅者。 */
  async saveSettings(): Promise<void> {
    await this.storage.save(SETTINGS_KEY, this.settings);
    for (const cb of this.boardListeners) cb();
  }

  /**
   * 订阅看板设置变化（侧栏/面板据此刷新）。
   *
   * @param cb - 变更回调（无参）
   * @returns 取消订阅函数
   */
  addBoardListener(cb: () => void): () => void {
    this.boardListeners.add(cb);
    return () => this.boardListeners.delete(cb);
  }

  /**
   * 首次安装时的默认看板。
   *
   * @returns 含单个「默认看板」的数组
   */
  defaultBoards(): BoardDef[] {
    return [makeDefaultBoard()];
  }

  /** 打开（或聚焦）侧栏视图。 */
  async activateSidebarView(): Promise<void> {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE)[0];
    if (existing) {
      await workspace.revealLeaf(existing);
      return;
    }
    const leaf = workspace.getLeftLeaf(false) ?? workspace.getLeaf("tab");
    await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }

  /**
   * 在主工作区打开看板面板。
   *
   * 打开策略（避免重复点击导致标签页 / 面板无限堆积）：
   * 同一看板已打开时直接聚焦已有标签页；复用模式下优先复用已有面板标签
   * 或当前活动标签页（getLeaf(false)，仅在必要时才切分）；
   * 仅当「新标签页打开」且该看板尚未打开时才新建标签页。
   *
   * @param boardId - 目标看板 id
   */
  async openBoard(boardId: string): Promise<void> {
    const { workspace } = this.app;
    const state: PanelViewState = { boardId };

    // 同一看板已在某标签页打开：直接聚焦并同步状态，不再新建。
    const existing = workspace
      .getLeavesOfType(PANEL_VIEW_TYPE)
      .find((leaf) => (leaf.view.getState() as PanelViewState | null)?.boardId === boardId);
    if (existing) {
      await existing.setViewState({ type: PANEL_VIEW_TYPE, active: true, state });
      await workspace.revealLeaf(existing);
      return;
    }

    if (!this.settings.openInNewTab) {
      // 复用模式：已有面板标签则就地切换看板，否则复用当前活动标签页。
      const leaf: WorkspaceLeaf =
        workspace.getLeavesOfType(PANEL_VIEW_TYPE)[0] ?? workspace.getLeaf(false);
      await leaf.setViewState({ type: PANEL_VIEW_TYPE, active: true, state });
      await workspace.revealLeaf(leaf);
      return;
    }

    // 新标签页模式：上方复用检查已保证该看板未打开，此处才真正新建。
    const leaf: WorkspaceLeaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: PANEL_VIEW_TYPE, active: true, state });
    await workspace.revealLeaf(leaf);
  }
}
