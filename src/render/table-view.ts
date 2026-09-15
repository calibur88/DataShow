/**
 * @module ui/views/table-view
 * @description 表格视图（DSQL TABLE_VIEW）：只读表格，点击行打开笔记
 *
 * 不再做内联编辑（v2.0 把编辑权下放给 CardView 独占）；
 * 也不再有"点击条目打开属性弹窗"——行级 click 负责打开笔记。
 */

import { evaluateExpr, type ResultSet } from "@dsql/executor";
import type { DataRow } from "@dsql/types";
import { formatCell } from "@render/format";
import { exportHeaders } from "@render/export";

export interface TableViewArgs {
  result: ResultSet;
  /** WITHOUT ID 子句：是否隐藏文件列 */
  withoutId: boolean;
  /** 小数显示位（仅显示层） */
  decimalPlaces: number;
  /** 打开笔记回调（行点击触发） */
  onOpenFile: (row: DataRow) => void;
  /** 行搜索文本回调：写入行元素 dataset，作为全视图搜索的匹配依据 */
  searchText: (row: DataRow) => string;
}

/**
 * 渲染表格视图。
 *
 * @param args - 视图参数（结果集、WITHOUT ID、小数位、打开笔记回调、行搜索文本回调）
 * @returns 表格根元素
 */
export function renderTableView(args: TableViewArgs): HTMLElement {
  const { result, withoutId, decimalPlaces, onOpenFile, searchText } = args;
  const wrap = document.createElement("div");
  wrap.className = "datashow-result__tablewrap";

  const table = wrap.createEl("table", { cls: "datashow-result__table" });
  const headRow = table.createEl("thead").createEl("tr");
  // 表头与导出共用同一消歧口径（同名列加 `_N` 后缀），避免预览与导出列名不一致
  for (const header of exportHeaders(result, withoutId)) headRow.createEl("th", { text: header });

  const tbody = table.createEl("tbody");
  for (const row of result.rows) {
    const tr = tbody.createEl("tr");
    // datashow-row 为三视图统一的行标记（全视图搜索过滤据此定位行元素）
    tr.classList.add("datashow-result__row", "datashow-row");
    tr.dataset.searchText = searchText(row);
    tr.title = "点击打开笔记";
    tr.addEventListener("click", () => onOpenFile(row));

    if (!withoutId) {
      const td = tr.createEl("td", { cls: "datashow-result__file" });
      // 文件名同样可点击打开（事件冒泡到行 click 即可，不重复绑定）
      const link = td.createEl("span", { text: row.file.name, cls: "datashow-file-link" });
      link.addEventListener("click", (e) => {
        e.stopPropagation();
        onOpenFile(row);
      });
    }

    // DSQL 1.4：每行独立变量环境（全局 TOTAL + 本行已计算的派生变量，链式派生）
    const vars = result.globals ? new Map(result.globals) : undefined;
    for (const col of result.columns) {
      const td = tr.createEl("td");
      const value = col.total
        ? (vars?.get(col.alias) ?? null)
        : evaluateExpr(col.expr, row, null, undefined, undefined, vars);
      if (col.alias && vars) vars.set(col.alias, value);
      td.setText(formatCell(value, decimalPlaces));
    }
  }
  wrap.createDiv({ cls: "datashow-result__count", text: `${result.rows.length} 行` });
  return wrap;
}
