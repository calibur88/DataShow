/**
 * 列表视图（v2.0，DSQL LIST_VIEW）—— 只读，参考 Obsidian Bases 风格。
 *
 * 每行展示：
 *   - 顶部主行：文件名（点击打开笔记）+ 标题性派生列（如 状态 / 负责人）
 *   - 缩进子行：剩余派生列（TOTAL / 变量 / file.* / this.*），只读辅助信息
 *
 * v2.0 改动：删除原"点击条目打开 frontmatter 弹窗"的内联编辑语义，
 * 改为"点击文件名/行 → 打开笔记"，与 TableView / CardView 行为一致。
 */
import { evaluateExpr, type ResultSet } from "@dsql/executor";
import type { DataRow } from "@dsql/types";

export interface ListViewArgs {
  result: ResultSet;
  decimalPlaces: number;
  onOpenFile: (row: DataRow) => void;
}

export function renderListView(args: ListViewArgs): HTMLElement {
  const { result, decimalPlaces, onOpenFile } = args;
  const wrap = document.createElement("div");
  wrap.className = "datashow-result__listwrap";

  if (result.rows.length === 0) {
    wrap.createDiv({ cls: "datashow-result__empty", text: "查询结果为空（0 行）。" });
    return wrap;
  }

  // 派生列：TOTAL / 变量 / file.* / this.* —— 作为缩进子信息
  const derived = result.columns.filter(
    (c) =>
      c.total ||
      c.expr.kind === "variable" ||
      (c.expr.kind === "field" &&
        (c.expr.path.startsWith("file.") || c.expr.path.startsWith("this."))),
  );

  const list = wrap.createEl("ul", { cls: "datashow-result__list" });
  for (const row of result.rows) {
    const li = list.createEl("li");
    li.classList.add("datashow-result__item");
    li.title = "点击打开笔记";
    li.addEventListener("click", () => onOpenFile(row));

    // 顶部主行：文件名链接（点击不冒泡到 li，避免双触发）
    const link = li.createEl("a", { text: row.file.name, cls: "datashow-file-link" });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onOpenFile(row);
    });

    if (derived.length > 0) {
      const vars = result.globals ? new Map(result.globals) : undefined;
      for (const col of derived) {
        const value = evaluateExpr(col.expr, row, null, undefined, undefined, vars);
        if (col.alias && vars) vars.set(col.alias, value);
        const sub = li.createDiv({ cls: "datashow-result__derived" });
        sub.createSpan({ cls: "datashow-result__derived-name", text: col.alias ?? "" });
        sub.createSpan({ text: formatCell(value, decimalPlaces) });
      }
    }
  }
  wrap.createDiv({ cls: "datashow-result__count", text: `${result.rows.length} 项` });
  return wrap;
}

function formatCell(value: unknown, places = 4): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.map((v) => formatCell(v, places)).join(", ");
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number" && !Number.isInteger(value)) {
    const p = Number.isInteger(places) && places >= 0 && places <= 100 ? places : 4;
    return String(parseFloat(value.toFixed(p)));
  }
  return String(value);
}
