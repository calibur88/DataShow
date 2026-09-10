/**
 * @module host/obsidian/ui-host
 * @description Obsidian 反馈适配器：Notice 轻提示与控制台日志
 */

import { Notice } from "obsidian";
import type { IUiHost } from "../types";

const TAG = "[DataShow]";

/** 用户反馈：轻提示走 Notice，警告与错误落控制台（不打断查询）。 */
export class ObsidianUiHost implements IUiHost {
  notify(message: string): void {
    new Notice(message);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(TAG, message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(TAG, message, ...args);
  }
}
