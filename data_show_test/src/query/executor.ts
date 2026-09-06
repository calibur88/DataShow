/**
 * DSQL v1.4 执行器。
 *
 * 两遍执行模型：第一遍聚合遍（FROM 全量命中行，**忽略 WHERE**，计算 **TOTAL** → 变量表）；
 * 第二遍投影遍（WHERE → SORT → LIMIT → SELECT 投影，$变量$ 查变量表、裸标识符查行字段）。
 * 语义：类型不匹配/除零/缺字段为非致命（求值 null，计入 warnings）；排序 UTF-8 字节序确定性方案。
 */
import type { BinOp, Expr, Query, Source } from "./ast";
import { callFunction } from "./functions";
import type { DataRow, FieldValue } from "../types";

/* ---------- 调试信息（5.6） ---------- */

export interface FieldMiss {
  field: string;
  count: number;
  sample: string;
}

export interface SourceStat {
  source: string;
  rows: number;
}

export interface QueryDebug {
  from: string;
  where: string | null;
  sort: string | null;
  limit: string | null;
  fieldMisses: FieldMiss[];
  warnings: string[];
  sourceStats: SourceStat[];
  /** DSQL 1.4：聚合遍结果（**TOTAL** 项，按 SELECT 顺序） */
  aggregates: string[];
  executionTimeMs: number;
}

export interface ResultSet {
  view: "table" | "list";
  /** 实际使用的列（SELECT * 已展开为字段并集） */
  columns: { alias: string; expr: Expr; total?: true }[];
  rows: DataRow[];
  /** DSQL 1.4：全局变量表（**TOTAL** 聚合结果，裸名键）；无聚合项时为 null */
  globals: Map<string, FieldValue> | null;
  debug?: QueryDebug;
}

export interface ExecuteOptions {
  /** 收集 DSQL 内部调试信息 */
  debug?: boolean;
}

/**
 * 执行查询。ctx 为 this 上下文（当前笔记行，看板面板场景为 null）。
 */
export function executeQuery(
  q: Query,
  rows: DataRow[],
  ctx: DataRow | null,
  opts: ExecuteOptions = {},
): ResultSet {
  const started = now();
  const enabled = opts.debug === true;
  const missing = new Map<string, FieldMiss>();
  const warnCounts = new Map<string, number>();
  const track: FieldTracker | undefined = enabled
    ? (row, path, v) => {
        if (v == null && !path.startsWith("this.")) {
          const rec = missing.get(path) ?? { field: path, count: 0, sample: row.path };
          rec.count++;
          missing.set(path, rec);
        }
        return v;
      }
    : undefined;
  const warn: WarnSink | undefined = enabled
    ? (msg) => warnCounts.set(msg, (warnCounts.get(msg) ?? 0) + 1)
    : undefined;

  // ---- FROM（含逐源统计） ----
  let matched = rows.filter((row) => matchSource(q.from, row));
  const sourceStats: SourceStat[] | null = enabled ? collectSourceStats(q.from, rows) : null;
  const fromMsg = `输入 ${rows.length} 行 → 命中 ${matched.length} 行`;

  // ---- 聚合遍（DSQL 1.4：恒忽略 WHERE，扫描 FROM 全量命中行） ----
  const totalItems = q.select === "*" ? [] : q.select.filter((c) => c.total);
  let globals: Map<string, FieldValue> | null = null;
  const aggMsgs: string[] = [];
  if (totalItems.length > 0) {
    // 别名冲突校验：AS 别名（变量命名空间）与行字段命名空间冲突 → 致命错误
    const fieldNames = new Set<string>();
    for (const row of matched) for (const k of Object.keys(row.fields)) fieldNames.add(k);
    for (const item of totalItems) {
      if (item.alias && fieldNames.has(item.alias)) {
        throw new Error(`[DSQL] 别名 '$${item.alias}$' 与现有字段名冲突，请改用其他别名`);
      }
    }
    globals = new Map();
    for (const item of totalItems) {
      const alias = item.alias!;
      let value = null;
      if (matched.length === 0) {
        warn?.("**TOTAL** 空表（FROM 命中 0 行），返回 null");
      } else if (item.expr.kind === "lit" && typeof item.expr.value === "number") {
        value = item.expr.value * matched.length; // TOTAL 1 → 总行数；TOTAL 0 → 0
      } else {
        let sum = null;
        let skipped = 0;
        for (const row of matched) {
          const v = evaluateExpr(item.expr, row, ctx, track, warn);
          if (typeof v === "number") sum = (sum ?? 0) + v;
          else if (v != null) skipped++;
        }
        if (sum == null) {
          warn?.(`**TOTAL** ${item.alias} 无数值可累加（字段缺失或全为非数值），返回 null`);
        } else {
          value = sum;
          if (skipped > 0) warn?.(`**TOTAL** ${item.alias} 跳过 ${skipped} 个非数值行`);
        }
      }
      globals.set(alias, value);
      aggMsgs.push(`${alias} = ${value === null ? "null" : value}`);
    }
  }

  // ---- WHERE ----
  let whereMsg: string | null = null;
  if (q.where) {
    const before = matched;
    matched = matched.filter((row) => truthy(evaluateExpr(q.where!, row, ctx, track, warn)));
    if (enabled) {
      const excluded = before.filter((r) => !matched.includes(r)).slice(0, 3).map((r) => r.path);
      whereMsg = `过滤 ${before.length} → ${matched.length} 行` +
        (excluded.length ? `（剔除示例：${excluded.join(", ")}）` : "");
    }
  }

  // ---- SORT ----
  let sortMsg: string | null = null;
  if (q.sort && q.sort.keys.length > 0) {
    let comparisons = 0;
    if (enabled && q.sort.keys.some((k) => k.priority?.length === 0)) {
      warn?.("**SORT** **BY** 空优先级列表（视为无自定义优先级）");
    }
    matched = sortRows(matched, q.sort, ctx, track, enabled ? () => comparisons++ : undefined);
    if (enabled) sortMsg = `${describeSort(q.sort)}，比较 ${comparisons} 次`;
  }

  // ---- LIMIT ----
  let limitMsg: string | null = null;
  if (q.limit != null) {
    const before = matched.length;
    matched = matched.slice(0, q.limit);
    if (enabled) limitMsg = `截断 ${before} → ${matched.length} 行`;
  }

  // ---- SELECT 投影 ----
  const columns = resolveColumns(q.select, matched);

  // SELECT 仅含 TOTAL 项 → 单行合成结果（行字段为空，文件名"汇总"）
  if (totalItems.length > 0 && q.select !== "*" && totalItems.length === q.select.length) {
    matched = [SYNTH_ROW];
  }

  const result: ResultSet = { view: q.view, columns, rows: matched, globals };
  if (enabled) {
    result.debug = {
      from: fromMsg,
      where: whereMsg,
      sort: sortMsg,
      limit: limitMsg,
      fieldMisses: [...missing.values()],
      warnings: [...warnCounts.entries()].map(([msg, count]) =>
        count > 1 ? `${msg}（${count} 次）` : msg,
      ),
      sourceStats: sourceStats ?? [],
      aggregates: aggMsgs,
      executionTimeMs: round1(now() - started),
    };
  }
  return result;
}

/** TOTAL-only 查询的单行合成结果 */
const SYNTH_ROW: DataRow = {
  path: "",
  file: { path: "", name: "汇总", folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, outlinks: [], inlinks: [] },
  fields: {},
};

/* ---------- SELECT 列 ---------- */

function resolveColumns(select: Query["select"], rows: DataRow[]): ResultSet["columns"] {
  if (select === "*") {
    // 自动列：结果行字段并集（UTF-8 字节序），作为字段表达式
    const keys = new Set<string>();
    for (const row of rows) for (const k of Object.keys(row.fields)) keys.add(k);
    return [...keys].sort(compareUtf8).map((field) => ({ alias: field, expr: { kind: "field", path: field } as Expr }));
  }
  return select.map((sel, i) => ({
    alias: sel.alias ?? defaultAlias(sel.expr, i),
    expr: sel.expr,
    total: sel.total,
  }));
}

function defaultAlias(expr: Expr, index: number): string {
  if (expr.kind === "field") return expr.path;
  return `列${index + 1}`;
}

/* ---------- 表达式求值 ---------- */

export type FieldTracker = (row: DataRow, path: string, value: FieldValue) => FieldValue;
export type WarnSink = (message: string) => void;

/** 求值表达式（面板渲染单元格与执行器共用）。类型不匹配等非致命 → null。 */
export function evaluateExpr(
  expr: Expr,
  row: DataRow,
  ctx: DataRow | null,
  track?: FieldTracker,
  warn?: WarnSink,
  vars?: ReadonlyMap<string, FieldValue>,
): FieldValue {
  switch (expr.kind) {
    case "lit":
      return expr.value;
    case "variable":
      return vars?.get(expr.name) ?? null;
    case "field": {
      const v = resolveField(row, expr.path, ctx);
      return track ? track(row, expr.path, v) : v;
    }
    case "call": {
      const args = expr.args.map((a) => evaluateExpr(a, row, ctx, track, warn, vars));
      try {
        return callFunction(expr.name, args);
      } catch {
        warn?.(`未知函数 ${expr.name}()`);
        return null; // 非致命
      }
    }
    case "unary": {
      if (expr.op === "not") return !truthy(evaluateExpr(expr.expr, row, ctx, track, warn, vars));
      const v = evaluateExpr(expr.expr, row, ctx, track, warn, vars);
      if (typeof v !== "number") {
        warn?.("一元正负号作用于非数字");
        return null;
      }
      return expr.op === "-" ? -v : v;
    }
    case "binary":
      return evalBinary(expr.op, expr.left, expr.right, row, ctx, track, warn, vars);
  }
}

function evalBinary(
  op: BinOp,
  left: Expr,
  right: Expr,
  row: DataRow,
  ctx: DataRow | null,
  track?: FieldTracker,
  warn?: WarnSink,
  vars?: ReadonlyMap<string, FieldValue>,
): FieldValue {
  if (op === "and") {
    return truthy(evaluateExpr(left, row, ctx, track, warn, vars)) && truthy(evaluateExpr(right, row, ctx, track, warn, vars));
  }
  if (op === "or") {
    return truthy(evaluateExpr(left, row, ctx, track, warn, vars)) || truthy(evaluateExpr(right, row, ctx, track, warn, vars));
  }
  const l = evaluateExpr(left, row, ctx, track, warn, vars);
  const r = evaluateExpr(right, row, ctx, track, warn, vars);

  switch (op) {
    case "==":
      return looseEquals(l, r);
    case "!=":
      return !looseEquals(l, r);
    case ">":
    case "<":
    case ">=":
    case "<=": {
      if (l == null || r == null) return false; // null 参与比较 → false
      const c = compareValues(l, r);
      return op === ">" ? c > 0 : op === "<" ? c < 0 : op === ">=" ? c >= 0 : c <= 0;
    }
    case "||":
      return l == null || r == null ? null : `${stringValue(l)}${stringValue(r)}`;
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
    case "^": {
      if (typeof l !== "number" || typeof r !== "number") {
        warn?.(`算术运算 %${op}% 作用于非数字`);
        return null; // 非致命
      }
      switch (op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/":
          if (r === 0) { warn?.("%/% 除零"); return null; }
          return l / r;
        case "%":
          if (r === 0) { warn?.("%%% 取模零"); return null; }
          return l % r;
        case "^": {
          const p = Math.pow(l, r);
          if (!Number.isFinite(p)) { warn?.("%^% 结果非有限数（如负数开偶次方）"); return null; }
          return p;
        }
      }
    }
  }
  return null;
}

function stringValue(v: FieldValue): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** 字段解析：file.* → 文件元数据；this.* → 上下文行；其余 → frontmatter 字段。 */
export function resolveField(row: DataRow, path: string, ctx: DataRow | null): FieldValue {
  if (path.startsWith("this.")) {
    if (!ctx) return null;
    return resolveOn(ctx, path.slice(5));
  }
  return resolveOn(row, path);
}

function resolveOn(row: DataRow, path: string): FieldValue {
  const parts = path.split(".");
  if (parts[0] === "file") {
    const key = parts[1];
    if (parts.length === 2 && key in row.file) {
      return row.file[key as keyof typeof row.file] as FieldValue;
    }
    return null;
  }
  if (parts.length === 1) return row.fields[parts[0]] ?? null;
  return row.fields[parts[0]] ?? row.fields[path] ?? null;
}

/* ---------- WHERE / 真值 / 比较 ---------- */

export function truthy(v: FieldValue): boolean {
  return v != null && v !== false && !(Array.isArray(v) && v.length === 0) && v !== "";
}

/**
 * == / != ：null 参与 → false（!= 为其取反，即 null 与非 null 比较为 true）；
 * 数字按数值；其余 UTF-8 字节精确匹配（区分大小写）；null == null → true（同一性）。
 */
function looseEquals(l: FieldValue, r: FieldValue): boolean {
  if (l == null || r == null) return l === r;
  if (typeof l === "number" && typeof r === "number") return l === r;
  return compareUtf8(stringValue(l), stringValue(r)) === 0;
}

function compareValues(l: FieldValue, r: FieldValue): number {
  if (typeof l === "number" && typeof r === "number") return l - r;
  if (typeof l === "boolean" && typeof r === "boolean") return Number(l) - Number(r);
  return compareUtf8(stringValue(l), stringValue(r));
}

const utf8Encoder = new TextEncoder();

/**
 * UTF-8 字节序比较（确定性排序）：逐字节比较，公共前缀相等则继续向后比较
 * （递归下降），短字符串在前。例：你好AAAA < 你好AAAB；"a" < "你"（0x61 < 0xE4）。
 */
export function compareUtf8(a: string, b: string): number {
  const ba = utf8Encoder.encode(a);
  const bb = utf8Encoder.encode(b);
  const n = Math.min(ba.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (ba[i] !== bb[i]) return ba[i] - bb[i];
  }
  return ba.length - bb.length;
}

/* ---------- FROM ---------- */

function matchSource(source: Source, row: DataRow): boolean {
  switch (source.kind) {
    case "folder": {
      const p = source.path.toLowerCase();
      const f = row.file.folder.toLowerCase();
      return f === p || f.startsWith(`${p}/`) || p === "";
    }
    case "tag": {
      const tags = row.fields.tags;
      if (!Array.isArray(tags)) return false;
      const want = source.tag.replace(/^#/, "").toLowerCase();
      return tags.some((t) => String(t).replace(/^#/, "").toLowerCase() === want);
    }
    case "op":
      return source.op === "and"
        ? matchSource(source.left, row) && matchSource(source.right, row)
        : matchSource(source.left, row) || matchSource(source.right, row);
  }
}

/** 收集叶子数据源及其各自命中行数（sourceStats）。 */
function collectSourceStats(source: Source, rows: DataRow[]): SourceStat[] {
  if (source.kind === "op") {
    return [
      ...collectSourceStats(source.left, rows),
      ...collectSourceStats(source.right, rows),
    ];
  }
  const describe =
    source.kind === "folder" ? `文件夹 "${source.path}"` : `标签 #${source.tag.replace(/^#/, "")}`;
  return [{ source: describe, rows: rows.filter((row) => matchSource(source, row)).length }];
}

/* ---------- SORT（多级 + 逐键自定义优先级） ---------- */

/**
 * 排序语义（5.4）：
 * - 多级：按键顺序依次比较，前者相等才比后者；
 * - 字符串 UTF-8 字节序（递归下降，短者在前）；数字按数值；布尔 false < true；
 * - null 恒排末尾（无论方向）；
 * - 自定义优先级（BY 列表）作用于其书写的排序键：列表内按位置（严格匹配），
 *   列表外排后按默认序；DESC 反转该键的非 null 部分（null 仍沉底）。
 */
function sortRows(
  rows: DataRow[],
  sort: NonNullable<Query["sort"]>,
  ctx: DataRow | null,
  track?: FieldTracker,
  onCompare?: () => void,
): DataRow[] {
  // 预计算每行的键值（Schwartzian 变换，避免比较中重复求值）
  const keyed = rows.map((row) => ({
    row,
    keys: sort.keys.map((k) => evaluateExpr(k.expr, row, ctx, track)),
  }));

  const ranks = sort.keys.map((k) => buildRank(k.priority));
  const dirOf = (i: number): 1 | -1 => {
    const d = sort.keys[i].dir ?? sort.dir ?? "asc";
    return d === "desc" ? -1 : 1;
  };

  keyed.sort((a, b) => {
    for (let i = 0; i < a.keys.length; i++) {
      onCompare?.();
      const c = compareKey(a.keys[i], b.keys[i], ranks[i], dirOf(i));
      if (c !== 0) return c;
    }
    return 0;
  });

  return keyed.map((k) => k.row);
}

type RankMap = Map<string, number> | null;

function buildRank(order: FieldValue[] | null): RankMap {
  if (!order || order.length === 0) return null;
  const map = new Map<string, number>();
  order.forEach((v, i) => map.set(stringValue(v), i));
  return map;
}

function compareKey(l: FieldValue, r: FieldValue, rank: RankMap, sign: 1 | -1): number {
  const lNull = l == null;
  const rNull = r == null;
  if (lNull || rNull) {
    if (lNull && rNull) return 0;
    return lNull ? 1 : -1; // null 恒最后，不随方向反转
  }
  if (rank) {
    const li = rank.get(stringValue(l));
    const ri = rank.get(stringValue(r));
    if (li != null && ri != null) return sign * (li - ri);
    if (li != null) return -1;
    if (ri != null) return 1;
  }
  return sign * compareValues(l, r);
}

function describeSort(sort: NonNullable<Query["sort"]>): string {
  const keys = sort.keys
    .map((k, i) => {
      const dir = k.dir ?? sort.dir ?? "asc";
      const exprDesc = k.expr.kind === "field" ? k.expr.path : "表达式";
      const prio = k.priority ? `，优先级 [${k.priority.map(stringValue).join(", ")}]` : "";
      return `${exprDesc} ${dir.toUpperCase()}${prio}`;
    })
    .join("；");
  return `多级排序：${keys}`;
}

/* ---------- 工具 ---------- */

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
