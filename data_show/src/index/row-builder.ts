import { TFile } from "obsidian";
import type { DataRow, FieldValue, FileMeta } from "../types";

/**
 * 行构造：Obsidian metadataCache 的解析结果 → DataRow。
 * frontmatter 的所有键原样进入 fields（含 Breadcrumbs 关系字段），插件不做解释。
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

/** frontmatter 值 → 查询友好值：链接对象取路径，其余原样。 */
function normalizeValue(value: unknown): FieldValue {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(normalizeValue);
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
