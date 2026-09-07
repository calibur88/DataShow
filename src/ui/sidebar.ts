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

  async onOpen(): Promise<void> {
    this.render();
    // 设置中的看板变化时刷新。
    this.unsubBoards = this.plugin.addBoardListener(() => {
      if (this.contentEl.isShown()) this.render();
    });
  }

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

    for (const [type, items] of groups) {
      const section = root.createDiv({ cls: "datashow-sidebar__section" });
      const header = section.createDiv({ cls: "datashow-sidebar__group" });
      header.createSpan({ cls: "datashow-sidebar__caret", text: "▾" });
      header.createSpan({ text: type });

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
