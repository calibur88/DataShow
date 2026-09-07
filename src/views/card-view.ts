/**
 * 卡片视图（v2.0，DSQL CARD_VIEW）—— Kanban 看板布局，独占内联编辑。
 *
 * 行为：
 * - 按「分组列」的取值拆分成若干列（Kanban 列），每列纵向堆叠卡片
 * - 分组列 = SELECT 投影中第一个具有「重复值」的裸字段列（能真正分组）；
 *   若没有任何列能分组（如所有值均唯一），则降级为单列「全部」
 * - 列头：彩色圆点 + 分组值 + 卡片数量
 * - 每张卡片：文件名（标题，点击打开笔记）+ 除分组列外逐字段（标签 + 值）
 * - 单击字段值进入编辑（文本/数字/布尔/数组）；编辑防抖 → onSaveField
 * - 派生列（TOTAL/表达式/变量/file.* 与 this.* 字段）只读（R5）
 *
 * R5 简化判定：仅当 col.expr.kind 为 field 且字段路径不以 file. / this. 开头时，
 * 该字段可编辑。其余情况（含别名 AS 派生、TOTAL 聚合、变量引用、函数调用、
 * 算术/比较表达式）一律只读。
 */
import { evaluateExpr, type ResultSet } from "../query/executor";
import type { DataRow, FieldValue } from "../types";

export interface CardViewArgs {
  result: ResultSet;
  decimalPlaces: number;
  /** 单字段编辑保存回调（panel 注入，内部走 processFrontMatter） */
  onSaveField: (row: DataRow, fieldPath: string, value: FieldValue) => Promise<void>;
  /** 打开笔记回调（卡片标题/文件名点击） */
  onOpenFile: (row: DataRow) => void;
}

/** 列头彩色圆点调色板（Kanban 常用色，按列循环取用） */
const COLUMN_COLORS = [
  "#4f8ef7", "#e06c75", "#98c379", "#d19a66",
  "#c678dd", "#56b6c2", "#e5c07b", "#61afef",
];

export function renderCardView(args: CardViewArgs): HTMLElement {
  const { result, decimalPlaces, onSaveField, onOpenFile } = args;
  const wrap = document.createElement("div");
  wrap.className = "datashow-kanban";

  if (result.rows.length === 0) {
    wrap.createDiv({ cls: "datashow-result__empty", text: "查询结果为空（0 行）。" });
    return wrap;
  }

  // 单一变量表（TOTAL 聚合结果，供派生列取值）
  const vars = result.globals ? new Map(result.globals) : undefined;

  // 选择分组列：优先「能真正分组」的裸字段列；找不到则降级单列
  const groupCol = pickGroupColumn(result.columns, result.rows, vars);

  // 按分组值切分列（键 = 格式化后的分组值），保留首次出现顺序
  const groups = new Map<string, DataRow[]>();
  if (groupCol) {
    for (const row of result.rows) {
      const key = colValue(groupCol, row, vars, decimalPlaces);
      const arr = groups.get(key);
      if (arr) arr.push(row);
      else groups.set(key, [row]);
    }
  } else {
    groups.set("全部", [...result.rows]);
  }

  let colorIdx = 0;
  for (const [key, rows] of groups.entries()) {
    const colEl = wrap.createDiv({ cls: "datashow-kanban__column" });

    const header = colEl.createDiv({ cls: "datashow-kanban__column-header" });
    header.createDiv({
      cls: "datashow-kanban__column-dot",
      attr: { style: `background: ${columnColor(colorIdx)}` },
    });
    header.createSpan({ cls: "datashow-kanban__column-title", text: key });
    header.createSpan({ cls: "datashow-kanban__column-count", text: String(rows.length) });

    const body = colEl.createDiv({ cls: "datashow-kanban__column-body" });
    for (const row of rows) {
      body.appendChild(
        buildCard(row, result.columns, groupCol, vars, decimalPlaces, onSaveField, onOpenFile),
      );
    }
    colorIdx++;
  }

  return wrap;
}

/** 渲染单张卡片：文件名标题 + 除分组列外逐字段。 */
function buildCard(
  row: DataRow,
  columns: ResultSet["columns"],
  groupCol: ResultSet["columns"][number] | null,
  vars: Map<string, FieldValue> | undefined,
  decimalPlaces: number,
  onSaveField: (row: DataRow, fieldPath: string, value: FieldValue) => Promise<void>,
  onOpenFile: (row: DataRow) => void,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "datashow-card";

  // 标题：文件名（点击打开笔记）
  const title = card.createDiv({ cls: "datashow-card__title", text: row.file.name });
  title.title = "点击打开笔记";
  title.addEventListener("click", () => onOpenFile(row));

  // 卡片正文：除分组列外的所有列（分组值已作为列头，不在卡内重复）
  for (const col of columns) {
    if (groupCol && col === groupCol) continue;
    const value = col.total
      ? (vars?.get(col.alias) ?? null)
      : evaluateExpr(col.expr, row, null, undefined, undefined, vars);
    if (col.alias && vars) vars.set(col.alias, value);

    const editable = isEditableField(col);
    const item = card.createDiv({
      cls: `datashow-card__field ${editable ? "datashow-card__field--editable" : "datashow-card__field--readonly"}`,
    });
    item.createSpan({ cls: "datashow-card__field-name", text: col.alias });
    const valueEl = item.createDiv({
      cls: "datashow-card__field-value",
      text: formatCell(value, decimalPlaces),
    });
    if (editable) {
      const path = (col.expr as { kind: "field"; path: string }).path;
      valueEl.title = "点击编辑（回车保存，Esc 取消）";
      valueEl.addEventListener("click", () =>
        beginFieldEdit(valueEl, row, path, value, decimalPlaces, onSaveField),
      );
    } else {
      valueEl.title = "派生列只读";
    }
  }

  return card;
}

/**
 * 选取分组列：优先返回第一个具有「重复值」的裸字段列（kind === "field"）；
 * 其次是第一个具有重复值的任意列；若所有列的值都唯一（不能真正分组）则返回 null。
 */
function pickGroupColumn(
  columns: ResultSet["columns"],
  rows: DataRow[],
  vars: Map<string, FieldValue> | undefined,
): ResultSet["columns"][number] | null {
  const candidates = columns.filter((c) => !c.total);
  if (candidates.length === 0) return null;
  const distinctOf = (col: ResultSet["columns"][number]): number => {
    const s = new Set<string>();
    for (const row of rows) s.add(colValue(col, row, vars, 4));
    return s.size;
  };
  for (const c of candidates) {
    if (c.expr.kind === "field" && distinctOf(c) < rows.length) return c;
  }
  for (const c of candidates) {
    if (distinctOf(c) < rows.length) return c;
  }
  // 无真正分组 → 单列「全部」
  return null;
}

/** 求某列在某行的格式化取值（分组键也复用此逻辑）。 */
function colValue(
  col: ResultSet["columns"][number],
  row: DataRow,
  vars: Map<string, FieldValue> | undefined,
  places: number,
): string {
  const value = col.total
    ? (vars?.get(col.alias) ?? null)
    : evaluateExpr(col.expr, row, null, undefined, undefined, vars);
  return formatCell(value, places);
}

function columnColor(index: number): string {
  return COLUMN_COLORS[index % COLUMN_COLORS.length];
}

/**
 * R5 简化判定：仅裸 frontmatter 字段（不以 file./this. 开头）可编辑。
 * 一切表达式/聚合/变量/函数结果列一律只读。
 */
function isEditableField(col: { expr: { kind: string; path?: string }; total?: true }): boolean {
  if (col.total) return false;
  if (col.expr.kind !== "field") return false;
  const p = col.expr.path ?? "";
  if (p.startsWith("file.")) return false;
  if (p.startsWith("this.")) return false;
  return true;
}

/** 卡片内联编辑：单击 → 输入框 → 回车保存（防抖已在 onSaveField 内实现） */
function beginFieldEdit(
  valueEl: HTMLElement,
  row: DataRow,
  path: string,
  prev: FieldValue,
  decimalPlaces: number,
  onSaveField: (row: DataRow, fieldPath: string, value: FieldValue) => Promise<void>,
): void {
  if (valueEl.dataset.editing === "1") return;
  valueEl.dataset.editing = "1";
  const original = formatCell(prev, decimalPlaces);
  valueEl.empty();
  const input = valueEl.createEl("input", { cls: "datashow-card__field-input" });
  input.value = prev == null ? "" : Array.isArray(prev) ? prev.join(", ") : String(prev);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const cancel = () => {
    delete valueEl.dataset.editing;
    valueEl.empty();
    valueEl.setText(original);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const value = parseFieldInput(input.value);
      Promise.resolve(onSaveField(row, path, value))
        .catch((err) => console.error("[DataShow] 卡片字段保存失败", err))
        .finally(cancel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", cancel);
}

function parseFieldInput(raw: string): FieldValue {
  const t = raw.trim();
  if (t === "" || t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  // 含逗号且非数字字面量 → 数组（按 ", " 拆分，再逐项 parse）
  if (t.includes(",")) {
    return t.split(",").map((s) => parseFieldInput(s) as FieldValue);
  }
  return raw;
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
