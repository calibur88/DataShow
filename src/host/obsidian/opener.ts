/**
 * @module host/obsidian/opener
 * @description Obsidian 打开能力适配器：按路径打开笔记，可指定是否新开标签页
 */

import { App } from "obsidian";
import type { IOpener } from "../types";

/** 打开器：workspace.openLinkText 的适配（sourcePath 恒为空串，由 vault 内路径解析）。 */
export class ObsidianOpener implements IOpener {
  constructor(private app: App) {}

  /**
   * 打开笔记。
   *
   * @param path - vault 内笔记路径
   * @param options - newLeaf 为真时在新标签页打开，缺省复用已有标签页
   */
  async openFile(path: string, options?: { newLeaf?: boolean }): Promise<void> {
    await this.app.workspace.openLinkText(path, "", options?.newLeaf ?? false);
  }
}
