/**
 * @module host/obsidian/yaml-codec
 * @description Obsidian YAML 编解码适配器：parseYaml / stringifyYaml 的契约实现
 */

import { parseYaml, stringifyYaml } from "obsidian";
import type { IYamlCodec } from "../types";

/** YAML 编解码：解析失败抛出 Error，message 来自 Obsidian 解析器，可直接展示。 */
export class ObsidianYamlCodec implements IYamlCodec {
  parse(text: string): unknown {
    return parseYaml(text);
  }

  stringify(value: unknown): string {
    return stringifyYaml(value);
  }
}
