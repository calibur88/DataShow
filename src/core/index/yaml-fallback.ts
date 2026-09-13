/**
 * @module index/yaml-fallback
 * @description 自研 YAML 子集解析器（零依赖、纯函数、Node 可单测）：只服务非 md 路径
 *
 * 方言范围（规范 §6）：
 * - 围栏共享语义：`---`（独立成行，trim() === "---"）是围栏；相邻两围栏之间构成一个块，
 *   所有块依次解析后按键合并；围栏数先校验（0 → error，奇数 → warn 整体作废）；
 * - 块内逐行分类：列表子行（`^\s*-\s+`）→ 键行（`^[^\s:][^:]*:`，键名允许中文）→
 *   其余行（嵌套缩进等）跳过不报错；
 * - 值解析：引号去引号；`[a, b]` 流式数组按逗号切；true/false/null/~/数字/裸字符串类型推断；
 * - `键:`（冒号后无值）进入挂起状态：后续 `- 子行` append 进暂存，块尾结算——
 *   暂存非空 → 整个数组作为一个值赋键（单子行也是数组）；暂存空 → 该键产出 null；
 * - 同名键按出现顺序收集：首次标量、第二次转数组、之后 push（独立计数器跟踪，禁 isArray）；
 * - 不扁平化、不去重、不做归一化（摄取层归一由 row-builder 统一处理）。
 */

/** 解析结果：成功给非空对象；失败带级别（warn 可容错 / error 硬失败）与原因 */
export type FallbackResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; level: "error" | "warn"; reason: string };

/**
 * 解析非 md 文件的 YAML 子集。
 *
 * @param text - 文件全文（cachedRead 原文）
 * @returns 解析结果；空结果（有围栏、闭合、但无任何键值）与「无围栏」同归 error
 */
export function parseYamlFallback(text: string): FallbackResult {
  const lines = text.split(/\r?\n/);
  const fences: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") fences.push(i);
  }

  // ---- 围栏数校验（先做）：奇数即整体作废，不允许跳过未闭合尾块 ----
  if (fences.length === 0) return { ok: false, level: "error", reason: "无 --- 围栏" };
  if (fences.length % 2 === 1) return { ok: false, level: "warn", reason: "围栏不闭合" };

  // ---- 逐块解析，按键合并 ----
  const out: Record<string, unknown> = {};
  const counts = new Map<string, number>();
  for (let b = 0; b < fences.length; b += 2) {
    parseBlock(lines.slice(fences[b] + 1, fences[b + 1]), out, counts);
  }

  if (Object.keys(out).length === 0) {
    return { ok: false, level: "error", reason: "有围栏、闭合、但无任何键值" };
  }
  return { ok: true, value: out };
}

/** 解析一个块（两围栏之间的行），产出的键值依次合并进 out（计数器收集同名键）。 */
function parseBlock(lines: string[], out: Record<string, unknown>, counts: Map<string, number>): void {
  let pendingKey: string | null = null;
  let stash: unknown[] = [];

  // 挂起结算：暂存非空 → 整个数组作为一个值赋键（值形状只由写法决定）；
  // 暂存空 → 该键产出 null（对齐 YAML 规范空值 → null）。
  const settle = (): void => {
    if (pendingKey === null) return;
    const value = stash.length > 0 ? stash : null;
    collect(out, counts, pendingKey, value);
    pendingKey = null;
    stash = [];
  };

  for (const line of lines) {
    // 1. 列表子行：有挂起键 → 元素走同一值解析后 append；无挂起键 → 跳过
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item) {
      if (pendingKey !== null) stash.push(parseValue(item[1].trim()));
      continue;
    }
    // 2. 键行：键名允许中文（冒号前无空白开头、无冒号的任意字符序列）
    const kv = line.match(/^([^\s:][^:]*):\s*(.*)$/);
    if (kv) {
      settle();
      const key = kv[1].trim();
      const rest = kv[2].trim();
      if (rest === "") {
        pendingKey = key; // 冒号后无值 → 挂起，等待子行或块尾结算
      } else {
        collect(out, counts, key, parseValue(rest));
      }
      continue;
    }
    // 3. 其他行（嵌套缩进非 - 行等）：跳过不报错（嵌套不可见）
  }
  settle();
}

/** 同名键收集：首次标量、第二次转数组、之后 push（计数器跟踪，禁止 Array.isArray 判断）。 */
function collect(out: Record<string, unknown>, counts: Map<string, number>, key: string, value: unknown): void {
  const n = (counts.get(key) ?? 0) + 1;
  counts.set(key, n);
  if (n === 1) {
    out[key] = value;
  } else if (n === 2) {
    out[key] = [out[key], value];
  } else {
    (out[key] as unknown[]).push(value);
  }
}

/** 值解析：引号去引号；流式数组按逗号切；true/false/null/~/数字/裸字符串类型推断。 */
function parseValue(raw: string): unknown {
  if (raw === "") return null;
  const quote = raw[0];
  if ((quote === '"' || quote === "'") && raw.length >= 2 && raw[raw.length - 1] === quote) {
    return raw.slice(1, -1);
  }
  if (raw[0] === "[" && raw[raw.length - 1] === "]") {
    const inner = raw.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((part) => parseValue(part.trim()));
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  if (/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(raw)) return parseFloat(raw);
  return raw;
}
