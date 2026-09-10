/**
 * @module render/sidebar-view
 * @description 侧栏渲染：按分类分组展示看板清单，点击在主工作区打开面板（纯 UI，只吃 SidebarDeps）
 */

import type { SidebarDeps } from "@host/types";
import type { BoardDef } from "@settings/schema";

/** 侧栏控制器：视图壳持有并驱动其生命周期 */
export interface SidebarController {
  /** 首次渲染并订阅看板变更 */
  mount(): void;
  /** 重绘看板清单 */
  render(): void;
  /** 退订看板变更 */
  dispose(): void;
}

/**
 * 创建侧栏控制器。
 *
 * @param root - 宿主容器（由视图壳提供，如 ItemView.contentEl）
 * @param isVisible - 容器可见性判定（由视图壳提供）
 * @param deps - 侧栏依赖契约
 * @returns 侧栏控制器
 */
export function createSidebarController(
  root: HTMLElement,
  isVisible: () => boolean,
  deps: SidebarDeps,
): SidebarController {
  let unsubBoards: (() => void) | null = null;

  function render(): void {
    root.empty();
    root.addClass("datashow-sidebar");

    const boards = deps.settings().boards;
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
    const groups = new Map<string, BoardDef[]>();
    for (const board of boards) {
      const key = board.type.trim() || "未分类";
      const list = groups.get(key) ?? [];
      list.push(board);
      groups.set(key, list);
    }

    // 清理不存在的折叠记录：分组重命名 / 删除后，旧的折叠名变成死数据
    const settings = deps.settings();
    const existingTypes = new Set(groups.keys());
    const cleaned = settings.collapsedGroups.filter((t) => existingTypes.has(t));
    if (cleaned.length !== settings.collapsedGroups.length) {
      settings.collapsedGroups = cleaned;
      void deps.saveSettings();
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
        const set = new Set(deps.settings().collapsedGroups);
        if (nowCollapsed) set.add(type);
        else set.delete(type);
        deps.settings().collapsedGroups = [...set];
        void deps.saveSettings();
      });

      const list = section.createDiv({ cls: "datashow-sidebar__list" });
      for (const board of items) {
        const item = list.createDiv({ cls: "datashow-sidebar__item" });
        item.createSpan({ cls: "datashow-sidebar__item-icon", text: "▤" });
        item.createSpan({ text: board.name || "（未命名看板）" });
        item.addEventListener("click", () => void deps.openBoard(board.id));
      }
    }
  }

  return {
    mount(): void {
      render();
      // 设置中的看板变化时刷新。
      unsubBoards = deps.onBoardsChange(() => {
        if (isVisible()) render();
      });
    },
    render,
    dispose(): void {
      unsubBoards?.();
      unsubBoards = null;
    },
  };
}
