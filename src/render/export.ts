/**
 * @module render/export
 * @description 查询结果导出：JSON / CSV 序列化与导出路径解析（纯函数，零宿主依赖）
 *
 * 口径与结果区一致：列结构取自 SELECT 投影（可选「文件」列），行集为搜索过滤后的行；
 * JSON 保留原始类型，CSV 使用显示文本。xlsx 不引入（需第三方表格库，体积过大），
 * 需要 Excel 时导出 .csv 后用 Excel 打开另存。
 */

import { evaluateExpr, type ResultSet } from "@dsql/executor";
import type { DataRow, FieldValue } from "@dsql/types";
import { formatCell } from "@render/format";

/** 支持的导出格式（由扩展名决定） */
export type ExportFormat = "json" | "csv";

/** 导出载荷：内容为文本（JSON / CSV 均为纯文本格式） */
export interface ExportPayload {
  format: ExportFormat;
  data: string;
}

/** 导出路径解析结果：合法返回规范化路径与格式，非法返回拒绝原因 */
export type ExportPathResult =
  | { ok: true; path: string; format: ExportFormat }
  | { ok: false; reason: string };

/** 支持的扩展名集合 */
const SUPPORTED_EXTENSIONS: readonly string[] = ["json", "csv"];

// ---------------------------------------------------------------- 路径解析

/**
 * 解析导出路径：vault 内相对路径（允许前导 /，/ 与 \ 均作分隔符），格式由扩展名判定。
 *
 * @param raw - 用户输入的原始路径
 * @returns 合法时返回规范化路径与格式；非法时返回拒绝原因（message 可直接展示）
 */
export function resolveExportPath(raw: string): ExportPathResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "导出路径为空" };
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\") || trimmed.startsWith("//")) {
    return { ok: false, reason: "只支持 vault 内的相对路径" };
  }
  const segments = trimmed.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) return { ok: false, reason: "导出路径无效" };
  if (segments.includes("..")) return { ok: false, reason: "路径不能越出 vault（不允许 ..）" };
  const joined = segments.join("/");
  if (/[<>:"|?*\u0000-\u001f]/.test(joined)) return { ok: false, reason: "路径含非法字符" };

  const file = segments[segments.length - 1];
  const dot = file.lastIndexOf(".");
  if (dot <= 0 || dot === file.length - 1) {
    return { ok: false, reason: "路径需以 .json / .csv 结尾" };
  }
  const ext = file.slice(dot + 1).toLowerCase();
  if (ext === "xlsx") {
    return { ok: false, reason: "暂不支持 .xlsx，请导出 .csv 后用 Excel 打开另存" };
  }
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return { ok: false, reason: `不支持的导出格式 .${ext}（仅支持 .json / .csv）` };
  }
  return { ok: true, path: joined, format: ext as ExportFormat };
}

// ---------------------------------------------------------------- 列与行投影

/**
 * 取导出表头（JSON 键 / CSV 表头）；重名列自动加序号后缀。
 *
 * @param result - 查询结果集
 * @param withoutId - 是否隐藏「文件」列（WITHOUT ID）
 * @returns 表头文本数组
 */
export function exportHeaders(result: ResultSet, withoutId: boolean): string[] {
  const headers: string[] = withoutId ? [] : ["文件"];
  const used = new Map<string, number>(withoutId ? [] : [["文件", 1]]);
  let blanks = 0;
  for (const col of result.columns) {
    const base = col.alias && col.alias !== "" ? col.alias : `列${++blanks}`;
    const seen = used.get(base);
    if (seen === undefined) {
      used.set(base, 1);
      headers.push(base);
    } else {
      used.set(base, seen + 1);
      headers.push(`${base}_${seen + 1}`);
    }
  }
  return headers;
}

/**
 * 取某行的原始取值（列顺序，含可选「文件」列）；派生列按行独立变量环境链式求值。
 *
 * @param result - 查询结果集
 * @param row - 目标行
 * @param withoutId - 是否隐藏「文件」列
 * @returns 原始类型取值数组
 */
export function rowRawValues(result: ResultSet, row: DataRow, withoutId: boolean): FieldValue[] {
  const values: FieldValue[] = withoutId ? [] : [row.file.name];
  const vars = result.globals ? new Map(result.globals) : undefined;
  for (const col of result.columns) {
    const value = col.total
      ? (vars?.get(col.alias) ?? null)
      : evaluateExpr(col.expr, row, null, undefined, undefined, vars);
    if (col.alias && vars) vars.set(col.alias, value);
    values.push(value);
  }
  return values;
}

/**
 * 行搜索文本：文件标题 + 全部列名 + 全部列显示值（空格分隔），与结果区可见文本一致。
 *
 * @param result - 查询结果集
 * @param row - 目标行
 * @param decimalPlaces - 数值显示小数位
 * @returns 供搜索匹配的行文本
 */
export function rowSearchText(result: ResultSet, row: DataRow, decimalPlaces: number): string {
  const parts: string[] = [row.file.name];
  const vars = result.globals ? new Map(result.globals) : undefined;
  for (const col of result.columns) {
    const value = col.total
      ? (vars?.get(col.alias) ?? null)
      : evaluateExpr(col.expr, row, null, undefined, undefined, vars);
    if (col.alias && vars) vars.set(col.alias, value);
    parts.push(col.alias ?? "", formatCell(value, decimalPlaces));
  }
  return parts.join(" ");
}

/**
 * 按搜索词过滤行（不区分大小写子串匹配；空词返回全部行）。
 *
 * @param result - 查询结果集
 * @param term - 已生效的搜索词
 * @param decimalPlaces - 数值显示小数位
 * @returns 命中行数组（新增数组，不改写结果集）
 */
export function filterRows(result: ResultSet, term: string, decimalPlaces: number): DataRow[] {
  const kw = term.trim().toLowerCase();
  if (kw === "") return result.rows.slice();
  return result.rows.filter((row) =>
    rowSearchText(result, row, decimalPlaces).toLowerCase().includes(kw),
  );
}

// ---------------------------------------------------------------- 序列化

/**
 * 生成 JSON 文本：数组内每行一个对象，键为列名，保留原始类型。
 *
 * @param result - 查询结果集
 * @param rows - 待导出行
 * @param withoutId - 是否隐藏「文件」列
 * @returns 格式化后的 JSON 文本（末尾换行）
 */
export function toJSON(result: ResultSet, rows: DataRow[], withoutId: boolean): string {
  const headers = exportHeaders(result, withoutId);
  const records = rows.map((row) => {
    const record: Record<string, unknown> = {};
    const values = rowRawValues(result, row, withoutId);
    headers.forEach((key, index) => {
      record[key] = toJsonValue(values[index]);
    });
    return record;
  });
  return `${JSON.stringify(records, null, 2)}\n`;
}

/**
 * 生成 CSV 文本（RFC 4180：逗号分隔、含表头、按需加引号、CRLF 行结束）。
 *
 * @param result - 查询结果集
 * @param rows - 待导出行
 * @param withoutId - 是否隐藏「文件」列
 * @param decimalPlaces - 数值显示小数位
 * @returns CSV 文本
 */
export function toCSV(
  result: ResultSet,
  rows: DataRow[],
  withoutId: boolean,
  decimalPlaces: number,
): string {
  const headers = exportHeaders(result, withoutId);
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) {
    const values = rowRawValues(result, row, withoutId).map((v) => formatCell(v, decimalPlaces));
    lines.push(values.map(csvField).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * 按格式构建导出载荷。
 *
 * @param format - 目标格式
 * @param result - 查询结果集（列结构来源）
 * @param rows - 待导出行（搜索过滤后）
 * @param withoutId - 是否隐藏「文件」列
 * @param decimalPlaces - 数值显示小数位
 * @returns 导出载荷
 */
export function buildExport(
  format: ExportFormat,
  result: ResultSet,
  rows: DataRow[],
  withoutId: boolean,
  decimalPlaces: number,
): ExportPayload {
  if (format === "csv") return { format, data: toCSV(result, rows, withoutId, decimalPlaces) };
  return { format, data: toJSON(result, rows, withoutId) };
}

/** JSON 取值归一：undefined / symbol（empty 哨兵）→ null，数组递归处理 */
function toJsonValue(value: FieldValue | undefined): unknown {
  if (value === undefined || typeof value === "symbol") return null;
  if (Array.isArray(value)) return value.map((v) => toJsonValue(v as FieldValue));
  return value;
}

/** CSV 字段转义：含逗号 / 双引号 / 换行时用引号包裹，内部引号翻倍 */
function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
