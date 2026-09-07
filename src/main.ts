/**
 * @module main
 * @description 插件入口：注册视图、命令与设置页，装配扫描器与行仓库
 *
 * 面向 Obsidian 的元数据看板插件：索引 vault frontmatter 为行仓库，
 * 以 DSQL 查询并渲染为表格/列表/卡片视图。模块分层：
 *   dsql/（DSQL 语言层） · index/（索引层：扫描 → 行仓库） ·
 *   ui/（表现层：侧栏 + 看板面板） · settings.ts（看板与设置）
 */

import { Plugin, WorkspaceLeaf } from "obsidian";
import { VaultScanner } from "@index/scanner";
import { DataStore } from "@index/store";
import { DatashowSettingTab } from "./settings";
import { DatashowPanelView } from "@ui/panel";
import { DatashowSidebarView } from "@ui/sidebar";
import {
  DEFAULT_SETTINGS,
  PANEL_VIEW_TYPE,
  SIDEBAR_VIEW_TYPE,
  makeDefaultBoard,
  normalizeBoard,
  type BoardDef,
  type DatashowSettings,
  type PanelViewState,
} from "@dsql/types";

/** DataShow 插件主类：持有设置与行仓库，装配视图、命令、设置页与索引扫描。 */
export default class DatashowPlugin extends Plugin {
  settings: DatashowSettings = DEFAULT_SETTINGS;

  /** L2 数据仓库：查询层与表现层共用。 */
  store = new DataStore();

  private scanner: VaultScanner | null = null;
  private boardListeners = new Set<() => void>();

  /** 插件加载：读设置、注册视图与命令、启动索引扫描。 */
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

  /** 插件卸载：断开扫描器引用。 */
  onclose(): void {
    this.scanner = null;
  }

  /** 读取并归一设置（boards 逐个校形）。 */
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

  /** 持久化设置并通知看板订阅者。 */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    const leaf = workspace.getLeftLeaf(false) ?? workspace.getLeaf('tab');
    await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }

  /**
   * 在主工作区打开看板面板（新标签页或复用已有面板标签）。
   *
   * @param boardId - 目标看板 id
   */
  async openBoard(boardId: string): Promise<void> {
    const { workspace } = this.app;
    const state: PanelViewState = { boardId };

    if (!this.settings.openInNewTab) {
      const existing = workspace.getLeavesOfType(PANEL_VIEW_TYPE)[0];
      if (existing) {
        await existing.setViewState({ type: PANEL_VIEW_TYPE, active: true, state });
        await workspace.revealLeaf(existing);
        return;
      }
    }

    const leaf: WorkspaceLeaf = workspace.getLeaf(this.settings.openInNewTab ? "tab" : false);
    await leaf.setViewState({ type: PANEL_VIEW_TYPE, active: true, state });
    await workspace.revealLeaf(leaf);
  }
}
