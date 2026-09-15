/**
 * @module render/panel-view
 * @description 看板面板渲染：DSQL 编辑 + 查询执行 + 三视图结果区分派（纯 UI，只吃 PanelDeps）
 */

import { collectExtFilters, executeQuery, matchSource, type QueryDebug, type ResultSet } from "@dsql/executor";
import { parseQuery, QueryParseError } from "@dsql/parser";
import {
  IMPLEMENTED_VIEWS,
  VIEW_LABELS,
  type DataRow,
  type FieldValue,
  type ViewType,
} from "@dsql/types";
import type { PanelDeps } from "@host/types";
import { failedListForRender, loadBodies, loadExtRows } from "@index/ext-source";
import { renderCardView } from "@render/card-view";
import { buildExport, filterRows, resolveExportPath, rowSearchText } from "@render/export";
import { renderListView } from "@render/list-view";
import { renderTableView } from "@render/table-view";
import type { BoardDef } from "@settings/schema";
import { applyViewType, detectTypeFromSql } from "@utils/viewSync";

/** 面板控制器：视图壳持有并驱动其生命周期 */
export interface PanelController {
  /** 订阅数据/看板变更并首次渲染 */
  mount(): Promise<void>;
  /** 整体重绘（看板切换或外部变更） */
  render(): Promise<void>;
  /** 只重跑查询结果区（不动编辑器；[ext] 查询刷新兜底用） */
  rerun(): void;
  /** 落盘防抖保存并退订全部订阅 */
  dispose(): void;
}

/**
 * 创建看板面板控制器。
 *
 * @param root - 宿主容器（由视图壳提供，如 ItemView.contentEl）
 * @param getBoardId - 当前看板 id 读取器（状态在视图壳）
 * @param isVisible - 容器可见性判定（由视图壳提供）
 * @param deps - 面板依赖契约
 * @returns 面板控制器
 */
export function createPanelController(
  root: HTMLElement,
  getBoardId: () => string,
  isVisible: () => boolean,
  deps: PanelDeps,
): PanelController {
  let unsubStore: (() => void) | null = null;
  let unsubBoards: (() => void) | null = null;
  /** 当前渲染的看板 id；变化时才整体重绘 */
  let renderedBoardId: string | null = null;
  let resultWrap: HTMLElement | null = null;
  let saveTimer: number | null = null;
  let viewSelect: HTMLSelectElement | null = null;
  let searchInput: HTMLInputElement | null = null;
  let exportInput: HTMLInputElement | null = null;
  /** 搜索词（会话内临时状态，不持久化到 data.json；三视图通用） */
  let searchTerm = "";
  /** 导出路径（会话内临时状态，不持久化到 data.json） */
  let exportPath = "";
  /** 最近一次成功执行的结果集：搜索过滤与导出的数据来源 */
  let lastResult: ResultSet | null = null;
  /** 最近一次渲染是否隐藏「文件」列（导出列结构与之一致） */
  let lastWithoutId = false;
  /** 当前结果区标签页（每次重跑回到「查询结果」） */
  let resultTab: "result" | "debug" = "result";
  /** 结果区请求序号：[ext] 异步读取期间的竞态守卫（只渲染最新一次） */
  let resultRun = 0;

  const currentBoard = (): BoardDef | undefined =>
    deps.settings().boards.find((b) => b.id === getBoardId());

  const onExternalChange = (): void => {
    if (root.contains(document.activeElement) && renderedBoardId) return;
    void render();
  };

  const scheduleSave = (): void => {
    if (saveTimer != null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => flushSave(), 500);
  };

  const flushSave = (): void => {
    if (saveTimer != null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    void deps.saveSettings();
    // R3 反向同步：保存时若 SQL 开头有合法视图关键词，自动切下拉
    syncSelectFromSql();
  };

  /**
   * R3 反向同步：读取当前 board.sql，按 detectTypeFromSql 判断是否要切下拉。
   * - 返回非空 + 与 board.viewType 不一致 → 切下拉并设 board.viewType
   * - 返回 null → 下拉保持当前状态（不强制切到跟随语句）
   */
  const syncSelectFromSql = (): void => {
    const board = currentBoard();
    if (!board || !viewSelect) return;
    const detected = detectTypeFromSql(board.sql);
    if (detected && detected !== board.viewType) {
      board.viewType = detected;
      viewSelect.value = detected;
      void deps.saveSettings();
    }
  };

  async function render(): Promise<void> {
    root.empty();
    root.addClass("datashow-panel");

    const board = currentBoard();
    if (!board) {
      renderedBoardId = null;
      root.createDiv({
        cls: "datashow-panel__empty",
        text: "看板不存在或已被删除（可在插件设置中重新创建）。",
      });
      return;
    }
    const prevBoardId = renderedBoardId;
    renderedBoardId = board.id;

    // 看板真正切换时清空搜索词（同一看板因外部元数据变更重绘时不清，避免误清用户输入）
    if (prevBoardId !== board.id) {
      searchTerm = "";
    }

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
      scheduleSave();
    });

    // ---- 工具条：左（搜索组 + 导出组） + 右（刷新 + 视图模式） ----
    const toolbar = root.createDiv({ cls: "datashow-toolbar" });

    // 搜索控件：输入框 + 搜索 + 清空（三视图通用；独立成组，窄屏整体换行到第二行）
    const searchGroup = toolbar.createDiv({ cls: "datashow-toolbar__search-group" });
    const input = searchGroup.createEl("input", {
      cls: "datashow-toolbar__search",
      attr: { type: "text", placeholder: "🔍 搜索..." },
    }) as HTMLInputElement;
    input.value = searchTerm;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applySearch();
      }
    });
    searchGroup
      .createEl("button", { cls: "datashow-toolbar__btn", text: "搜索" })
      .addEventListener("click", () => applySearch());
    searchGroup
      .createEl("button", { cls: "datashow-toolbar__btn", text: "清空" })
      .addEventListener("click", () => clearSearch());
    searchInput = input;

    // 导出控件：vault 相对路径 + 导出（按扩展名分派 json / csv；xlsx 明确不支持，见 render/export）
    const exportGroup = toolbar.createDiv({ cls: "datashow-toolbar__export-group" });
    const exportPathInput = exportGroup.createEl("input", {
      cls: "datashow-toolbar__export",
      attr: { type: "text", placeholder: "导出路径（vault 相对路径）" },
    }) as HTMLInputElement;
    exportPathInput.value = exportPath;
    exportPathInput.addEventListener("input", () => {
      exportPath = exportPathInput.value;
    });
    exportPathInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void doExport();
      }
    });
    exportGroup
      .createEl("button", { cls: "datashow-toolbar__btn", text: "导出" })
      .addEventListener("click", () => void doExport());
    exportInput = exportPathInput;

    toolbar.createDiv({ cls: "datashow-toolbar__spacer" });
    toolbar
      .createEl("button", { cls: "datashow-toolbar__btn", text: "刷新" })
      .addEventListener("click", () => { void renderResult(false); });
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
        void deps.saveSettings();
        void renderResult();
        return;
      }
      // 强制覆盖：用 applyViewType 同步 SQL 开头关键词与 viewType
      applyViewType(board, newType);
      // 同步回编辑器
      textarea.value = board.sql;
      void deps.saveSettings();
      void renderResult();
    });
    viewSelect = select;

    // ---- 结果区（独立刷新） ----
    resultWrap = root.createDiv({ cls: "datashow-result" });
    void renderResult(false);
  }

  /**
   * 只重跑查询结果区（不动编辑器）。
   *
   * @param keepTab - true 时保留当前标签页状态；false 时强制切到「查询结果」
   */
  async function renderResult(keepTab: boolean = false): Promise<void> {
    if (!resultWrap || !isVisible()) return;
    const board = currentBoard();
    if (!board) return;

    // 仅当不保留时才重置为结果页（看板切换或手动刷新）
    if (!keepTab) {
      resultTab = "result";
    }

    // 竞态守卫：[ext] 文件级读取为异步，期间的更新请求以最新一次为准
    const runId = ++resultRun;

    const wrap = resultWrap;
    wrap.empty();
    lastResult = null;
    lastWithoutId = false;

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
    /** [ext] 文件级读取的失败文件（解析失效，渲染在结果区尾部） */
    let failedFiles: string[] = [];
    try {
      query = parseQuery(sql);
      // [ext] 文件级读取（WHERE 第一步）：没写 [ext] → 完全现状，零额外读取
      const extState = collectExtFilters(query.where);
      let extRows: DataRow[] = [];
      if (extState !== null) {
        const loaded = await loadExtRows(extState, query.from, deps.extSource);
        if (runId !== resultRun) return;
        extRows = loaded.rows;
        failedFiles = loaded.failed;
      }
      // SEARCH 正文预读：仅查询含 SEARCH 时按 FROM 命中范围（含 [ext] 并入行）读 body，
      // 随行临时携带、不缓存；无 SEARCH → 零 body 读取
      const parsed = query;
      let bodies: Map<string, string> | undefined;
      const allRows = deps.rows.all(); // 复用同一次快照（store.all() 每次都是排序拷贝）
      if (parsed.search !== null) {
        const mdRows = allRows.filter((row) => matchSource(parsed.from, row));
        bodies = await loadBodies([...mdRows, ...extRows], deps.extSource);
        if (runId !== resultRun) return;
      }
      result = executeQuery(query, allRows, null, {
        debug: deps.settings().showDebug,
        // DSQL 1.5：摄取期容错警告（如重复键剔除的文件）随调试信息输出
        ingestWarnings: deps.rows.ingestWarnings(),
        extRows,
        bodies,
      });
    } catch (err) {
      error = err instanceof QueryParseError ? err.message : String((err as Error).message ?? err);
    }

    // 搜索过滤与导出的数据来源：仅在本次执行成功时刷新（失败时导出无内容）
    if (!error && result) {
      lastResult = result;
      lastWithoutId = query?.withoutId ?? false;
    }

    // 标签栏：查询结果 / 调试信息
    const hasDebug = !error && !!result?.debug;
    const tabs = wrap.createDiv({ cls: "datashow-tabs" });
    const content = wrap.createDiv({ cls: "datashow-tabcontent" });
    const btnResult = tabs.createEl("button", { cls: "datashow-tabs__tab", text: "查询结果" });
    const btnDebug = hasDebug
      ? tabs.createEl("button", { cls: "datashow-tabs__tab", text: "调试信息" })
      : null;
    if (!keepTab) resultTab = "result";

    const renderPane = (): void => {
      content.empty();
      btnResult.toggleClass("is-active", resultTab === "result");
      btnDebug?.toggleClass("is-active", resultTab === "debug");
      if (resultTab === "debug" && btnDebug && result?.debug) {
        renderDebug(content, result.debug);
        return;
      }
      content.createDiv({ cls: "datashow-result__label", text: "查询结果" });
      // 视图决策：board.viewType 非空 → 强制覆盖；空 → 跟随 SQL 关键词（解析失败回退到 TABLE_VIEW）
      const view: ViewType =
        board.viewType !== ""
          ? board.viewType
          : result?.view ?? detectTypeFromSql(sql) ?? "TABLE_VIEW";
      if (error || !result || !query) {
        if (error) content.createDiv({ cls: "datashow-result__error", text: error });
        return;
      }
      if (result.rows.length === 0) {
        content.createDiv({ cls: "datashow-result__empty", text: "查询结果为空（0 行）。" });
      } else {
        renderResultByView(content, view, query.withoutId, result);
        // 搜索过滤对三视图统一生效（渲染后套用，不改写行数据）
        applyFilter();
      }
      // [ext] 解析失效文件渲染在结果区尾部（0 行时同样显示）
      if (failedFiles.length > 0) renderFailedFiles(content, failedFiles);
    };
    btnResult.addEventListener("click", () => {
      resultTab = "result";
      renderPane();
    });
    btnDebug?.addEventListener("click", () => {
      resultTab = "debug";
      renderPane();
    });
    renderPane();
  }

  /** 按 view 分派到 TableView / ListView / CardView（v2.0 三视图平等） */
  function renderResultByView(wrap: HTMLElement, view: ViewType, withoutId: boolean, result: ResultSet): void {
    const decimalPlaces = deps.settings().decimalPlaces;
    const onOpenFile = (row: DataRow): void => {
      void deps.opener.openFile(row.path);
    };
    const onSaveField = (row: DataRow, fieldPath: string, value: FieldValue): Promise<void> =>
      deps.frontmatter.setField(row.path, fieldPath, value);
    // 行文本与导出过滤共用同一取值口径（文件标题 + 列名 + 显示值）
    const searchText = (row: DataRow): string => rowSearchText(result, row, decimalPlaces);

    let viewEl: HTMLElement;
    if (view === "CARD_VIEW") {
      viewEl = renderCardView({ result, decimalPlaces, onSaveField, onOpenFile, searchText });
    } else if (view === "LIST_VIEW") {
      viewEl = renderListView({ result, decimalPlaces, onOpenFile, searchText });
    } else {
      viewEl = renderTableView({ result, withoutId, decimalPlaces, onOpenFile, searchText });
    }
    wrap.appendChild(viewEl);
  }

  /** 应用搜索：保留输入框当前值，仅重套 DOM 过滤（不重跑查询）。 */
  function applySearch(): void {
    if (!searchInput) return;
    searchTerm = searchInput.value;
    applyFilter();
  }

  /** 清空搜索：清空输入框与搜索词，恢复全部行。 */
  function clearSearch(): void {
    searchTerm = "";
    if (searchInput) searchInput.value = "";
    applyFilter();
  }

  /**
   * 全视图搜索过滤（DOM 后置过滤，不改写行数据）：
   * 遍历三种视图的行元素（表格 tr / 列表 li / 卡片 div），按行文本不区分大小写子串匹配；
   * 行文本取自行元素的 data-search-text（与导出过滤同一口径）；
   * 全部隐藏时显示「没有匹配的条目」；卡片视图额外隐藏没有可见卡片的列。
   */
  function applyFilter(): void {
    const container = resultWrap;
    if (!container) return;

    // 清掉上一次搜索留下的空结果提示
    container.querySelector(".datashow-search__empty")?.remove();

    const term = searchTerm.trim().toLowerCase();
    const nodes = container.querySelectorAll<HTMLElement>(".datashow-row");
    let visible = 0;
    nodes.forEach((node) => {
      const text = (node.dataset.searchText ?? node.textContent ?? "").toLowerCase();
      const hit = term === "" || text.includes(term);
      node.style.display = hit ? "" : "none";
      if (hit) visible++;
    });

    // 卡片视图：列内卡片全部隐藏时整列隐藏（列头计数保持原值）
    container.querySelectorAll<HTMLElement>(".datashow-kanban__column").forEach((column) => {
      const cards = column.querySelectorAll<HTMLElement>(".datashow-card");
      let anyVisible = false;
      cards.forEach((card) => {
        if (card.style.display !== "none") anyVisible = true;
      });
      column.style.display = anyVisible ? "" : "none";
    });

    if (term !== "" && nodes.length > 0 && visible === 0) {
      const empty = document.createElement("div");
      empty.className = "datashow-result__empty datashow-search__empty";
      empty.textContent = "没有匹配的条目";
      container.appendChild(empty);
    }
  }

  /**
   * 导出当前结果：路径合法 → 按扩展名分派格式 → 写入 vault。
   * 导出行为搜索过滤后的行集（搜索框为空则为全部行），与视图无关。
   */
  async function doExport(): Promise<void> {
    if (!exportInput) return;
    exportPath = exportInput.value;
    if (!lastResult) {
      deps.ui.notify("导出失败：当前没有可导出的查询结果");
      return;
    }
    const resolved = resolveExportPath(exportPath);
    if (!resolved.ok) {
      deps.ui.notify(`导出失败：${resolved.reason}`);
      return;
    }
    const rows = filterRows(lastResult, searchTerm, deps.settings().decimalPlaces);
    const payload = buildExport(
      resolved.format,
      lastResult,
      rows,
      lastWithoutId,
      deps.settings().decimalPlaces,
    );
    try {
      await deps.exporter.writeExport(resolved.path, payload.data);
      deps.ui.notify(`已导出 ${rows.length} 行到 ${resolved.path}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.ui.notify(`导出失败：${message}`);
    }
  }

  /**
   * 解析失效文件（[ext] 非 md 读取失败，warn / error 同桶）：YAML 值渲染在结果区尾部一行，
   * 走 IYamlCodec.stringify；label 计数 = 渲染条数（截断后），路径已按 UTF-8 字节序排序。
   */
  function renderFailedFiles(wrap: HTMLElement, failed: string[]): void {
    const { shown, count } = failedListForRender(failed, deps.settings().failedFileListLimit);
    const div = wrap.createDiv({ cls: "datashow-result__failed" });
    div.createSpan({ cls: "datashow-result__failed-label", text: `解析失效 ${count}` });
    div.createSpan({ cls: "datashow-result__failed-list", text: deps.codec.stringify(shown).trim() });
  }

  /** 调试信息（逐操作 + 字段缺失 + 警告 + 数据源统计 + 耗时） */
  function renderDebug(wrap: HTMLElement, dbg: QueryDebug): void {
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
    for (const stat of dbg.search ?? []) {
      entries.push({
        op: "SEARCH",
        message: `${stat.alias}（/${stat.pattern}/）：命中 ${stat.hits}，未命中 ${stat.misses}` +
          (stat.samples.length > 0 ? `，示例：${stat.samples.join("、")}` : ""),
      });
    }
    for (const msg of dbg.count ?? []) {
      entries.push({ op: "COUNT", message: msg });
    }
    for (const msg of dbg.domains ?? []) {
      entries.push({ op: "DOMAIN", message: msg });
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

  return {
    async mount(): Promise<void> {
      unsubBoards = deps.onBoardsChange(() => onExternalChange());
      unsubStore = deps.rows.subscribe(() => { void renderResult(true); });
      if (getBoardId()) await render();
    },
    render,
    rerun(): void {
      void renderResult(true);
    },
    dispose(): void {
      flushSave();
      unsubBoards?.();
      unsubStore?.();
    },
  };
}
