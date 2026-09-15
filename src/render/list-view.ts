/**
 * @module render/list-view
 * @description 列表视图（DSQL LIST_VIEW）：主行（文件名 + 内容列）+ 缩进辅助子行，只读
 *
 * 投影列按**内容列 / 辅助列**两分（口径与实现同源，见 `splitListColumns`），**任何列都不会被丢弃**——
 * 与表格 / 卡片视图一致，SELECT 投影出的列在本视图中全部可见：
 *   - **主行**：文件名（点击打开笔记）+ 内容列（裸 frontmatter 字段、SEARCH 抽取字段、其余投影表达式列），
 *     逐列显示「列名 值」；
 *   - **缩进子行**：辅助列（变量池列：TOTAL / COUNT 槽位、`expr **AS** $变量$`、裸 `$x$`；
 *     域扩展合成列；虚拟列 `file.*` / `this.*`），小字弱色显示「列名 值」。
 *
 * 取值口径与表格 / 卡片视图一致：`col.total`（TOTAL / COUNT 填充的槽位）取变量表，其余求值表达式；
 * 列按**投影顺序**求值并逐列写入行级变量环境，故 `$变量$` 链式派生与视图无关。
 *
 * v2.0 改动：删除原"点击条目打开 frontmatter 弹窗"的内联编辑语义，
 * 改为"点击文件名/行 → 打开笔记"，与 TableView / CardView 行为一致。
 */

import { evaluateExpr, type ResultSet } from "@dsql/executor";
import type { DataRow, FieldValue } from "@dsql/types";
import { formatCell } from "@render/format";

/** 投影列分组结果（两组合并即全部投影列） */
export interface ListViewColumns {
  /** 内容列：主行展示（文件名之后） */
  primary: ResultSet["columns"];
  /** 辅助列：缩进子行展示（小字弱色） */
  derived: ResultSet["columns"];
}

/**
 * 投影列两分（纯函数）。
 * **辅助列** = 变量池列（TOTAL / COUNT 填充的槽位常量列 `total`、`expr **AS** $变量$` 的
 * `aliasVar`、裸 `$x$` 引用列）、域扩展合成列（`readonly`）、虚拟列 `file.*` / `this.*`；
 * 其余（裸 frontmatter 字段、SEARCH 抽取字段、函数 / 算术 / 比较等投影表达式列）为**内容列**。
 *
 * @param columns - 结果集的投影列
 * @returns 内容列与辅助列（两组合并即入参全集）
 */
export function splitListColumns(columns: ResultSet["columns"]): ListViewColumns {
  const primary: ResultSet["columns"] = [];
  const derived: ResultSet["columns"] = [];
  for (const col of columns) {
    const auxiliary =
      col.total === true ||
      col.aliasVar === true ||
      col.readonly === true ||
      col.expr.kind === "variable" ||
      (col.expr.kind === "field" &&
        (col.expr.path.startsWith("file.") || col.expr.path.startsWith("this.")));
    (auxiliary ? derived : primary).push(col);
  }
  return { primary, derived };
}

export interface ListViewArgs {
  result: ResultSet;
  decimalPlaces: number;
  onOpenFile: (row: DataRow) => void;
  /** 行搜索文本回调：写入行元素 dataset，作为全视图搜索的匹配依据 */
  searchText: (row: DataRow) => string;
}

/**
 * 渲染列表视图。
 *
 * @param args - 视图参数（结果集、小数位、打开笔记回调、行搜索文本回调）
 * @returns 列表根元素
 */
export function renderListView(args: ListViewArgs): HTMLElement {
  const { result, decimalPlaces, onOpenFile, searchText } = args;
  const wrap = document.createElement("div");
  wrap.className = "datashow-result__listwrap";

  if (result.rows.length === 0) {
    wrap.createDiv({ cls: "datashow-result__empty", text: "查询结果为空（0 行）。" });
    return wrap;
  }

  const { primary, derived } = splitListColumns(result.columns);

  const list = wrap.createEl("ul", { cls: "datashow-result__list" });
  for (const row of result.rows) {
    const li = list.createEl("li");
    // datashow-row 为三视图统一的行标记（全视图搜索过滤据此定位行元素）
    li.classList.add("datashow-result__item", "datashow-row");
    li.dataset.searchText = searchText(row);
    li.title = "点击打开笔记";
    li.addEventListener("click", () => onOpenFile(row));

    // 主行：文件名链接（点击不冒泡到 li，避免双触发）
    const link = li.createEl("a", { text: row.file.name, cls: "datashow-file-link" });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onOpenFile(row);
    });

    // 取值口径同表格视图：col.total 取变量表，其余求值；按投影顺序求值以支持 $变量$ 链式派生
    const vars = result.globals ? new Map(result.globals) : undefined;
    const values = new Map<ResultSet["columns"][number], FieldValue>();
    for (const col of result.columns) {
      const value = col.total
        ? (vars?.get(col.alias) ?? null)
        : evaluateExpr(col.expr, row, null, undefined, undefined, vars);
      if (col.alias && vars) vars.set(col.alias, value);
      values.set(col, value);
    }

    // 主行内容列：逐列「列名 值」
    if (primary.length > 0) {
      const fields = li.createSpan({ cls: "datashow-result__fields" });
      for (const col of primary) {
        const field = fields.createSpan({ cls: "datashow-result__field" });
        field.createSpan({ cls: "datashow-result__field-name", text: col.alias ?? "" });
        field.createSpan({
          cls: "datashow-result__field-value",
          text: formatCell(values.get(col), decimalPlaces),
        });
      }
    }

    // 缩进子行：辅助列
    for (const col of derived) {
      const sub = li.createDiv({ cls: "datashow-result__derived" });
      sub.createSpan({ cls: "datashow-result__derived-name", text: col.alias ?? "" });
      sub.createSpan({ text: formatCell(values.get(col), decimalPlaces) });
    }
  }
  wrap.createDiv({ cls: "datashow-result__count", text: `${result.rows.length} 项` });
  return wrap;
}
