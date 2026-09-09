/**
 * @module ui/sidebar
 * @description 看板侧栏：按分类分组展示看板清单，点击在主工作区打开面板
 */

import { ItemView, WorkspaceLeaf } from "obsidian";
import type DatashowPlugin from "../main";
import { SIDEBAR_VIEW_TYPE } from "@dsql/types";

/**
 * 侧栏视图：展示插件设置中定义的看板（按看板类型分组），
 * 点击看板在主工作区打开其面板。
 */
export class DatashowSidebarView extends ItemView {
  private plugin: DatashowPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: DatashowPlugin) {
    super(leaf);
    this.plugin = plugin;
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

  /** 打开侧栏：渲染看板清单并订阅看板变化。 */
  async onOpen(): Promise<void> {
    this.render();
    // 设置中的看板变化时刷新。
    this.unsubBoards = this.plugin.addBoardListener(() => {
      if (this.contentEl.isShown()) this.render();
    });
  }

  /** 关闭侧栏：退订并清空 DOM。 */
  async onClose(): Promise<void> {
    this.unsubBoards?.();
    this.contentEl.empty();
  }

  private unsubBoards: (() => void) | null = null;

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("datashow-sidebar");

    const boards = this.plugin.settings.boards;
    if (boards.length === 0) {
      const empty = root.createDiv({ cls: "datashow-sidebar__empty" });
      empty.createDiv({ text: "暂无看板" });
      empty.createDiv({
        cls: "datashow-sidebar__hint",
        text: "到 插件设置 → DataShow → 看板 中新建；侧栏展示的即为设置里定义的看板。",
      });
      return;
    }

    // 按看板类型分组；无类型归入「未分类」。
    const groups = new Map<string, typeof boards>();
    for (const board of boards) {
      const key = board.type.trim() || "未分类";
      const list = groups.get(key) ?? [];
      list.push(board);
      groups.set(key, list);
    }

    // 清理不存在的折叠记录：分组重命名 / 删除后，旧的折叠名变成死数据
    const existingTypes = new Set(groups.keys());
    const cleaned = this.plugin.settings.collapsedGroups.filter((t) => existingTypes.has(t));
    if (cleaned.length !== this.plugin.settings.collapsedGroups.length) {
      this.plugin.settings.collapsedGroups = cleaned;
      void this.plugin.saveSettings();
    }
    const collapsedSet = new Set(cleaned);

    for (const [type, items] of groups) {
      const collapsed = collapsedSet.has(type);
      const section = root.createDiv({
        cls: collapsed ? "datashow-sidebar__section is-collapsed" : "datashow-sidebar__section",
      });
      const header = section.createDiv({ cls: "datashow-sidebar__group" });
      header.createSpan({ cls: "datashow-sidebar__caret", text: "▾" });
      header.createSpan({ text: type });
      header.setAttribute("aria-expanded", String(!collapsed));

      // 点击分组头切换折叠，并持久化到设置。
      header.addEventListener("click", () => {
        const nowCollapsed = !section.hasClass("is-collapsed");
        section.toggleClass("is-collapsed", nowCollapsed);
        header.setAttribute("aria-expanded", String(!nowCollapsed));
        const set = new Set(this.plugin.settings.collapsedGroups);
        if (nowCollapsed) set.add(type);
        else set.delete(type);
        this.plugin.settings.collapsedGroups = [...set];
        void this.plugin.saveSettings();
      });

      const list = section.createDiv({ cls: "datashow-sidebar__list" });
      for (const board of items) {
        const item = list.createDiv({ cls: "datashow-sidebar__item" });
        item.createSpan({ cls: "datashow-sidebar__item-icon", text: "▤" });
        item.createSpan({ text: board.name || "（未命名看板）" });
        item.addEventListener("click", () => this.plugin.openBoard(board.id));
      }
    }
  }
}
