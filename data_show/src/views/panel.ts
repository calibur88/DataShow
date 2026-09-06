import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type DatashowPlugin from "../main";
import { evaluateExpr, executeQuery, type QueryDebug, type ResultSet } from "../query/executor";
import { parseQuery, QueryParseError } from "../query/parser";
import { FrontmatterEditModal } from "./frontmatter-modal";
import {
  IMPLEMENTED_VIEWS,
  PANEL_VIEW_TYPE,
  VIEW_LABELS,
  type BoardDef,
  type DataRow,
  type FieldValue,
  type PanelViewState,
} from "../types";

/**
 * 主工作区看板面板：
 * - 头部：看板名称 + 类型 + 作用描述
 * - DSQL 编辑器：直接编辑、防抖自动保存到看板定义
 * - 工具条：刷新按钮 + 视图类型选择
 * - 查询结果：随索引/看板变化自动重跑
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

    // ---- 头部：名称 + 类型徽标 ----
    const header = root.createDiv({ cls: "datashow-panel__header" });
    header.createDiv({ cls: "datashow-panel__title", text: board.name || "（未命名看板）" });
    if (board.type.trim()) {
      header.createDiv({ cls: "datashow-panel__type", text: board.type });
    }

    // ---- 作用描述（说明移到头部下方） ----
    if (board.description.trim()) {
      root.createDiv({ cls: "datashow-panel__description", text: board.description });
    }

    // ---- DSQL 编辑器 ----
    const editorWrap = root.createDiv({ cls: "datashow-editor" });
    editorWrap.createDiv({ cls: "datashow-editor__label", text: "DSQL" });
    const textarea = editorWrap.createEl("textarea", { cls: "datashow-editor__input" });
    textarea.value = board.sql;
    textarea.placeholder =
      '**TABLE** **SELECT** status **AS** 状态, owner **AS** 负责人\n**FROM** "Notes"\n**WHERE** status %==% \'进行中\'\n**SORT** status **BY** (\'已完成\', \'进行中\')\n**LIMIT** 20';
    textarea.spellcheck = false;
    textarea.addEventListener("input", () => {
      board.sql = textarea.value;
      this.scheduleSave();
    });

    // ---- 工具条：刷新 + 视图类型 ----
    const toolbar = root.createDiv({ cls: "datashow-toolbar" });
    toolbar.createEl("button", { cls: "datashow-toolbar__btn", text: "刷新" }).addEventListener(
      "click",
      () => this.renderResult(),
    );

    toolbar.createDiv({ cls: "datashow-toolbar__spacer" });
    toolbar.createSpan({ cls: "datashow-toolbar__label", text: "视图" });
    const select = toolbar.createEl("select", { cls: "datashow-toolbar__select" }) as HTMLSelectElement;
    const options: { value: string; label: string }[] = [
      { value: "", label: "跟随语句" },
      ...IMPLEMENTED_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] })),
    ];
    for (const opt of options) {
      const o = select.createEl("option", { text: opt.label }) as HTMLOptionElement;
      o.value = opt.value;
    }
    select.value = board.viewOverride;
    select.addEventListener("change", () => {
      board.viewOverride = select.value;
      void this.plugin.saveSettings();
      this.renderResult();
    });

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
  }

  /** 只重跑查询结果区（不动编辑器）。 */
  private renderResult(): void {
    if (!this.resultWrap || !this.resultWrap.isShown()) return;
    const board = this.currentBoard();
    if (!board) return;

    const wrap = this.resultWrap;
    wrap.empty();
    wrap.createDiv({ cls: "datashow-result__label", text: "查询结果" });

    const sql = board.sql.trim();
    if (!sql) {
      wrap.createDiv({ cls: "datashow-result__empty", text: "尚未编写 DSQL，在上方输入即可。" });
      return;
    }

    try {
      const query = parseQuery(sql);
      const result = executeQuery(query, this.plugin.store.all(), null, {
        debug: this.plugin.settings.showDebug,
      });
      const view = board.viewOverride === "table" || board.viewOverride === "list"
        ? board.viewOverride
        : result.view;
      // SELECT 投影在渲染期逐格求值，这里同步收集字段缺失，并入调试信息
      const projMisses = this.plugin.settings.showDebug
        ? new Map<string, import("../query/executor").FieldMiss>()
        : null;
      this.renderResultSet(wrap, view === "list", query.withoutId, result, projMisses);
      if (result.debug) {
        this.renderDebug(wrap, result.debug, projMisses);
      }
    } catch (err) {
      const msg = err instanceof QueryParseError ? err.message : String((err as Error).message ?? err);
      wrap.createDiv({ cls: "datashow-result__error", text: msg });
    }
  }

  private renderResultSet(
    wrap: HTMLElement,
    asList: boolean,
    withoutId: boolean,
    result: ResultSet,
    projMisses: Map<string, import("../query/executor").FieldMiss> | null = null,
  ): void {
    if (result.rows.length === 0) {
      wrap.createDiv({ cls: "datashow-result__empty", text: "查询结果为空（0 行）。" });
      return;
    }

    if (asList) {
      const list = wrap.createEl("ul", { cls: "datashow-result__list" });
      for (const row of result.rows) {
        const li = list.createEl("li");
        li.addClass("datashow-result__item");
        li.title = "点击编辑笔记属性";
        li.addEventListener("click", () => this.openFrontmatter(row));
        this.makeFileLink(li, row);
      }
      wrap.createDiv({ cls: "datashow-result__count", text: `${result.rows.length} 项` });
      return;
    }

    const table = wrap.createEl("table", { cls: "datashow-result__table" });
    const headRow = table.createEl("thead").createEl("tr");
    if (!withoutId) headRow.createEl("th", { text: "文件" });
    for (const col of result.columns) headRow.createEl("th", { text: col.alias });

    const tbody = table.createEl("tbody");
    const track = projMisses
      ? (row: DataRow, path: string, v: FieldValue) => {
          if (v == null && !path.startsWith("this.")) {
            const rec = projMisses.get(path) ?? { field: path, count: 0, sample: row.path };
            rec.count++;
            projMisses.set(path, rec);
          }
          return v;
        }
      : undefined;
    for (const row of result.rows) {
      const tr = tbody.createEl("tr");
      if (!withoutId) {
        const td = tr.createEl("td", { cls: "datashow-result__file" });
        this.makeFileLink(td, row);
        const pencil = td.createEl("a", { text: "✎", cls: "datashow-row-edit", title: "编辑笔记属性（frontmatter）" });
        pencil.addEventListener("click", (e) => {
          e.stopPropagation();
          this.openFrontmatter(row);
        });
      }
      for (const col of result.columns) {
        const td = tr.createEl("td");
        const value = evaluateExpr(col.expr, row, null, track);
        td.setText(formatCell(value, this.plugin.settings.decimalPlaces));
        // 仅直接 frontmatter 字段可双击内联编辑（file.*/this.*/表达式/数组不可）
        const path = col.expr.kind === "field" ? col.expr.path : null;
        if (path && !path.startsWith("file.") && !path.startsWith("this.") && !Array.isArray(value)) {
          td.addClass("datashow-cell--editable");
          td.title = "双击编辑，回车保存（Esc 取消）";
          td.addEventListener("dblclick", () => this.beginCellEdit(td, row, path, value));
        }
      }
    }
    wrap.createDiv({ cls: "datashow-result__count", text: `${result.rows.length} 行` });
  }

  /** 调试信息（5.6：逐操作 + 字段缺失 + 警告 + 数据源统计 + 耗时；含 SELECT 投影期字段缺失）。 */
  private renderDebug(
    wrap: HTMLElement,
    dbg: QueryDebug,
    projMisses: Map<string, import("../query/executor").FieldMiss> | null = null,
  ): void {
    const entries: { op: string; message: string; warn?: boolean }[] = [
      { op: "FROM", message: dbg.from },
    ];
    for (const stat of dbg.sourceStats) {
      entries.push({ op: "SRC", message: `${stat.source}：${stat.rows} 行` });
    }
    if (dbg.where) entries.push({ op: "WHERE", message: dbg.where });
    if (dbg.sort) entries.push({ op: "SORT", message: dbg.sort });
    if (dbg.limit) entries.push({ op: "LIMIT", message: dbg.limit });
    const allMisses = new Map(dbg.fieldMisses.map((m) => [m.field, { ...m }]));
    for (const m of projMisses?.values() ?? []) {
      const rec = allMisses.get(m.field);
      if (rec) rec.count += m.count;
      else allMisses.set(m.field, { ...m });
    }
    for (const miss of allMisses.values()) {
      entries.push({
        op: "FIELD",
        message: `字段 "${miss.field}" 在 ${miss.count} 行中不存在（示例：${miss.sample}），按 null 处理`,
        warn: true,
      });
    }
    for (const warning of dbg.warnings) {
      entries.push({ op: "WARN", message: warning, warn: true });
    }
    entries.push({ op: "TIME", message: `${dbg.executionTimeMs} ms` });

    const details = wrap.createEl("details", { cls: "datashow-debug" });
    details.createEl("summary", { text: `调试信息（${entries.length}）` });
    const list = details.createEl("ul", { cls: "datashow-debug__list" });
    for (const entry of entries) {
      const li = list.createEl("li", {
        cls: `datashow-debug__item${entry.warn ? " datashow-debug__item--warn" : ""}`,
      });
      li.createSpan({ cls: "datashow-debug__op", text: entry.op });
      li.createSpan({ text: entry.message });
    }
  }

  private makeFileLink(container: HTMLElement, row: DataRow): void {
    const link = container.createEl("a", { text: row.file.name, cls: "datashow-file-link" });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // 列表视图中点击条目=编辑属性，仅链接本身负责打开笔记
      void this.app.workspace.openLinkText(row.path, "", false);
    });
  }

  /** 打开笔记的 frontmatter 编辑弹窗。 */
  private openFrontmatter(row: DataRow): void {
    const f = this.app.vault.getAbstractFileByPath(row.path);
    if (f instanceof TFile && f.extension === "md") {
      new FrontmatterEditModal(this.app, f, () => this.renderResult()).open();
    }
  }

  /** 表格单元格内联编辑：双击 → 输入框 → 回车保存到 frontmatter。 */
  private beginCellEdit(td: HTMLElement, row: DataRow, path: string, prev: FieldValue): void {
    if (td.dataset.editing === "1") return;
    td.dataset.editing = "1";
    const original = formatCell(prev, this.plugin.settings.decimalPlaces);
    td.empty();
    const input = td.createEl("input", { cls: "datashow-cell-input" });
    input.value = prev == null ? "" : String(prev);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    const cancel = () => {
      delete td.dataset.editing;
      td.empty();
      td.setText(original);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const value = parseCellInput(input.value);
        const f = this.app.vault.getAbstractFileByPath(row.path);
        if (!(f instanceof TFile)) return cancel();
        void this.app.fileManager.processFrontMatter(f, (fm) => {
          fm[path] = value;
        }).then(() => this.renderResult()); // 索引增量更新后结果自动刷新，这里立即重绘一次
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", () => cancel());
  }
}

/** 内联编辑输入 → 字段值：空 → null；true/false/null 字面量；数字；其余为字符串。 */
function parseCellInput(raw: string): FieldValue {
  const t = raw.trim();
  if (t === "" || t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return raw;
}

function formatCell(value: FieldValue, places = 4): string {  if (value == null) return "—";
  if (Array.isArray(value)) return value.map((v) => formatCell(v, places)).join(", ");
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number" && !Number.isInteger(value)) {
    // 非整数按设置的小数位显示（仅显示层，不影响排序/计算）；超出浮点精度回退默认 4
    const p = Number.isInteger(places) && places >= 0 && places <= 100 ? places : 4;
    return String(parseFloat(value.toFixed(p)));
  }
  return String(value);
}
