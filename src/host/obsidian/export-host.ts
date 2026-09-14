/**
 * @module host/obsidian/export-host
 * @description 导出写入适配器：vault 内相对路径 → 越界校验 + 逐级建目录后写入
 */

import { App, normalizePath, TFile } from "obsidian";
import type { IExportHost } from "../types";

/** 导出写入适配器：目录自动创建，同名文件覆盖。 */
export class ObsidianExportHost implements IExportHost {
  constructor(private app: App) {}

  async writeExport(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    // 兜底越界校验：只允许落在 vault 根内的相对路径
    if (normalized.startsWith("..") || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
      throw new Error(`导出路径非法：${path}`);
    }
    await this.ensureFolder(
      normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "",
    );

    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(normalized, content);
  }

  /**
   * 逐级创建目录：vault.create 不会自动创建父目录，缺失层级需逐级 createFolder。
   *
   * @param folder - vault 内相对目录路径（空串表示根目录）
   */
  private async ensureFolder(folder: string): Promise<void> {
    if (!folder) return;
    let acc = "";
    for (const segment of folder.split("/").filter(Boolean)) {
      acc = acc ? `${acc}/${segment}` : segment;
      if (this.app.vault.getAbstractFileByPath(acc)) continue;
      await this.app.vault.createFolder(acc);
    }
  }
}
