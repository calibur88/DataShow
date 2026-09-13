/**
 * @module index/ext-source
 * @description [ext] 文件级读取与 body 预读：FROM 目录收集 → 按后缀分派两条正交解析路径 → 构造行
 *
 * 执行语义（[ext]：FROM 解析后立即并入行集——聚合遍 TOTAL 计入非 md 行——先于行级条件求值）：
 * - md → 官方路径（metadataCache frontmatter，无任何回退）；
 * - 非 md → 自研路径（cachedRead 原文 + parseYamlFallback）；
 * 两条路径不合并、不对照、不补空——同一个文件只走一条路径；失败文件剔除并计数，查询继续。
 * 禁止全库扫描：listFiles 只收 FROM 目录集合。
 * loadBodies（SEARCH 用）同样以 FROM 命中范围为界：md 剥 frontmatter、非 md 剥围栏块
 * （core/body.ts），随行临时携带、不缓存不常驻。
 */

import type { Source } from "@dsql/ast";
import {
  compareUtf8,
  collectSourceFolders,
  matchFolder,
  type ExtFilterState,
} from "@dsql/executor";
import type { DataRow } from "@dsql/types";
import type { IFileMeta } from "@host/types";
import { extractMdBody, stripFenceBlocks } from "./body";
import { buildRow } from "./row-builder";
import { parseYamlFallback } from "./yaml-fallback";

/** [ext] 文件级读取所需的宿主能力（查询级使用，无常驻状态、不建监听、不进索引器） */
export interface ExtSourceHost {
  /** 列出目录集合（含子目录）下的全部文件（md + 非 md），不做后缀过滤——后缀过滤在分派阶段做 */
  listFiles(folderPaths: string[]): Promise<IFileMeta[]>;
  /** md 官方路径：metadataCache 的 frontmatter（无则 null，不回退） */
  readMd(path: string): Promise<Record<string, unknown> | null>;
  /** 非 md 自研路径前置：cachedRead 原文；文件不存在（race）返回 null */
  readNonMdText(path: string): Promise<string | null>;
  /**
   * 正文读取（仅 SEARCH 查询使用，随行临时携带、不缓存不常驻）：
   * 返回 cachedRead 原文与 md frontmatter 结束偏移（非 md / 无 frontmatter 为 null）；
   * frontmatter 剥离与围栏剥离在 core（body.ts）按 ext 分派。文件不存在返回 null。
   */
  readBody(path: string): Promise<{ text: string; frontmatterEnd: number | null } | null>;
}

export interface ExtLoadResult {
  /** 分派得到的行（md + 非 md），由执行器按 path 去重并入 FROM 命中行集 */
  rows: DataRow[];
  /** 解析失败被剔除的非 md 文件路径（UTF-8 字节序排序，保证确定性） */
  failed: string[];
}

/**
 * 失败文件列表渲染准备：按设置上限截断，label 计数 = 渲染条数（截断后，与列表一致）。
 *
 * @param failed - 已排序的失败文件路径
 * @param limit - 设置 failedFileListLimit（非正整数按 1 处理）
 */
export function failedListForRender(failed: string[], limit: number): { shown: string[]; count: number } {
  const capped = Number.isInteger(limit) && limit >= 1 ? limit : 1;
  const shown = failed.slice(0, capped);
  return { shown, count: shown.length };
}

/**
 * 批量读取行 body（SEARCH 查询专用）：md 剥 frontmatter、非 md 剥围栏块（core/body.ts）。
 * 读取失败的行不入表 → 求值按「无 body」处理（全部 SEARCH 字段 null，不 warning）。
 *
 * @param rows - 需要正文的行（FROM 命中行 + [ext] 并入行）
 * @param host - 宿主正文能力
 * @returns path → body（仅在成功读取时入表）
 */
export async function loadBodies(rows: DataRow[], host: ExtSourceHost): Promise<Map<string, string>> {
  const bodies = new Map<string, string>();
  for (const row of rows) {
    const raw = await host.readBody(row.path);
    if (raw === null) continue;
    bodies.set(
      row.path,
      row.file.ext === "md" ? extractMdBody(raw.text, raw.frontmatterEnd) : stripFenceBlocks(raw.text),
    );
  }
  return bodies;
}

/** 非 md 解析失败（级别 warn / error 随失败分级，本次同桶渲染） */
export class YamlParseError extends Error {
  constructor(
    public level: "warn" | "error",
    reason: string,
  ) {
    super(reason);
  }
}

/**
 * 文件级读取：按 FROM 目录集合收集文件 → （读取范围为后缀并集时）按后缀筛 → 按后缀分派。
 *
 * @param exts - collectExtFilters 的三态结果；null = 没写 [ext]，直接空结果（不触发任何读取）
 * @param from - 查询的 FROM 源（目录集合语义在此展开；纯标签源返回空结果）
 * @param host - 宿主文件能力
 * @returns 行集与失败文件清单
 */
export async function loadExtRows(exts: ExtFilterState, from: Source, host: ExtSourceHost): Promise<ExtLoadResult> {
  if (exts === null) return { rows: [], failed: [] };
  const folders = collectSourceFolders(from);
  if (folders.length === 0) return { rows: [], failed: [] }; // 标签源不触发文件级非 md 读取

  let files = await host.listFiles(folders);
  if (exts instanceof Set) {
    files = files.filter((file) => exts.has(file.ext));
  } // EXT_ALL（含 []）：不筛后缀，全部文件进入分派

  const rows: DataRow[] = [];
  const failed: string[] = [];
  for (const file of files) {
    if (!matchFolder(from, file.folder)) continue; // AND / OR 目录组合语义与行级 matchSource 对齐
    try {
      rows.push(file.ext === "md" ? await readMdRow(file, host) : await readNonMdRow(file, host));
    } catch {
      failed.push(file.path); // 失败文件剔除 + 计数，查询继续，不整条失败
    }
  }
  failed.sort(compareUtf8);
  return { rows, failed };
}

/** md 官方路径（readMd）：metadataCache frontmatter，无回退、无 cachedRead、无全文解析。 */
async function readMdRow(file: IFileMeta, host: ExtSourceHost): Promise<DataRow> {
  const frontmatter = await host.readMd(file.path);
  return buildRow(file, frontmatter, [], []);
}

/** 非 md 自研路径（readNonMd）：cachedRead 原文 → 自研解析；任何失败抛出由上层剔除计数。 */
async function readNonMdRow(file: IFileMeta, host: ExtSourceHost): Promise<DataRow> {
  const text = await host.readNonMdText(file.path);
  if (text === null) throw new YamlParseError("warn", "文件不存在"); // race 保护，不静默
  const parsed = parseYamlFallback(text);
  if (!parsed.ok) throw new YamlParseError(parsed.level, parsed.reason);
  return buildRow(file, parsed.value, [], []);
}
