import type { TFile } from "obsidian";
import { EMPTY, type DataRow, type FieldValue } from "../types";

/**
 * 行构造：Obsidian metadataCache 的解析结果 → DataRow。
 * frontmatter 的所有键原样进入 fields（含 Breadcrumbs 关系字段），插件不做解释。
 *
 * DSQL 1.5 摄取归一：
 * - 键存在但值为 null/undefined（`字段:`，受限近似含 `字段: null` / `~`，见规范 §3 受限标注 ①）→ EMPTY 哨兵；
 * - `字段: ""` / `字段: []`（空容器）→ null；
 * - 缺失键不入 fields（查询求值 null，不是 empty 值）。
 */
export function buildRow(
  file: TFile,
  frontmatter: Record<string, unknown> | null | undefined,
  outlinks: string[],
  inlinks: string[],
): DataRow {
  const fields: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (key === "position") continue; // metadataCache 内部字段
    fields[key] = normalizeValue(value);
  }

  const folder = file.parent?.path ?? "";
  return {
    path: file.path,
    file: {
      path: file.path,
      name: file.basename,
      folder: folder === "/" ? "" : folder,
      ext: file.extension,
      size: file.stat.size,
      ctime: file.stat.ctime,
      mtime: file.stat.mtime,
      outlinks: [...outlinks],
      inlinks: [...inlinks],
    },
    fields,
  };
}

/** frontmatter 值 → 查询友好值：链接对象取路径，空容器归一 null，未赋值归一 EMPTY。 */
function normalizeValue(value: unknown): FieldValue {
  if (value == null) return EMPTY;
  if (value === "") return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map(normalizeValue);
  }
  if (typeof value === "object") {
    // Obsidian 链接缓存形如 { path?: string } 的情况
    const obj = value as Record<string, unknown>;
    if (typeof obj.path === "string") return obj.path;
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}
