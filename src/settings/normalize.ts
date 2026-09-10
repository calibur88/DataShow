/**
 * @module settings/normalize
 * @description 设置校形与版本迁移：任意来源的原始数据 → 合法的 DatashowSettings（纯函数）
 */

import { isViewType, type ViewType } from "@dsql/types";
import { DEFAULT_SETTINGS, makeBoardId } from "./defaults";
import { CONTENT_SCHEMA_VERSION, type BoardDef, type DatashowSettings } from "./schema";

/**
 * 看板字段校形：缺失字段补默认值，不认识的字段丢弃。
 *
 * 字段迁移（R2 修订）：
 *   1. `viewType` 合法 → 直接采用
 *   2. `viewType` 非法/空，但 `viewOverride` 合法 → 采用 `viewOverride`（旧数据兼容）
 *   3. 两者均非法/空 → ""
 *
 * `type` 字段不校验——保持自由分类语义（与 ViewType 解耦）。
 *
 * @param raw - 载入的原始看板字段（data.json 中未经校验的数据）
 * @returns 校形后的看板定义
 */
export function normalizeBoard(raw: Record<string, unknown>): BoardDef {
  const viewTypeRaw = typeof raw.viewType === "string" ? raw.viewType : "";
  const viewOverrideRaw = typeof raw.viewOverride === "string" ? raw.viewOverride : "";
  const finalViewType: ViewType | "" = isViewType(viewTypeRaw)
    ? viewTypeRaw
    : isViewType(viewOverrideRaw)
      ? viewOverrideRaw
      : "";
  return {
    id: typeof raw.id === "string" ? raw.id : makeBoardId(),
    name: typeof raw.name === "string" ? raw.name : "未命名看板",
    type: typeof raw.type === "string" ? raw.type : "",
    description: typeof raw.description === "string" ? raw.description : "",
    sql: typeof raw.sql === "string" ? raw.sql : "",
    viewType: finalViewType,
  };
}

/**
 * 整块设置校形：逐字段回退默认值，boards 逐个走 normalizeBoard。
 * 版本号缺失视为 CONTENT_SCHEMA_VERSION；高于当前版本时按当前规则尽力解析。
 *
 * @param raw - 载入的原始数据（可为 null / 非对象）
 * @returns 校形后的设置
 */
export function normalizeSettings(raw: unknown): DatashowSettings {
  const src: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const decimal = typeof src.decimalPlaces === "number" ? src.decimalPlaces : DEFAULT_SETTINGS.decimalPlaces;
  return {
    openInNewTab: typeof src.openInNewTab === "boolean" ? src.openInNewTab : DEFAULT_SETTINGS.openInNewTab,
    showDebug: typeof src.showDebug === "boolean" ? src.showDebug : DEFAULT_SETTINGS.showDebug,
    decimalPlaces: Number.isFinite(decimal) && decimal >= 0 && decimal <= 100 ? Math.floor(decimal) : 4,
    boards: Array.isArray(src.boards)
      ? src.boards.map((b) => normalizeBoard((b ?? {}) as Record<string, unknown>))
      : DEFAULT_SETTINGS.boards.map((b) => normalizeBoard(b as unknown as Record<string, unknown>)),
    collapsedGroups: Array.isArray(src.collapsedGroups)
      ? src.collapsedGroups.filter((v): v is string => typeof v === "string")
      : [],
    schemaVersion:
      typeof src.schemaVersion === "number" && Number.isFinite(src.schemaVersion)
        ? src.schemaVersion
        : CONTENT_SCHEMA_VERSION,
  };
}
