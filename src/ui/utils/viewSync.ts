/**
 * 视图类型与 SQL 双向同步工具（DSQL v2.0，零 Obsidian 依赖）。
 *
 * 三个工具的职责：
 * - detectTypeFromSql(sql)：识别 SQL 开头（跳过前导空白 + `--` 注释行）。
 *   命中合法视图关键词 → 返回对应 ViewType；未命中 → 返回 null（调用方按 R3 语义降级）。
 * - normalizeSqlView(sql, type)：纯函数，把 SQL 开头视图关键词强制对齐为 type。
 *   有则替换（包括旧 **TABLE** / **LIST** 词串），无则在前导空白/注释行之后注入。
 * - applyViewType(board, newType)：就地把 board.sql 与 board.viewType 同步到 newType。
 *
 * 关键边界：
 * - 空 SQL / 纯空白 / 仅注释 → detect 返回 null；normalize 注入 "**TABLE_VIEW**\n"
 * - 字符串字面量 '**TABLE_VIEW**' 不参与关键词识别（readMarked 只在 ** 包裹的 token 中匹配）
 * - 注入位置：前导空白/注释行**之后**第一个 ** 之前（保证首 token 仍是视图关键词）
 */
import type { BoardDef, ViewType } from "@dsql/types";

const VIEW_KEYWORDS: ViewType[] = ["TABLE_VIEW", "LIST_VIEW", "CARD_VIEW"];
/** 旧词也算"已有关键词"——一并替换为 type，避免下次解析报错 */
const LEGACY_OPENERS = ["**TABLE**", "**LIST**"] as const;
const NEW_OPENERS: Record<ViewType, string> = {
  TABLE_VIEW: "**TABLE_VIEW**",
  LIST_VIEW: "**LIST_VIEW**",
  CARD_VIEW: "**CARD_VIEW**",
};

const OPENERS_PATTERN = /^\s*(?:\-\-[^\n]*\n\s*)*(\*\*(?:TABLE_VIEW|LIST_VIEW|CARD_VIEW|TABLE|LIST)\*\*)/;

/**
 * 找到 SQL 开头视图关键词的 [start, end) 范围（含前导空白/注释行）。
 * 找不到 → 返回 null（调用方决定如何处理：注入 / 报错 / 默认）。
 */
function findLeadingOpenerRange(sql: string): { start: number; end: number; word: string } | null {
  const m = sql.match(OPENERS_PATTERN);
  if (!m || m.index === undefined) return null;
  const start = m.index;
  const end = start + m[0].length;
  const word = m[1]; // **TABLE_VIEW** / **LIST_VIEW** / **CARD_VIEW** / **TABLE** / **LIST**
  return { start, end, word };
}

/** SQL 字符串前导空白与 `--` 注释行结束后第一个位置（注入点） */
function findInjectionPoint(sql: string): number {
  let i = 0;
  while (i < sql.length) {
    // 跳过空白
    while (i < sql.length && (sql[i] === " " || sql[i] === "\t" || sql[i] === "\r" || sql[i] === "\n")) {
      i++;
    }
    // 跳过行注释
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    break;
  }
  return i;
}

/**
 * 识别 SQL 开头视图关键词。
 * - 命中 TABLE_VIEW / LIST_VIEW / CARD_VIEW → 返回对应 ViewType
 * - 空 SQL / 纯空白 / 仅注释 / 无关键词 → 返回 null（R1）
 * - 旧 **TABLE** / **LIST** → 也返回 null（解析器负责抛 LexError，本函数不做兼容）
 */
export function detectTypeFromSql(sql: string): ViewType | null {
  if (typeof sql !== "string" || sql.length === 0) return null;
  const range = findLeadingOpenerRange(sql);
  if (!range) return null;
  // 旧词（**TABLE** / **LIST**）不算合法 ViewType
  if (LEGACY_OPENERS.includes(range.word as (typeof LEGACY_OPENERS)[number])) {
    return null;
  }
  if (range.word === "**TABLE_VIEW**") return "TABLE_VIEW";
  if (range.word === "**LIST_VIEW**") return "LIST_VIEW";
  if (range.word === "**CARD_VIEW**") return "CARD_VIEW";
  return null;
}

/**
 * 纯函数：把 SQL 开头视图关键词强制对齐为 type。
 * - 已有合法 VIEW 关键词 → 替换为 type 对应串
 * - 旧 **TABLE** / **LIST** → 同样替换为 type 对应串（避免下次解析报错）
 * - 无任何关键词 → 在前导空白/注释行**之后**注入 type 对应串（用空格分隔）
 * - 空 SQL → 注入 "**TYPE**\n"（空看板的合法结构）
 *
 * 注入位置示例：
 *   normalizeSqlView("**SELECT** ...", "LIST_VIEW") → "**LIST_VIEW** **SELECT** ..."
 *   normalizeSqlView("-- 注释\n**SELECT** ...", "CARD_VIEW") → "-- 注释\n**CARD_VIEW** **SELECT** ..."
 *   normalizeSqlView("", "TABLE_VIEW") → "**TABLE_VIEW**\n"
 */
export function normalizeSqlView(sql: string, type: ViewType): string {
  if (typeof sql !== "string") sql = "";
  const newOpener = NEW_OPENERS[type];
  const range = findLeadingOpenerRange(sql);
  if (range) {
    return sql.slice(0, range.start) + newOpener + sql.slice(range.end);
  }
  if (sql.length === 0) return `${newOpener}\n`;
  const point = findInjectionPoint(sql);
  // point 之前是前导空白/注释行（保留）；之后用空格分隔原 SQL
  return sql.slice(0, point) + newOpener + " " + sql.slice(point);
}

/**
 * 就地修改 board：把 board.sql 与 board.viewType 同步到 newType。
 * 不会触发 saveSettings——由调用方负责持久化。
 */
export function applyViewType(board: BoardDef, newType: ViewType): void {
  board.sql = normalizeSqlView(board.sql, newType);
  board.viewType = newType;
}

/** 仅供测试：导出内部范围识别器（覆盖边界用例） */
export const __test__ = { findLeadingOpenerRange, findInjectionPoint, VIEW_KEYWORDS, LEGACY_OPENERS };
