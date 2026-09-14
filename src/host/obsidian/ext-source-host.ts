/**
 * @module host/obsidian/ext-source-host
 * @description Obsidian [ext] 文件级读取适配器：vault 全文件列表 + metadataCache frontmatter + cachedRead
 *
 * 查询级使用：仅在当前查询含 [ext] 时被调用；不缓存、不订阅事件、不进索引器。
 */

import { App } from "obsidian";
import type { IExtSourceHost, IFileMeta } from "../types";
import { toMeta } from "./file-meta";

export class ObsidianExtSourceHost implements IExtSourceHost {
  constructor(private app: App) {}

  /**
   * 列出目录集合（含子目录）下的全部文件（md + 非 md），不做后缀过滤。
   * 目录匹配语义与执行器 matchFolder 的 folder 分支一致（根目录 "" = 全库范围，即 FROM 本身）。
   */
  async listFiles(folderPaths: string[]): Promise<IFileMeta[]> {
    if (folderPaths.length === 0) return [];
    const wanted = folderPaths.map((p) => p.toLowerCase());
    return this.app.vault
      .getFiles()
      .filter((file) => {
        const folderRaw = file.parent?.path ?? "";
        const folder = (folderRaw === "/" ? "" : folderRaw).toLowerCase();
        return wanted.some((p) => p === "" || folder === p || folder.startsWith(`${p}/`));
      })
      .map(toMeta);
  }

  /** md 官方路径：metadataCache 的 frontmatter（无则 null），无任何兜底 */
  async readMd(path: string): Promise<Record<string, unknown> | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    return this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
  }

  /** 非 md 自研路径前置：cachedRead 原文；文件不存在（race）返回 null */
  async readNonMdText(path: string): Promise<string | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    return this.app.vault.cachedRead(file);
  }

  /** 正文读取（SEARCH 用）：cachedRead 原文 + md frontmatter 结束偏移（剥离在 core 做） */
  async readBody(path: string): Promise<{ text: string; frontmatterEnd: number | null } | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    const text = await this.app.vault.cachedRead(file);
    let frontmatterEnd: number | null = null;
    if (file.extension === "md") {
      const pos = this.app.metadataCache.getFileCache(file)?.frontmatterPosition;
      if (pos) frontmatterEnd = pos.end.offset;
    }
    return { text, frontmatterEnd };
  }
}
