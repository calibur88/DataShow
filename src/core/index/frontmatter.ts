/**
 * @module index/frontmatter
 * @description frontmatter 原文摄取检查（纯函数，零 Obsidian 依赖）
 *
 * DSQL 1.5 摄取容错：Obsidian metadataCache 解析后重复键已被折叠为「后值覆盖前值」，
 * 丢失了重复信息，因此重复键检测基于自扫描 frontmatter 原文的顶层键
 * （规范 §3 受限标注 ②）：块内同一顶层键名出现 ≥2 次即判重复。
 */

export interface DuplicateKeyFinding {
  /** 重复的顶层键名 */
  field: string;
  /** 该键的原始键值对行（保留供 sourceStats/notes 档案排查） */
  rawLines: string[];
}

/**
 * 扫描 frontmatter 原文，返回所有重复顶层键。
 *
 * @param text - 笔记全文（至少含 frontmatter 块的原文）
 * @returns 重复键清单（无重复时为空数组）
 */
export function findDuplicateKeys(text: string): DuplicateKeyFinding[] {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") {
      end = i;
      break;
    }
  }
  if (end === -1) return [];

  const hits = new Map<string, string[]>();
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    // 顶层键：行首无缩进；缩进行 / 注释 / 列表项不属于顶层键
    const m = line.match(/^([^\s#][^:]*?):(?:\s|$)/);
    if (!m) continue;
    const key = m[1].trim();
    if (!key) continue;
    const list = hits.get(key) ?? [];
    list.push(line.trim());
    hits.set(key, list);
  }

  const findings: DuplicateKeyFinding[] = [];
  for (const [field, rawLines] of hits) {
    if (rawLines.length >= 2) findings.push({ field, rawLines });
  }
  return findings;
}
