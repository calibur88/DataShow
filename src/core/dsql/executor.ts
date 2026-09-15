/**
 * @module dsql/executor
 * @description DSQL 执行器：按 FROM → [ext] 行并入 → WHILE + SEARCH 结构匹配 → 聚合遍（TOTAL）→ WHERE → COUNT → SORT → LIMIT → SELECT 管线执行查询
 *
 * 两遍执行模型：FROM 源解析后，[ext] 行按 path 去重并入（调用方按 FROM 范围预读）；
 * WHILE 驱动的 SEARCH 结构匹配在聚合遍之前（TOTAL 可聚合数值抽取字段，数字串隐式转数值，DSQL 2.4 起）；
 * 第一遍聚合遍（匹配后全量命中行——含 [ext] 非 md 行与补 null 行，**忽略 WHERE**，计算 **TOTAL** → 变量表）；
 * 第二遍投影遍（WHERE → **COUNT** → SORT → LIMIT → SELECT 投影，
 * $变量$ 查变量表、裸标识符查行字段）。
 * 语义：类型不匹配/除零/缺字段为非致命（求值 null，计入 warnings）；算术 / 比较做
 * Number() 隐式转换（非原始值守卫在前，见 §6.3 补丁）；排序 UTF-8 字节序确定性方案。
 * 视图关键词仅透传 ResultSet.view，不影响数据管线（TABLE_VIEW / LIST_VIEW / CARD_VIEW）。
 *
 * DSQL 2.6：`q.domains` 非空时整条查询改由域扩展执行器（domains.ts）接管，本管线不参与。
 * 表达式求值与 FROM 判定分别下沉到 expr.ts / source.ts，本文件仅做管线编排。
 */

import type { Expr, Query, Source, WhileNode } from "./ast";
import { compareUtf8, isNonPrimitive, stringValue, stripEmpty, toNumber, truthy } from "./coerce";
import { executeDomainQuery } from "./domains";
import { evaluateExpr, resolveField, type FieldTracker, type WarnSink } from "./expr";
import { collectExtFilters, collectSourceFolders, matchFolder, matchSource } from "./source";
import type { DataRow, FieldValue, ViewType } from "./types";

export { evaluateExpr, resolveField, type FieldTracker, type WarnSink } from "./expr";
export { EXT_ALL, collectExtFilters, collectSourceFolders, matchFolder, matchSource, type ExtFilterState } from "./source";
export { compareUtf8, truthy } from "./coerce";

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
  /** DSQL 2.6：域扩展查询的阶段摘要（子域行数 / 行展开 / **YIELD** 槽位；旧算法为空） */
  domains?: string[];
  executionTimeMs: number;
}

/** DSQL 2.2：单条 SEARCH 模板的产出统计（调试页）；DSQL 2.4 起按 WHILE 迭代产出计数 */
export interface SearchStat {
  alias: string;
  pattern: string;
  /** 产出到实际匹配的单元格数 */
  hits: number;
  /** 产出 null（匹配不足补位 / 无 body）的单元格数 */
  misses: number;
  /** 抽取值示例（≤3） */
  samples: string[];
}

export interface ResultSet {
  /** v2.0：TABLE_VIEW / LIST_VIEW / CARD_VIEW，由 query.view 直接透传 */
  view: ViewType;
  /**
   * 实际使用的列（SELECT * 已展开为字段并集）。
   * `total` / `readonly` / `aliasVar` 三个标记供渲染层分辨列的来源（取值逻辑不读它们）：
   * `total` = TOTAL / COUNT 填充的槽位常量列（值取变量表）；`readonly` = 域扩展合成列；
   * `aliasVar` = `expr **AS** $变量$`（变量池列）。
   */
  columns: { alias: string; expr: Expr; total?: true; readonly?: true; aliasVar?: true }[];
  rows: DataRow[];
  /**
   * DSQL 1.4：全局变量表（**TOTAL** 聚合 + DSQL 2.3 **COUNT** 计数填充的槽位，裸名键）。
   * 查询开始时即建为空表（故恒非 null）：投影遍的 `expr **AS** $变量$` 链式派生依赖它逐行克隆
   * （§6.7），与查询是否含 TOTAL / COUNT 无关。
   */
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
   * DSQL 2.2 起：行 path → 正文（WHILE + SEARCH 查询专用，调用方按 FROM 命中范围预读；
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
  /** 变量表：查询开始即建为空表，聚合 / 计数阶段写入；投影遍的链式派生依赖它（§6.7） */
  globals: Map<string, FieldValue>;
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
  // DSQL 2.6：域扩展查询（块 { } 语法）走独立执行器，本管线不参与
  if (q.domains) return executeDomainQuery(q, rows, opts);

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
    fieldNames: null, searchAliases: [], searchMsg: null, globals: new Map(),
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

/** FROM 命中行的原始字段名并集（SEARCH 冲突检查与列标签校验共享，单次构建） */
function rawFieldNames(state: ExecState): Set<string> {
  if (state.fieldNames === null) {
    const names = new Set<string>();
    for (const row of state.matched) for (const k of Object.keys(row.fields)) names.add(k);
    state.fieldNames = names;
  }
  return state.fieldNames;
}

/**
 * WHILE + SEARCH（DSQL 2.4：循环驱动的正文匹配，在聚合遍之前——TOTAL 可聚合数值抽取字段）。
 * 轮数 = `结束 - 起始`，两边界由 parse 期静态校验（非负整数字面量、起始 < 结束），运行期恒定、与行无关；
 * 每行产出「轮数」行：各模板游标逐轮推进一次，匹配不足补 null（不提前停）。
 * prepare 期冲突（FROM 元数据收集后、抽取前）：frontmatter 字段名并集 + file.* 内置字段；
 * 行列号在 parse 期记录进 AST（SEARCH 别名 vs SELECT 列标签的冲突才是 parse 期）。
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
  const sourceRows = state.matched.length;
  const expanded: DataRow[] = [];
  const rounds = whileRounds(q.while);
  // 游标模板：每模板预构造一次全局副本，逐行仅重置 lastIndex（避免每行每模板 new RegExp）
  const cursors = q.search.map((item) => globalCopy(item.regex));
  let iterations = 0;

  for (const row of state.matched) {
    iterations += rounds;
    const body = state.opts.bodies?.get(row.path);
    // 每模板只取本轮需要的匹配数（避免为少量迭代全文扫描）
    const picks = cursors.map((re) => takeMatches(re, body, rounds));
    for (let k = 0; k < rounds; k++) {
      const fields = { ...row.fields }; // 克隆：SEARCH 字段不写回行仓库
      for (let i = 0; i < q.search.length; i++) {
        const value = picks[i][k] ?? null; // 匹配不足 → null（不是 empty 值，不是 ""）
        fields[q.search[i].alias] = value;
        if (value === null) {
          stats[i].misses++;
        } else {
          stats[i].hits++;
          if (stats[i].samples.length < 3) stats[i].samples.push(value);
        }
      }
      expanded.push({ ...row, fields });
    }
  }
  state.matched = expanded;

  if (state.enabled) {
    const hits = stats.reduce((sum, s) => sum + s.hits, 0);
    const misses = stats.reduce((sum, s) => sum + s.misses, 0);
    state.searchMsg = `${q.search.length} 个模板 × ${sourceRows} 行 × 共 ${iterations} 轮迭代：命中 ${hits}，补 null ${misses}`;
  }
  return stats;
}

/**
 * WHILE 迭代次数 = 结束 - 起始（边界为非负整数字面量、起始 < 结束，parse 期已校验，
 * 运行期恒定，与行无关）。
 */
function whileRounds(node: WhileNode | null): number {
  if (node === null) return 1; // 理论不可达：WHILE 与 SEARCH 双向绑定，parse 期已保证
  return node.end - node.start;
}

/**
 * 取正则的前 need 个匹配：有捕获组取 `m[1]`（可选捕获组未匹配回落 `m[0]`），无捕获组取 `m[0]`；
 * 无 body / need ≤ 0 → 空数组。§6.10 定稿「无 flags」，故游标副本由调用方预构造、逐行重置
 * （见 globalCopy）；空匹配（如 `.*`）推进 lastIndex，防止死循环。
 *
 * @param re - 全局副本（`g` flag，可反复复用，本函数进入时重置游标）
 * @param body - 行正文
 * @param need - 需要取到的匹配数
 */
function takeMatches(re: RegExp, body: string | undefined, need: number): string[] {
  if (body === undefined || need <= 0) return [];
  re.lastIndex = 0;
  const out: string[] = [];
  while (out.length < need) {
    const m = re.exec(body);
    if (m === null) break;
    out.push(m[1] !== undefined ? m[1] : m[0]);
    if (m[0] === "") re.lastIndex++;
  }
  return out;
}

/** 取正则的全局副本（已带 `g` 则原样返回；用户语法层无 flags，故此处仅补游标推进所需） */
function globalCopy(re: RegExp): RegExp {
  return re.global ? re : new RegExp(re.source, `${re.flags}g`);
}

/**
 * 列标签行字段冲突校验（DSQL 1.5：聚合遍开始前）。
 * 判定范围 = FROM 全量命中行的字段名并集 ∪ SEARCH 别名（都属行字段池），任一行出现过即冲突。
 * 裸槽位与被填充的槽位、`**AS** $变量$` 都是变量池名称，不在此校验（两池隔离，§6.7）。
 */
function checkSelectAliases(state: ExecState): void {
  const { q } = state;
  const aliasedItems = q.select === "*" ? [] : q.select.filter((c) => c.alias && !c.slot && !c.aliasVar);
  if (aliasedItems.length === 0) return;
  const fieldNames = new Set(rawFieldNames(state));
  for (const alias of state.searchAliases) fieldNames.add(alias);
  for (const item of aliasedItems) {
    if (fieldNames.has(item.alias!)) {
      throw new Error(`[DSQL] 列标签 '${item.alias}' 与现有字段名冲突，请改用其他别名`);
    }
  }
}

/** 聚合遍（DSQL 1.4：恒忽略 WHERE，扫描 FROM 全量命中行） */
function stageAggregate(state: ExecState): string[] {
  const aggMsgs: string[] = [];
  const totalItems = state.q.select === "*" ? [] : state.q.select.filter((c) => c.total);
  if (totalItems.length === 0) return aggMsgs;

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
        // 隐式转换（§6.3）：数字与数字串均可累加——SEARCH 抽取字段不做类型推断，
        // 数值串（如 "100"）可被 TOTAL 求和；非数值（非数值串 / 数组）跳过并计入 warnings
        const n = toNumber(v);
        if (n !== null) sum = (sum ?? 0) + n;
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
    cols.push({
      alias: sel.alias ?? defaultAlias(sel.expr, i),
      expr: sel.expr,
      total: sel.total,
      // aliasVar：`expr **AS** $变量$`（变量池列）——渲染层据此归入辅助列，取值逻辑不读
      ...(sel.aliasVar ? { aliasVar: true as const } : {}),
    });
  }
  return cols;
}

function defaultAlias(expr: Expr, index: number): string {
  if (expr.kind === "field") return expr.path;
  return `列${index + 1}`;
}

/* ---------- [ext] / FROM ---------- */

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
  // 预计算每行的键值（Schwartzian 变换，避免比较中重复求值）；empty 值先归 null（§6.3）
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
