/**
 * @module dsql/executor
 * @description DSQL 执行器：按 FROM → [ext] 行并入 → SEARCH 正文抽取 → 聚合遍（TOTAL）→ WHERE → COUNT → SORT → LIMIT → SELECT 管线执行查询
 *
 * 两遍执行模型：FROM 源解析后，[ext] 行按 path 去重并入（调用方按 FROM 范围预读）；
 * SEARCH 正文抽取在聚合遍之前（TOTAL 可聚合数值抽取字段，DSQL 2.3 起）；
 * 第一遍聚合遍（FROM 全量命中行——含 [ext] 非 md 行，**忽略 WHERE**，计算 **TOTAL** → 变量表）；
 * 第二遍投影遍（WHERE → **COUNT** → SORT → LIMIT → SELECT 投影，
 * $变量$ 查变量表、裸标识符查行字段）。
 * 语义：类型不匹配/除零/缺字段为非致命（求值 null，计入 warnings）；算术 / 比较做
 * Number() 隐式转换（非原始值守卫在前，见 §6.3 补丁）；排序 UTF-8 字节序确定性方案。
 * 视图关键词仅透传 ResultSet.view，不影响数据管线（TABLE_VIEW / LIST_VIEW / CARD_VIEW）。
 */

import type { BinOp, Expr, Query, Source } from "./ast";
import { callFunction } from "./functions";
import { EMPTY, type DataRow, type FieldValue, type ViewType } from "./types";

/* ---------- 调试信息（6.6） ---------- */

export interface FieldMiss {
  field: string;
  count: number;
  sample: string;
}

export interface SourceStat {
  source: string;
  rows: number;
}

/** 结构化警告（DSQL 1.5）：type ∈ 除零 / 类型不匹配 / 未知函数 / TOTAL / SORT / duplicateKey / 摄取 等 */
export interface QueryWarning {
  type: string;
  message: string;
}

export interface QueryDebug {
  from: string;
  where: string | null;
  sort: string | null;
  limit: string | null;
  fieldMisses: FieldMiss[];
  warnings: QueryWarning[];
  sourceStats: SourceStat[];
  /** DSQL 1.4：聚合遍结果（**TOTAL** 项，按 SELECT 顺序） */
  aggregates: string[];
  /** DSQL 2.2：SEARCH 各模板命中统计（按 SEARCH 顺序） */
  search: SearchStat[];
  /** DSQL 2.3：各 COUNT 计数项结果（调试页 COUNT 行） */
  count: string[];
  executionTimeMs: number;
}

/** DSQL 2.2：单条 SEARCH 模板的命中统计（调试页） */
export interface SearchStat {
  alias: string;
  pattern: string;
  hits: number;
  misses: number;
  /** 抽取值示例（≤3） */
  samples: string[];
}

export interface ResultSet {
  /** v2.0：TABLE_VIEW / LIST_VIEW / CARD_VIEW，由 query.view 直接透传 */
  view: ViewType;
  /** 实际使用的列（SELECT * 已展开为字段并集） */
  columns: { alias: string; expr: Expr; total?: true }[];
  rows: DataRow[];
  /** DSQL 1.4：全局变量表（**TOTAL** 聚合 + DSQL 2.3 **COUNT** 计数填充的槽位，裸名键）；无聚合 / 计数项时为 null */
  globals: Map<string, FieldValue> | null;
  debug?: QueryDebug;
}

export interface ExecuteOptions {
  /** 收集 DSQL 内部调试信息 */
  debug?: boolean;
  /** DSQL 1.5：摄取期容错警告（如重复键剔除），随调试信息一并输出 */
  ingestWarnings?: { type: string; message: string }[];
  /**
   * [ext] 文件级读取产出的行（md 官方路径 + 非 md 自研路径，按后缀分派）。
   * 在聚合遍（TOTAL 恒基于 FROM 全量 md 命中行）之后、WHERE 行级过滤之前
   * 按 path 去重并入候选行集；不传 = 查询无 [ext]，行为与现状完全一致。
   */
  extRows?: DataRow[];
  /**
   * DSQL 2.2：行 path → 正文（SEARCH 查询专用，调用方按 FROM 命中范围预读；
   * md 已剥 frontmatter、非 md 已剥围栏）。缺条目的行按「无 body」求值（字段 null）。
   */
  bodies?: Map<string, string>;
}

/** 执行管线共享状态：各 stage 函数按顺序读写，executeQuery 为唯一编排者 */
interface ExecState {
  readonly q: Query;
  readonly ctx: DataRow | null;
  readonly opts: ExecuteOptions;
  readonly enabled: boolean;
  readonly missing: Map<string, FieldMiss>;
  readonly warnCounts: Map<string, { type: string; count: number }>;
  readonly track?: FieldTracker;
  readonly warn?: WarnSink;
  matched: DataRow[];
  /** FROM 阶段产物 */
  fromMsg: string;
  sourceStats: SourceStat[];
  extMerged: number;
  /** SEARCH 阶段产物（抽取前原始字段名并集缓存 + 别名清单） */
  fieldNames: Set<string> | null;
  searchAliases: string[];
  searchMsg: string | null;
  /** 聚合 / 计数填充的变量表 */
  globals: Map<string, FieldValue> | null;
}

/**
 * 执行查询。ctx 为 this 上下文（当前笔记行，看板面板场景为 null）。
 *
 * @param q - 解析后的查询 AST
 * @param rows - 全部候选行（FROM 匹配在其中进行）
 * @param ctx - this 上下文行；无上下文时传 null
 * @param opts - 可选项（debug 调试开关、ingestWarnings 摄取警告）
 * @returns 结果集（列 + 行 + 全局变量表，开启 debug 时附带调试信息）
 */
export function executeQuery(
  q: Query,
  rows: DataRow[],
  ctx: DataRow | null,
  opts: ExecuteOptions = {},
): ResultSet {
  const started = now();
  const state = createState(q, ctx, opts);

  stageFrom(state, rows);
  const searchStats = stageSearch(state);
  checkSelectAliases(state);
  const aggMsgs = stageAggregate(state);
  const whereMsg = stageWhere(state);
  const countMsgs = stageCount(state);
  const sortMsg = stageSort(state);
  const limitMsg = stageLimit(state);

  // ---- SELECT 投影 ----
  const columns = resolveColumns(q.select, state.matched, state.globals);
  // SELECT 仅含槽位 / TOTAL 项（且至少有一个 TOTAL）→ 单行合成结果（行字段为空，文件名"汇总"）
  const onlyFillers = q.select !== "*" && q.select.every((s) => s.total || s.slot);
  const hasTotal = q.select !== "*" && q.select.some((s) => s.total);
  if (hasTotal && onlyFillers) {
    state.matched = [SYNTH_ROW];
  }

  const result: ResultSet = { view: q.view, columns, rows: state.matched, globals: state.globals };
  if (state.enabled) {
    const warnings: QueryWarning[] = [...state.warnCounts.entries()].map(([msg, rec]) => ({
      type: rec.type,
      message: rec.count > 1 ? `${msg}（${rec.count} 次）` : msg,
    }));
    for (const w of state.opts.ingestWarnings ?? []) warnings.push(w);
    result.debug = {
      from: state.fromMsg,
      where: whereMsg,
      sort: sortMsg,
      limit: limitMsg,
      fieldMisses: [...state.missing.values()],
      warnings,
      sourceStats: state.sourceStats,
      aggregates: aggMsgs,
      search: searchStats ?? [],
      count: countMsgs,
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

/** file.* 内置字段名（SEARCH 别名 prepare 期冲突检查用） */
const FILE_KEYS = new Set(["path", "name", "folder", "ext", "size", "ctime", "mtime", "outlinks", "inlinks"]);

/* ---------- 管线阶段 ---------- */

function createState(q: Query, ctx: DataRow | null, opts: ExecuteOptions): ExecState {
  const enabled = opts.debug === true;
  const missing = new Map<string, FieldMiss>();
  const warnCounts = new Map<string, { type: string; count: number }>();
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
    ? (msg, type = "语义") => {
        const rec = warnCounts.get(msg) ?? { type, count: 0 };
        rec.count++;
        warnCounts.set(msg, rec);
      }
    : undefined;
  return {
    q, ctx, opts, enabled, missing, warnCounts, track, warn,
    matched: [], fromMsg: "", sourceStats: [], extMerged: 0,
    fieldNames: null, searchAliases: [], searchMsg: null, globals: null,
  };
}

/** FROM 源解析 + [ext] 文件级行并入（聚合遍之前 → TOTAL 含非 md 行；WHERE 之前 → 行级过滤覆盖之） */
function stageFrom(state: ExecState, rows: DataRow[]): void {
  let matched = rows.filter((row) => matchSource(state.q.from, row));
  if (state.opts.extRows && state.opts.extRows.length > 0) {
    const seen = new Set(matched.map((row) => row.path));
    for (const row of state.opts.extRows) {
      if (!seen.has(row.path) && matchSource(state.q.from, row)) {
        seen.add(row.path);
        matched.push(row);
        state.extMerged++;
      }
    }
  }
  state.matched = matched;
  state.sourceStats = state.enabled ? collectSourceStats(state.q.from, matched) : [];
  state.fromMsg = `输入 ${rows.length} 行 → 命中 ${matched.length} 行` +
    (state.enabled && state.extMerged > 0 ? `（含 [ext] 并入 ${state.extMerged} 行）` : "");
}

/** FROM 命中行的原始字段名并集（SEARCH 冲突检查与别名唯一性校验共享，单次构建） */
function rawFieldNames(state: ExecState): Set<string> {
  if (state.fieldNames === null) {
    const names = new Set<string>();
    for (const row of state.matched) for (const k of Object.keys(row.fields)) names.add(k);
    state.fieldNames = names;
  }
  return state.fieldNames;
}

/**
 * SEARCH（DSQL 2.2：正文抽取，在聚合遍之前——TOTAL 可聚合数值抽取字段，WHERE / SORT 才能用）。
 * prepare 期冲突（FROM 元数据收集后、抽取前）：frontmatter 字段名并集 + file.* 内置字段；
 * 行列号在 parse 期记录进 AST（SELECT / SEARCH 别名冲突才是 parse 期）。
 */
function stageSearch(state: ExecState): SearchStat[] | null {
  const { q } = state;
  if (!q.search || q.search.length === 0) return null;

  const fieldNames = rawFieldNames(state);
  for (const item of q.search) {
    if (fieldNames.has(item.alias) || FILE_KEYS.has(item.alias) || item.alias.startsWith("file.")) {
      throw new Error(
        `[DSQL] 第 ${item.line} 行第 ${item.col} 列：SEARCH 别名 '${item.alias}' 与现有字段名冲突，请改用其他别名`,
      );
    }
  }
  state.searchAliases = q.search.map((item) => item.alias);

  const stats = q.search.map((item) => ({ alias: item.alias, pattern: item.pattern, hits: 0, misses: 0, samples: [] as string[] }));
  state.matched = state.matched.map((row) => {
    const fields = { ...row.fields }; // 克隆：SEARCH 字段不写回行仓库
    for (let i = 0; i < q.search!.length; i++) {
      const item = q.search![i];
      const body = state.opts.bodies?.get(row.path);
      let value: FieldValue = null; // 无 body / 无匹配 → null（不是 empty 值，不是 ""）
      if (body !== undefined) {
        const m = item.regex.exec(body); // exec 天然只返回首个匹配
        if (m !== null) {
          value = m[1] !== undefined ? m[1] : m[0]; // 有捕获组取 m[1]，未匹配/无捕获组回落 m[0]
          fields[item.alias] = value; // 原始字符串，逐字符保留，不做类型推断
          stats[i].hits++;
          if (stats[i].samples.length < 3) stats[i].samples.push(value);
          continue;
        }
      }
      fields[item.alias] = null;
      stats[i].misses++;
    }
    return { ...row, fields };
  });

  if (state.enabled) {
    const hits = stats.reduce((sum, s) => sum + s.hits, 0);
    const misses = stats.reduce((sum, s) => sum + s.misses, 0);
    state.searchMsg = `${q.search.length} 个模板 × ${state.matched.length} 行：命中 ${hits}，未命中 ${misses}`;
  }
  return stats;
}

/** 别名唯一性行字段冲突校验（DSQL 1.5：聚合遍开始前；裸槽位仅填充不投影，不参与判定）。
 *  判定范围 = FROM 全量命中行的字段名并集（SEARCH 已把别名挂进行字段，一并计入），
 *  任一行出现过该字段名即冲突 → 致命错误。 */
function checkSelectAliases(state: ExecState): void {
  const { q } = state;
  const aliasedItems = q.select === "*" ? [] : q.select.filter((c) => c.alias && !c.slot);
  if (aliasedItems.length === 0) return;
  const fieldNames = new Set(rawFieldNames(state));
  for (const alias of state.searchAliases) fieldNames.add(alias);
  for (const item of aliasedItems) {
    if (fieldNames.has(item.alias!)) {
      throw new Error(`[DSQL] 别名 '$${item.alias}$' 与现有字段名冲突，请改用其他别名`);
    }
  }
}

/** 聚合遍（DSQL 1.4：恒忽略 WHERE，扫描 FROM 全量命中行） */
function stageAggregate(state: ExecState): string[] {
  const aggMsgs: string[] = [];
  const totalItems = state.q.select === "*" ? [] : state.q.select.filter((c) => c.total);
  if (totalItems.length === 0) return aggMsgs;

  state.globals = new Map();
  for (const item of totalItems) {
    const alias = item.alias!;
    let value = null;
    if (state.matched.length === 0) {
      state.warn?.("**TOTAL** 空表（FROM 命中 0 行），返回 null", "TOTAL");
    } else if (item.expr.kind === "lit" && typeof item.expr.value === "number") {
      value = item.expr.value * state.matched.length; // TOTAL 1 → 总行数；TOTAL 0 → 0
    } else {
      let sum = null;
      let skipped = 0;
      for (const row of state.matched) {
        const v = evaluateExpr(item.expr, row, state.ctx, state.track, state.warn);
        if (typeof v === "number") sum = (sum ?? 0) + v;
        else if (v != null) skipped++;
      }
      if (sum == null) {
        state.warn?.(`**TOTAL** ${alias} 无数值可累加（字段缺失或全为非数值），返回 null`, "TOTAL");
      } else {
        value = sum;
        if (skipped > 0) state.warn?.(`**TOTAL** ${alias} 跳过 ${skipped} 个非数值行`, "TOTAL");
      }
    }
    state.globals.set(alias, value);
    aggMsgs.push(`${alias} = ${value === null ? "null" : value}`);
  }
  return aggMsgs;
}

/** WHERE 行过滤（debug 时边过滤边收集剔除示例，避免 O(n²) 的 includes 回扫） */
function stageWhere(state: ExecState): string | null {
  const where = state.q.where;
  if (!where) return null;

  const before = state.matched.length;
  const excluded: string[] = [];
  state.matched = state.matched.filter((row) => {
    const ok = truthy(evaluateExpr(where, row, state.ctx, state.track, state.warn));
    if (state.enabled && !ok && excluded.length < 3) excluded.push(row.path);
    return ok;
  });
  if (!state.enabled) return null;
  return `过滤 ${before} → ${state.matched.length} 行` +
    (excluded.length ? `（剔除示例：${excluded.join(", ")}）` : "");
}

/** COUNT（DSQL 2.3：WHERE 过滤后行集上的显式比较计数，填充槽位；无 WHERE 时 = FROM 全量口径） */
function stageCount(state: ExecState): string[] {
  const countMsgs: string[] = [];
  if (!state.q.count || state.q.count.length === 0) return countMsgs;

  state.globals ??= new Map();
  for (const item of state.q.count) {
    let n = 0;
    for (const row of state.matched) {
      if (truthy(evaluateExpr(item.cmp, row, state.ctx, state.track, state.warn))) n++;
    }
    state.globals.set(item.slot, n);
    if (state.enabled) {
      countMsgs.push(`${item.slot} = ${n}（${state.q.where ? "WHERE 过滤后行集" : "FROM 全量口径"}）`);
    }
  }
  return countMsgs;
}

/** SORT 多级排序（空优先级列表 () 视为无自定义优先级并计入 warnings） */
function stageSort(state: ExecState): string | null {
  const sort = state.q.sort;
  if (!sort || sort.keys.length === 0) return null;

  let comparisons = 0;
  if (state.enabled && sort.keys.some((k) => k.priority?.length === 0)) {
    state.warn?.("**SORT** **BY** 空优先级列表（视为无自定义优先级）", "SORT");
  }
  state.matched = sortRows(state.matched, sort, state.ctx, state.track, state.enabled ? () => comparisons++ : undefined);
  return state.enabled ? `${describeSort(sort)}，比较 ${comparisons} 次` : null;
}

/** LIMIT 截断 */
function stageLimit(state: ExecState): string | null {
  if (state.q.limit == null) return null;
  const before = state.matched.length;
  state.matched = state.matched.slice(0, state.q.limit);
  return state.enabled ? `截断 ${before} → ${state.matched.length} 行` : null;
}

/* ---------- SELECT 列 ---------- */

function resolveColumns(select: Query["select"], rows: DataRow[], globals: Map<string, FieldValue> | null): ResultSet["columns"] {
  if (select === "*") {
    // 自动列：结果行字段并集（UTF-8 字节序），作为字段表达式
    const keys = new Set<string>();
    for (const row of rows) for (const k of Object.keys(row.fields)) keys.add(k);
    return [...keys].sort(compareUtf8).map((field) => ({ alias: field, expr: { kind: "field", path: field } as Expr }));
  }
  // TOTAL 项自声明自投影（只读，从变量表取值）；裸槽位与 TOTAL 同名为 parse 期致命，此处无需去重
  const cols: ResultSet["columns"] = [];
  for (let i = 0; i < select.length; i++) {
    const sel = select[i];
    if (sel.total) {
      cols.push({ alias: sel.alias ?? "", expr: sel.expr, total: true });
      continue;
    }
    if (sel.slot) {
      // 裸槽位：由 COUNT 填充 → 常量列（只读）；未填充 → 静默忽略
      const name = sel.expr.kind === "variable" ? sel.expr.name : "";
      if (globals?.has(name)) {
        cols.push({ alias: name, expr: sel.expr, total: true });
      }
      continue;
    }
    cols.push({ alias: sel.alias ?? defaultAlias(sel.expr, i), expr: sel.expr, total: sel.total });
  }
  return cols;
}

function defaultAlias(expr: Expr, index: number): string {
  if (expr.kind === "field") return expr.path;
  return `列${index + 1}`;
}

/* ---------- 表达式求值 ---------- */

export type FieldTracker = (row: DataRow, path: string, value: FieldValue) => FieldValue;
export type WarnSink = (message: string, type?: string) => void;

/** empty 值在除 empty() 外的一切运算中按 null 传播（DSQL 1.5 三值语义）。 */
function stripEmpty(v: FieldValue): FieldValue {
  return v === EMPTY ? null : v;
}

/**
 * 求值表达式（面板渲染单元格与执行器共用）。类型不匹配等非致命 → null。
 *
 * @param expr - 表达式 AST
 * @param row - 当前行
 * @param ctx - this 上下文行（无则 null）
 * @param track - 可选字段访问追踪器（调试：记录字段缺失）
 * @param warn - 可选警告接收器（调试：类型不匹配等）
 * @param vars - 可选变量表（$变量$ 取值）
 * @returns 求值结果；非致命错误返回 null
 */
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
    case "extFilter":
      // 行级判断（禁止恒 true 的并集偷懒）：exts 为空（[]）→ 恒 true；
      // 否则按该节点自己的 exts 严格相等匹配（原样字符串，无归一化）。
      // [txt] AND [mp4] 由此得空结果；[txt] OR status %==% 'x' 的 OR 意图由此保留。
      return expr.exts.length === 0 || expr.exts.includes(row.file.ext);
    case "field": {
      const v = resolveField(row, expr.path, ctx);
      return track ? track(row, expr.path, v) : v;
    }
    case "call": {
      const args = expr.args.map((a) => evaluateExpr(a, row, ctx, track, warn, vars));
      // 未知函数在词法层拦截（lexer/parser 只放行 FUNCTIONS 表内名字），此处无需兜底
      return callFunction(expr.name, expr.name === "empty" ? args : args.map(stripEmpty));
    }
    case "unary": {
      if (expr.op === "not") return !truthy(evaluateExpr(expr.expr, row, ctx, track, warn, vars));
      // 一元正负号仅作用于数值（§6.3）：非数值 → null，不计 warning
      const v = stripEmpty(evaluateExpr(expr.expr, row, ctx, track, warn, vars));
      return typeof v === "number" ? (expr.op === "-" ? -v : v) : null;
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
  const l = stripEmpty(evaluateExpr(left, row, ctx, track, warn, vars));
  const r = stripEmpty(evaluateExpr(right, row, ctx, track, warn, vars));

  switch (op) {
    case "==":
      return looseEquals(l, r);
    case "!=":
      return !looseEquals(l, r);
    case ">":
    case "<":
    case ">=":
    case "<=": {
      return compareOrdering(op, l, r);
    }
    case "||":
      return l == null || r == null ? null : `${stringValue(l)}${stringValue(r)}`;
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
    case "^": {
      // null / empty 守卫：结果 null，不计 warning（empty 已在上方 stripEmpty 归 null）
      if (l == null || r == null) return null;
      // 非原始值守卫（数组等）：禁止 Number([5]) === 5 式静默转换
      if (Array.isArray(l) || Array.isArray(r)) {
        warn?.(`算术运算 %${op}% 作用于非原始值（数组）`, "类型不匹配");
        return null;
      }
      const ln = toNumber(l);
      const rn = toNumber(r);
      if (ln === null || rn === null) {
        warn?.(`算术运算 %${op}% 作用于非数字`, "类型不匹配");
        return null;
      }
      return applyArithmetic(op, ln, rn, warn);
    }
  }
  return null;
}

/** 算术求值：除零 / 取模零 → null；结果非有限数（NaN / ±Infinity）→ null（计入 warnings）。 */
function applyArithmetic(op: "+" | "-" | "*" | "/" | "%" | "^", ln: number, rn: number, warn?: WarnSink): FieldValue {
  const fin = (n: number): FieldValue => {
    if (!Number.isFinite(n)) {
      warn?.(`%${op}% 结果非有限数`, "类型不匹配");
      return null;
    }
    return n;
  };
  switch (op) {
    case "+": return fin(ln + rn);
    case "-": return fin(ln - rn);
    case "*": return fin(ln * rn);
    case "/":
      if (rn === 0) { warn?.("%/% 除零", "除零"); return null; }
      return fin(ln / rn);
    case "%":
      if (rn === 0) { warn?.("%%% 取模零", "除零"); return null; }
      return fin(ln % rn);
    case "^": {
      const p = Math.pow(ln, rn);
      if (!Number.isFinite(p)) { warn?.("%^% 结果非有限数（如负数开偶次方）", "类型不匹配"); return null; }
      return p;
    }
  }
}

/** 非原始值判定（数组；null / 原始类型为原始值）。 */
function isNonPrimitive(v: FieldValue): boolean {
  return Array.isArray(v);
}

/**
 * §6.3 补丁（DSQL 2.2）：Number() 转换。空串 / 全空白 / 非数值串转不出 → null；
 * 非有限数（NaN / ±Infinity）视为转不出。仅接受原始值（非原始值由调用方先行守卫）。
 */
function toNumber(v: FieldValue): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * == / != ：null 参与 → 同一性（null == null 为 true，其余 false；!= 取反）；
 * 非原始值 → false（守卫写在一切 Number() / 隐式字符串化之前，[5] %==% "5" 不因 toString 漏成 true）；
 * 否则两边都能 Number() 转出有限数（空串 / 全空白视为转不出）→ 数值比；
 * 两边都转不出 → 字符串比（UTF-8 字节序）；一边能转一边不能 → false。
 */
function looseEquals(l: FieldValue, r: FieldValue): boolean {
  if (l == null || r == null) return l === r;
  if (isNonPrimitive(l) || isNonPrimitive(r)) return false;
  const ln = toNumber(l);
  const rn = toNumber(r);
  if (ln !== null && rn !== null) return ln === rn;
  if (ln === null && rn === null) return compareUtf8(stringValue(l), stringValue(r)) === 0;
  return false;
}

/** > < >= <= ：口径同 looseEquals（null / 非原始值 → false；同载数值比、同不转字符串比、混合 → false）。 */
function compareOrdering(op: ">" | "<" | ">=" | "<=", l: FieldValue, r: FieldValue): boolean {
  if (l == null || r == null) return false;
  if (isNonPrimitive(l) || isNonPrimitive(r)) return false;
  const ln = toNumber(l);
  const rn = toNumber(r);
  let c: number;
  if (ln !== null && rn !== null) c = ln - rn;
  else if (ln === null && rn === null) c = compareUtf8(stringValue(l), stringValue(r));
  else return false;
  return op === ">" ? c > 0 : op === "<" ? c < 0 : op === ">=" ? c >= 0 : c <= 0;
}

function stringValue(v: FieldValue): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * 字段解析：file.* → 文件元数据；this.* → 上下文行；其余 → frontmatter 字段。
 *
 * @param row - 当前行
 * @param path - 字段路径（可含点）
 * @param ctx - this 上下文行（无则 null）
 * @returns 字段值；路径不存在返回 null
 */
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

/**
 * 裸真值判断（DSQL 1.5 三值语义）：empty 值、null、0、false、空串、空数组 → 假；其余一切值为真。
 *
 * @param v - 待判断的值
 * @returns 真值判定结果
 */
export function truthy(v: FieldValue): boolean {
  return (
    v != null && v !== EMPTY && v !== 0 && v !== false &&
    !(Array.isArray(v) && v.length === 0) && v !== ""
  );
}

const utf8Encoder = new TextEncoder();

/**
 * UTF-8 字节序比较（确定性排序）：逐字节比较，公共前缀相等则继续向后比较
 * （递归下降），短字符串在前。例：你好AAAA < 你好AAAB；"a" < "你"（0x61 < 0xE4）。
 *
 * @param a - 左侧字符串
 * @param b - 右侧字符串
 * @returns 负数（a 在前）/ 0（相等）/ 正数（b 在前）
 */
export function compareUtf8(a: string, b: string): number {
  if (a === b) return 0; // 同一性快路径：跳过编码分配
  const ba = utf8Encoder.encode(a);
  const bb = utf8Encoder.encode(b);
  const n = Math.min(ba.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (ba[i] !== bb[i]) return ba[i] - bb[i];
  }
  return ba.length - bb.length;
}

/* ---------- [ext] 后缀过滤（文件级收集 / 目录范围） ---------- */

/**
 * [ext] 读取范围哨兵：WHERE 中至少出现一个 `[]` → 读 FROM 目录下全部文件。
 * 三态严格区分：null（没写 [ext]，零触发）≠ EXT_ALL（[]，全量）≠ Set（指定后缀并集）。
 */
export const EXT_ALL = Symbol("DSQL:extAll");

export type ExtFilterState = null | typeof EXT_ALL | Set<string>;

/**
 * 遍历 WHERE AST 收集所有 ExtFilterNode 的读取范围（规范 §6.9）：
 * - 没写任何 [ext] → null（不触发文件级分派，只用行仓库 md 行）；
 * - 至少一个 []   → EXT_ALL（读 FROM 目录下全部文件；与 [txt] 同现时归 ALL）；
 * - 其余          → Set（所有 [ext] 内容的并集，仅用于读取范围；
 *                    行级求值仍用各节点自己的 exts，见 evaluateExpr）。
 */
export function collectExtFilters(where: Expr | null): ExtFilterState {
  if (!where) return null;
  let state: ExtFilterState = null;
  const visit = (expr: Expr): void => {
    switch (expr.kind) {
      case "extFilter":
        if (expr.exts.length === 0) {
          state = EXT_ALL;
          return;
        }
        if (state === EXT_ALL) return; // ALL 优先级最高，不降级为并集
        if (!(state instanceof Set)) state = new Set<string>();
        for (const ext of expr.exts) (state as Set<string>).add(ext);
        return;
      case "binary":
        visit(expr.left);
        visit(expr.right);
        return;
      case "unary":
        visit(expr.expr);
        return;
      case "call":
        for (const arg of expr.args) visit(arg);
        return;
      default:
        return;
    }
  };
  visit(where);
  return state;
}

/**
 * 收集 FROM 中全部叶子目录路径（含子目录语义由 listFiles 实现侧保证）；
 * 标签叶子不参与（标签源不触发文件级非 md 读取）。无任何目录叶子时返回空数组。
 * AND / OR 的目录组合语义不在本函数展开——文件级过滤统一用 matchFolder。
 */
export function collectSourceFolders(source: Source): string[] {
  switch (source.kind) {
    case "folder":
      return [source.path];
    case "tag":
      return [];
    case "op":
      return [...collectSourceFolders(source.left), ...collectSourceFolders(source.right)];
  }
}

/** FROM 目录语义在文件级（folder）的判定：与 matchSource 的 folder 分支一致；标签叶子视为无约束。 */
export function matchFolder(source: Source, folder: string): boolean {
  switch (source.kind) {
    case "folder": {
      const p = source.path.toLowerCase();
      const f = folder.toLowerCase();
      return f === p || f.startsWith(`${p}/`) || p === "";
    }
    case "tag":
      return true;
    case "op":
      return source.op === "and"
        ? matchFolder(source.left, folder) && matchFolder(source.right, folder)
        : matchFolder(source.left, folder) || matchFolder(source.right, folder);
  }
}

/* ---------- FROM ---------- */

/**
 * FROM 匹配判定（导出供调用方在 SEARCH body 预读时圈定 FROM 命中范围）。
 */
export function matchSource(source: Source, row: DataRow): boolean {
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
 * 排序语义（6.4）：
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
    keys: sort.keys.map((k) => stripEmpty(evaluateExpr(k.expr, row, ctx, track))),
  }));

  const ranks = sort.keys.map((k) => buildRank(k.priority));
  const dirOf = (i: number): 1 | -1 => (sort.keys[i].dir === "desc" ? -1 : 1);

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
  // null / empty / 非原始值恒排末尾（不随方向反转）；同侧按稳定序保留原相对顺序
  const lLast = l == null || isNonPrimitive(l);
  const rLast = r == null || isNonPrimitive(r);
  if (lLast || rLast) {
    if (lLast && rLast) return 0;
    return lLast ? 1 : -1;
  }
  if (rank) {
    const li = rank.get(stringValue(l));
    const ri = rank.get(stringValue(r));
    if (li != null && ri != null) return sign * (li - ri);
    if (li != null) return -1;
    if (ri != null) return 1;
  }
  // 口径同 §6.3 比较：同载数值比、同不转字符串比（空串 "" 排最前）、混合稳定保序
  const ln = toNumber(l);
  const rn = toNumber(r);
  if (ln !== null && rn !== null) return sign * (ln - rn);
  if (ln === null && rn === null) return sign * compareUtf8(stringValue(l), stringValue(r));
  return 0;
}

function describeSort(sort: NonNullable<Query["sort"]>): string {
  const keys = sort.keys
    .map((k) => {
      const dir = k.dir ?? "asc";
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
