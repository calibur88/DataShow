/**
 * @module host/obsidian/frontmatter-host
 * @description frontmatter 数据侧适配器：读属性、写单字段、整体替换（fileManager 原子写回）
 */

import { App, TFile } from "obsidian";
import type { FieldValue } from "@dsql/types";
import type { IFrontmatterHost } from "../types";

/**
 * frontmatter 读写适配器。
 * 写回经 `fileManager.processFrontMatter`，索引由 metadataCache 事件增量更新，调用方无需重扫
 */
export class ObsidianFrontmatterHost implements IFrontmatterHost {
  constructor(private app: App) {}

  async read(path: string): Promise<Record<string, unknown> | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    return this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
  }

  /**
   * 写入单个字段。
   *
   * @throws 文件不存在或不是 Markdown 文件时抛出，message 可直接展示
   */
  async setField(path: string, fieldPath: string, value: FieldValue): Promise<void> {
    const file = this.resolve(path);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[fieldPath] = value;
    });
  }

  /**
   * 整体替换属性（先清空既有键，再写入）。
   *
   * @throws 文件不存在或不是 Markdown 文件时抛出，message 可直接展示
   */
  async replaceAll(path: string, fields: Record<string, unknown>): Promise<void> {
    const file = this.resolve(path);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      for (const key of Object.keys(fm)) delete fm[key];
      Object.assign(fm, fields);
    });
  }

  /**
   * 解析出可写的 Markdown 文件。
   *
   * @throws 文件不存在或不是 Markdown 文件时抛出
   */
  private resolve(path: string): TFile {
    const file = this.app.vault.getFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") {
      throw new Error(`文件 "${path}" 不存在或不是 Markdown 文件，无法保存。`);
    }
    return file;
  }
}
