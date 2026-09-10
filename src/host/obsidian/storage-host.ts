/**
 * @module host/obsidian/storage-host
 * @description 持久化适配器：plugin.loadData / saveData 的 key 命名空间封装
 */

import { Plugin } from "obsidian";
import type { IStorageHost } from "../types";

/** 旧格式（扁平设置对象）的特征键，用于升级期兼容读取 */
const LEGACY_SETTINGS_KEYS = ["openInNewTab", "showDebug", "decimalPlaces", "boards", "collapsedGroups"];

/**
 * 持久化适配器：把 Obsidian 单块 data.json 切成按 key 命名的槽位。
 * 旧格式（扁平设置对象）仍可读为 `settings` 槽，首次保存后自动升级为槽位结构
 */
export class ObsidianStorageHost implements IStorageHost {
  constructor(private plugin: Plugin) {}

  /**
   * 读取槽位数据。
   *
   * @param key - 槽位名（settings / cache / view-state 等）
   * @returns 槽位数据；槽位不存在时返回 null
   */
  async load<T>(key: string): Promise<T | null> {
    const raw = (await this.plugin.loadData()) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (Object.prototype.hasOwnProperty.call(raw, key)) return (raw[key] as T) ?? null;
    return key === "settings" && isLegacySettings(raw) ? (raw as T) : null;
  }

  /**
   * 写入槽位数据：合并既有槽位后整体落盘。
   *
   * @param key - 槽位名
   * @param data - 待持久化的数据
   */
  async save(key: string, data: unknown): Promise<void> {
    const raw = (await this.plugin.loadData()) as Record<string, unknown> | null;
    const next: Record<string, unknown> =
      raw && typeof raw === "object" && !Array.isArray(raw) && !isLegacySettings(raw) ? { ...raw } : {};
    next[key] = data;
    await this.plugin.saveData(next);
  }
}

/** 判定 data.json 是否为升级前的扁平设置对象。 */
function isLegacySettings(raw: Record<string, unknown>): boolean {
  return LEGACY_SETTINGS_KEYS.some((key) => Object.prototype.hasOwnProperty.call(raw, key));
}
