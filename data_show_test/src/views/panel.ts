import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type DatashowPlugin from "../main";
import { executeQuery, type QueryDebug, type ResultSet } from "../query/executor";
import { parseQuery, QueryParseError } from "../query/parser";
import { FrontmatterEditModal } from "./frontmatter-modal";
import { renderTableView } from "./table-view";
import { renderListView } from "./list-view";
import { renderCardView } from "./card-view";
import { applyViewType, detectTypeFromSql } from "../utils/viewSync";
import {
  IMPLEMENTED_VIEWS,
  PANEL_VIEW_TYPE,
  VIEW_LABELS,
  type BoardDef,
  type DataRow,
  type FieldValue,
  type PanelViewState,
  type ViewType,
} from "../types";

/**
 * 主工作区看板面板（v2.0）：
 * - 头部：看板名称 + 自由分类徽标（board.type 仍用于侧栏分组）
 * - DSQL 编辑器：直接编辑、防抖自动保存到看板定义；
 *   保存时反向同步视图下拉（detectTypeFromSql）
 * - 工具条：刷新 + 视图模式选择（跟随后跟随 / 强制覆盖）
 * - 查询结果：随索引/看板变化自动重跑，按 board.viewType / result.view 分派到
 *   TableView / ListView / CardView
 */
export class DatashowPanelView extends ItemView {
  private plugin: DatashowPlugin;
  private state: PanelViewState | null = null;
  private unsubStore: (() => void) | null = null;
  private unsubBoards: (() => void) | null = null;

  /** 当前渲染的看板 id；变化时才整体重绘 */
  private renderedBoardId: string | null = null;
  private resultWrap: HTMLElement | null = null;
  private saveTimer: number | null = null;
  /** 工具条上的视图下拉（render 时建好，renderResult 复用） */
  private viewSelect: HTMLSelectElement | null = null;
  /** 工具条刷新按钮（按 view 同步 enable/disable？暂保留始终可用） */

  constructor(leaf: WorkspaceLeaf, plugin: DatashowPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    const board = this.currentBoard();
    return board ? `DataShow: ${board.name}` : "DataShow 看板";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  getState(): PanelViewState {
    return this.state ?? { boardId: "" };
  }

  async setState(state: PanelViewState, result: import("obsidian").ViewStateResult): Promise<void> {
    this.state = state;
    await super.setState(state, result);
    if (this.contentEl.isShown()) await this.render();
  }

  async onOpen(): Promise<void> {
    this.unsubBoards = this.plugin.addBoardListener(() => this.onExternalChange());
    this.unsubStore = this.plugin.store.subscribe(() => this.renderResult());
    if (this.state) await this.render();
  }

  async onClose(): Promise<void> {
    this.flushSave();
    this.unsubBoards?.();
    this.unsubStore?.();
    this.contentEl.empty();
  }

  private currentBoard(): BoardDef | undefined {
    return this.plugin.settings.boards.find((b) => b.id === this.state?.boardId);
  }

  /** 外部（设置页等）修改看板后重绘；编辑器聚焦时不打断。 */
  private onExternalChange(): void {
    if (this.contentEl.contains(document.activeElement) && this.renderedBoardId) return;
    void this.render();
  }

  private async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("datashow-panel");

    const board = this.currentBoard();
    if (!board) {
      this.renderedBoardId = null;
      root.createDiv({
        cls: "datashow-panel__empty",
        text: "看板不存在或已被删除（可在插件设置中重新创建）。",
      });
      return;
    }
    this.renderedBoardId = board.id;

    // ---- 头部：名称 + 自由分类徽标（board.type 是分类，不是视图类型） ----
    const header = root.createDiv({ cls: "datashow-panel__header" });
    header.createDiv({ cls: "datashow-panel__title", text: board.name || "（未命名看板）" });
    if (board.type.trim()) {
      header.createDiv({ cls: "datashow-panel__type", text: board.type });
    }

    // ---- 作用描述 ----
    if (board.description.trim()) {
      root.createDiv({ cls: "datashow-panel__description", text: board.description });
    }

    // ---- DSQL 编辑器 ----
    const editorWrap = root.createDiv({ cls: "datashow-editor" });
    editorWrap.createDiv({ cls: "datashow-editor__label", text: "DSQL" });
    const textarea = editorWrap.createEl("textarea", { cls: "datashow-editor__input" });
    textarea.value = board.sql;
    textarea.placeholder =
      '**TABLE_VIEW** **SELECT** status **AS** 状态, owner **AS** 负责人\n**FROM** "Notes"\n**WHERE** status %==% \'进行中\'\n**SORT** status **BY** (\'已完成\', \'进行中\')\n**LIMIT** 20';
    textarea.spellcheck = false;
    textarea.addEventListener("input", () => {
      board.sql = textarea.value;
      this.scheduleSave();
    });

    // ---- 工具条：刷新 + 视图模式 ----
    const toolbar = root.createDiv({ cls: "datashow-toolbar" });
    toolbar.createEl("button", { cls: "datashow-toolbar__btn", text: "刷新" }).addEventListener(
      "click",
      () => this.renderResult(),
    );

    toolbar.createDiv({ cls: "datashow-toolbar__spacer" });
    toolbar.createSpan({ cls: "datashow-toolbar__label", text: "视图" });
    const select = toolbar.createEl("select", { cls: "datashow-toolbar__select" }) as HTMLSelectElement;
    // R6 下拉选项：跟随语句 / 表格 / 列表 / 卡片
    const options: { value: string; label: string }[] = [
      { value: "", label: "跟随语句" },
      ...IMPLEMENTED_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] ?? v })),
    ];
    for (const opt of options) {
      const o = select.createEl("option", { text: opt.label }) as HTMLOptionElement;
      o.value = opt.value;
    }
    select.value = board.viewType;
    select.addEventListener("change", () => {
      const newType = select.value as ViewType | "";
      if (newType === "") {
        // 跟随语句：仅清空 viewType，SQL 不动
        board.viewType = "";
        void this.plugin.saveSettings();
        this.renderResult();
        return;
      }
      // 强制覆盖：用 applyViewType 同步 SQL 开头关键词与 viewType
      applyViewType(board, newType);
      // 同步回编辑器
      textarea.value = board.sql;
      void this.plugin.saveSettings();
      this.renderResult();
    });
    this.viewSelect = select;

    // ---- 结果区（独立刷新） ----
    this.resultWrap = root.createDiv({ cls: "datashow-result" });
    this.renderResult();
  }

  /** 编辑防抖自动保存。 */
  private scheduleSave(): void {
    if (this.saveTimer != null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 500);
  }

  private flushSave(): void {
    if (this.saveTimer != null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    void this.plugin.saveSettings();
    // R3 反向同步：保存时若 SQL 开头有合法视图关键词，自动切下拉
    this.syncSelectFromSql();
  }

  /**
   * R3 反向同步：读取当前 board.sql，按 detectTypeFromSql 判断是否要切下拉。
   * - 返回非空 + 与 board.viewType 不一致 → 切下拉并设 board.viewType
   * - 返回 null → 下拉保持当前状态（不强制切到跟随语句）
   *   若 board.viewType 为空也不动，让用户继续编辑
   */
  private syncSelectFromSql(): void {
    const board = this.currentBoard();
    if (!board || !this.viewSelect) return;
    const detected = detectTypeFromSql(board.sql);
    if (detected && detected !== board.viewType) {
      board.viewType = detected;
      this.viewSelect.value = detected;
      void this.plugin.saveSettings();
    }
  }

  /** 当前结果区标签页（每次重跑回到「查询结果」）。 */
  private resultTab: "result" | "debug" = "result";

  /** 只重跑查询结果区（不动编辑器）。 */
  private renderResult(): void {
    if (!this.resultWrap || !this.resultWrap.isShown()) return;
    const board = this.currentBoard();
    if (!board) return;

    const wrap = this.resultWrap;
    wrap.empty();

    const sql = board.sql.trim();
    if (!sql) {
      wrap.createDiv({ cls: "datashow-result__label", text: "查询结果" });
      wrap.createDiv({ cls: "datashow-result__empty", text: "尚未编写 DSQL，在上方输入即可。" });
      return;
    }

    // 先执行一次查询，结果与调试数据分属两个标签页共用
    let query: ReturnType<typeof parseQuery> | null = null;
    let result: ResultSet | null = null;
    let error: string | null = null;
    try {
      query = parseQuery(sql);
      result = executeQuery(query, this.plugin.store.all(), null, {
        debug: this.plugin.settings.showDebug,
        // DSQL 1.5：摄取期容错警告（如重复键剔除的文件）随调试信息输出
        ingestWarnings: this.plugin.store.ingestWarnings(),
      });
    } catch (err) {
      error = err instanceof QueryParseError ? err.message : String((err as Error).message ?? err);
    }

    // 标签栏：查询结果 / 调试信息
    const hasDebug = !error && !!result?.debug;
    const tabs = wrap.createDiv({ cls: "datashow-tabs" });
    const content = wrap.createDiv({ cls: "datashow-tabcontent" });
    const btnResult = tabs.createEl("button", { cls: "datashow-tabs__tab", text: "查询结果" });
    const btnDebug = hasDebug
      ? tabs.createEl("button", { cls: "datashow-tabs__tab", text: "调试信息" })
      : null;
    this.resultTab = "result";

    const renderPane = (): void => {
      content.empty();
      btnResult.toggleClass("is-active", this.resultTab === "result");
      btnDebug?.toggleClass("is-active", this.resultTab === "debug");
      if (this.resultTab === "debug" && btnDebug && result?.debug) {
        this.renderDebug(content, result.debug);
        return;
      }
      content.createDiv({ cls: "datashow-result__label", text: "查询结果" });
      if (error || !result || !query) {
        if (error) content.createDiv({ cls: "datashow-result__error", text: error });
        return;
      }
      if (result.rows.length === 0) {
        content.createDiv({ cls: "datashow-result__empty", text: "查询结果为空（0 行）。" });
        return;
      }
      // R3 视图决策：board.viewType 非空 → 强制覆盖；空 → 跟随 SQL 关键词
      const view: ViewType = board.viewType !== "" ? board.viewType : result.view;
      this.renderResultByView(content, view, query.withoutId, result);
    };
    btnResult.addEventListener("click", () => {
      this.resultTab = "result";
      renderPane();
    });
    btnDebug?.addEventListener("click", () => {
      this.resultTab = "debug";
      renderPane();
    });
    renderPane();
  }

  /** 按 view 分派到 TableView / ListView / CardView（v2.0 三视图平等） */
  private renderResultByView(wrap: HTMLElement, view: ViewType, withoutId: boolean, result: ResultSet): void {
    const decimalPlaces = this.plugin.settings.decimalPlaces;
    const onOpenFile = (row: DataRow): void => {
      void this.app.workspace.openLinkText(row.path, "", false);
    };
    const onSaveField = (row: DataRow, fieldPath: string, value: FieldValue): Promise<void> =>
      this.saveFrontmatterField(row, fieldPath, value);

    let viewEl: HTMLElement;
    if (view === "CARD_VIEW") {
      viewEl = renderCardView({ result, decimalPlaces, onSaveField, onOpenFile });
    } else if (view === "LIST_VIEW") {
      viewEl = renderListView({ result, decimalPlaces, onOpenFile });
    } else {
      viewEl = renderTableView({ result, withoutId, decimalPlaces, onOpenFile });
    }
    wrap.appendChild(viewEl);
  }

  /** 卡片字段保存：调 processFrontMatter 原子写回，索引增量更新由 metadataCache 事件触发 */
  private async saveFrontmatterField(row: DataRow, fieldPath: string, value: FieldValue): Promise<void> {
    const f = this.app.vault.getFileByPath(row.path);
    if (!(f instanceof TFile) || f.extension !== "md") return;
    await this.app.fileManager.processFrontMatter(f, (fm) => {
      fm[fieldPath] = value;
    });
    // 不主动 renderResult：processFrontMatter 触发 metadataCache 变更 → store 通知 → renderResult 自动重跑
  }

  /** 调试信息（逐操作 + 字段缺失 + 警告 + 数据源统计 + 耗时） */
  private renderDebug(wrap: HTMLElement, dbg: QueryDebug): void {
    const entries: { op: string; message: string; warn?: boolean }[] = [
      { op: "FROM", message: dbg.from },
    ];
    for (const stat of dbg.sourceStats) {
      entries.push({ op: "SRC", message: `${stat.source}：${stat.rows} 行` });
    }
    if (dbg.where) entries.push({ op: "WHERE", message: dbg.where });
    if (dbg.sort) entries.push({ op: "SORT", message: dbg.sort });
    if (dbg.limit) entries.push({ op: "LIMIT", message: dbg.limit });
    for (const agg of dbg.aggregates ?? []) {
      entries.push({ op: "AGG", message: agg });
    }
    for (const miss of dbg.fieldMisses) {
      entries.push({
        op: "FIELD",
        message: `字段 "${miss.field}" 在 ${miss.count} 行中不存在（示例：${miss.sample}），按 null 处理`,
        warn: true,
      });
    }
    for (const warning of dbg.warnings) {
      entries.push({ op: "WARN", message: `[${warning.type}] ${warning.message}`, warn: true });
    }
    entries.push({ op: "TIME", message: `${dbg.executionTimeMs} ms` });

    const details = wrap.createDiv({ cls: "datashow-debug" });
    const list = details.createEl("ul", { cls: "datashow-debug__list" });
    for (const entry of entries) {
      const li = list.createEl("li", {
        cls: `datashow-debug__item${entry.warn ? " datashow-debug__item--warn" : ""}`,
      });
      li.createSpan({ cls: "datashow-debug__op", text: entry.op });
      li.createSpan({ text: entry.message });
    }
  }
}
