/**
 * @module render/sidebar-view
 * @description 侧栏渲染：顶部搜索栏 + 按分类分组的看板清单，点击在主工作区打开面板（纯 UI，只吃 SidebarDeps）
 */

import type { SidebarDeps } from "@host/types";
import type { BoardDef } from "@settings/schema";

/** 无分类看板归入的分组名 */
const UNCATEGORIZED = "未分类";

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
  /** 过滤词（会话内临时状态，不持久化到 data.json；切换看板 / 重建侧栏时保留） */
  let query = "";
  /** 重绘后回焦搜索框（点「搜索」/ 回车触发整体重绘时需要） */
  let refocus = false;
  let searchInput: HTMLInputElement | null = null;

  /** 按分类分组；无分类归入「未分类」，保留首次出现顺序。 */
  function groupBoards(boards: BoardDef[]): Map<string, BoardDef[]> {
    const groups = new Map<string, BoardDef[]>();
    for (const board of boards) {
      const key = board.type.trim() || UNCATEGORIZED;
      const list = groups.get(key) ?? [];
      list.push(board);
      groups.set(key, list);
    }
    return groups;
  }

  /**
   * 清理不存在的折叠记录：分组重命名 / 删除后，旧的折叠名变成死数据。
   * 依据为全量分组（与过滤无关），过滤期间不会误删用户折叠状态。
   */
  function cleanCollapsed(existingTypes: Set<string>): void {
    const settings = deps.settings();
    const cleaned = settings.collapsedGroups.filter((t) => existingTypes.has(t));
    if (cleaned.length !== settings.collapsedGroups.length) {
      settings.collapsedGroups = cleaned;
      void deps.saveSettings();
    }
  }

  /** 渲染一个分组（含折叠开关与条目列表） */
  function renderGroup(section: HTMLElement, type: string, items: BoardDef[], collapsed: boolean): void {
    section.toggleClass("is-collapsed", collapsed);
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

  /** 应用搜索：取输入框当前值并重绘（不持久化，仅影响本次会话） */
  function applySearch(): void {
    if (!searchInput) return;
    query = searchInput.value;
    refocus = true;
    render();
  }

  /** 清空搜索：恢复全部条目 */
  function clearSearch(): void {
    query = "";
    if (searchInput) searchInput.value = "";
    refocus = true;
    render();
  }

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

    // ---- 搜索栏：占满侧栏顶部一行（输入框 + 搜索 + 清空） ----
    const bar = root.createDiv({ cls: "datashow-sidebar__search" });
    const input = bar.createEl("input", {
      cls: "datashow-sidebar__search-input",
      attr: { type: "text", placeholder: "请输入分类或规则名称" },
    }) as HTMLInputElement;
    input.value = query;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applySearch();
      }
    });
    bar
      .createEl("button", { cls: "datashow-sidebar__btn", text: "搜索" })
      .addEventListener("click", () => applySearch());
    bar
      .createEl("button", { cls: "datashow-sidebar__btn", text: "清空" })
      .addEventListener("click", () => clearSearch());
    searchInput = input;

    // ---- 分组（全量）：折叠记录清理与折叠状态均以全量为准，过滤不改变折叠 ----
    const groups = groupBoards(boards);
    cleanCollapsed(new Set(groups.keys()));
    const collapsedSet = new Set(deps.settings().collapsedGroups);

    // ---- 过滤：分类名 / 看板名不区分大小写子串匹配；分组内无匹配则整组隐藏 ----
    const kw = query.trim().toLowerCase();
    const hit = (board: BoardDef): boolean =>
      kw === "" ||
      board.name.toLowerCase().includes(kw) ||
      board.type.toLowerCase().includes(kw) ||
      UNCATEGORIZED.includes(kw);

    let matchedGroups = 0;
    for (const [type, items] of groups) {
      const visible = items.filter(hit);
      if (visible.length === 0) continue;
      matchedGroups++;
      const section = root.createDiv({ cls: "datashow-sidebar__section" });
      renderGroup(section, type, visible, collapsedSet.has(type));
    }

    if (matchedGroups === 0) {
      root.createDiv({ cls: "datashow-sidebar__empty", text: "没有匹配的看板" });
    }

    if (refocus) {
      input.focus();
      refocus = false;
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
      searchInput = null;
    },
  };
}
