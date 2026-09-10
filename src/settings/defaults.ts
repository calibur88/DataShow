/**
 * @module settings/defaults
 * @description 设置默认值与看板构造：首次安装与校形回退的基准
 */

import { CONTENT_SCHEMA_VERSION, type BoardDef, type DatashowSettings } from "./schema";

/**
 * 生成看板唯一 ID。
 *
 * @returns 优先 crypto.randomUUID；不支持的环境退化为时间戳 + 随机串
 */
export function makeBoardId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 首次安装时的默认看板：名为「默认看板」，内容为空。
 *
 * @returns 空白看板定义
 */
export function makeDefaultBoard(): BoardDef {
  return {
    id: makeBoardId(),
    name: "默认看板",
    type: "",
    description: "",
    sql: "",
    viewType: "",
  };
}

/** 首次安装的默认设置：单个空白看板 + 默认展示偏好。 */
export const DEFAULT_SETTINGS: DatashowSettings = {
  openInNewTab: true,
  showDebug: false,
  decimalPlaces: 4,
  boards: [makeDefaultBoard()],
  collapsedGroups: [],
  schemaVersion: CONTENT_SCHEMA_VERSION,
};
