/**
 * @module dsql/domains
 * @description DSQL 2.6 域扩展执行器：子域绑定求值 → **YIELD** 展开（IN / DIFF）→ 行展开 → 顶层投影
 *
 * 执行模型（§3）：
 * 1. 绑定求值：按拓扑序（plan.bindings.order）求每个子域——FROM 命中 → WHERE 过滤 → 逐行投影对象；
 * 2. **YIELD** 展开：**IN** 两侧取 ROW 值（当前行），**DIFF** 左参取该域全集、右参取 ROW 值，输出差集；
 * 3. 行展开：`plan.rowDomains` 的笛卡尔积逐行展开（同域只计一次），无 **YIELD** 时 = 根块全部子域；
 * 4. 投影：顶层 `**SELECT** <域>` 取当前行对象、`$槽位$` 取该行 **YIELD** 值。
 *
 * 与旧算法的关系：有 block 才走本模块；子查询自身只做 FROM + WHERE（旧查询算法的最小子集），
 * 不触发 [ext] 文件级读取、不含 SEARCH / COUNT / SORT / LIMIT / WHILE。
 */

import type { DomainBinding, DomainColumn, DomainPlan, Query } from "./ast";
import { looseEquals, truthy } from "./coerce";
import type { ExecuteOptions, FieldMiss, QueryDebug, QueryWarning, ResultSet, SourceStat } from "./executor";
import { evaluateExpr, resolveField, type FieldTracker, type WarnSink } from "./expr";
import { matchSource } from "./source";
import { DomainSlotValue, type DataRow, type FieldObject, type FieldValue, type FileMeta } from "./types";

/** 一次查询内某个域绑定的求值产物 */
interface DomainInstance {
  binding: DomainBinding;
  /** 投影出的对象序列（与 sourceRows 同序） */
  objects: FieldObject[];
  /** 对象对应的来源行（供「文件」列与点击打开；域引用不改变来源行） */
  sourceRows: DataRow[];
}

/** 域行合成用的空文件元数据（无来源行时——如全部子域为空） */
const EMPTY_FILE: FileMeta = {
  path: "", name: "", folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, outlinks: [], inlinks: [],
};

/** 拆解后的执行环境（各步骤共享，避免层层传参） */
interface DomainEnv {
  plan: DomainPlan;
  rows: DataRow[];
  instances: Map<number, DomainInstance>;
  track?: FieldTracker;
  warn?: WarnSink;
}

/**
 * 执行域扩展查询。
 *
 * @param q - 查询 AST（`q.domains` 非空）
 * @param rows - 全部候选行（各子查询的 FROM 匹配在其中进行）
 * @param opts - 可选项（debug 调试开关、ingestWarnings 摄取警告）
 * @returns 结果集（列 + 行 + 空变量表，开启 debug 时附带调试信息）
 */
export function executeDomainQuery(q: Query, rows: DataRow[], opts: ExecuteOptions = {}): ResultSet {
  const started = now();
  const enabled = opts.debug === true;
  const missing = new Map<string, FieldMiss>();
  const warnCounts = new Map<string, { type: string; count: number }>();
  const track: FieldTracker | undefined = enabled
    ? (row, path, value) => {
        if (value == null && !path.startsWith("this.")) {
          const rec = missing.get(path) ?? { field: path, count: 0, sample: row.path };
          rec.count++;
          missing.set(path, rec);
        }
        return value;
      }
    : undefined;
  const warn: WarnSink | undefined = enabled
    ? (message, type = "语义") => {
        const rec = warnCounts.get(message) ?? { type, count: 0 };
        rec.count++;
        warnCounts.set(message, rec);
      }
    : undefined;

  const plan = q.domains!.plan;
  const env: DomainEnv = { plan, rows, instances: new Map(), track, warn };
  buildInstances(env);

  const rowDefs = plan.rowDomains.map((id) => env.instances.get(id)!);
  const counts = rowDefs.map((inst) => inst.objects.length);
  const total = counts.reduce((a, b) => a * b, 1);
  const filledSlots = new Set(plan.yields.filter((y) => y.slot !== null).map((y) => y.slot as string));
  const columns = plan.columns.filter((c) => c.kind !== "slot" || filledSlots.has(c.slot));

  const out: DataRow[] = [];
  for (let index = 0; index < total; index++) {
    const at = decodeIndex(index, counts, rowDefs.map((inst) => inst.binding.id));
    const vars = evalYields(env, at);
    const fields: FieldObject = {};
    for (const col of columns) {
      const label = outputLabel(col);
      if (col.kind === "domain") {
        fields[label] = domainColumnValue(env.instances.get(col.def)!, at.get(col.def));
      } else {
        // 包显示层标记：`$槽位$` 值按域口径渲染（true/false、`,` 无空格），导出时解包为原值
        fields[label] = new DomainSlotValue(vars.get(col.slot) ?? null) as unknown as FieldValue;
      }
    }
    const origin = rowDefs.length > 0 ? rowDefs[0].sourceRows[at.get(rowDefs[0].binding.id) ?? 0] : undefined;
    const file = origin ? origin.file : EMPTY_FILE;
    out.push({ path: file.path, file, fields });
  }

  const result: ResultSet = {
    view: q.view,
    // readonly：域列取自行合成行（fields 为投影值），非 frontmatter 字段 → 卡片视图不得内联编辑
    columns: columns.map((col) => {
      const label = outputLabel(col);
      return { alias: label, expr: { kind: "field", path: label }, readonly: true };
    }),
    rows: out,
    globals: new Map(),
  };
  if (enabled) result.debug = buildDebug(q, env, opts, started, warnCounts, missing, total);
  return result;
}

/**
 * 输出列标签（domain 显示口径，§6.13.7）：
 * `<域>` 是**类型标记** → 保留尖括号；`$槽位$` 的 `$` 是**命名空间标记** → 输出层去掉。
 * 语言层写法不变（`**SELECT**` / `**YIELD**` 里仍写 `<域>` 与 `$槽位$`）。
 *
 * @param col - 域扩展投影列
 * @returns 该列的输出标签
 */
function outputLabel(col: DomainColumn): string {
  return col.kind === "domain" ? col.alias : col.slot;
}

/* ---------- 绑定求值 ---------- */

/** 按拓扑序求全部子域：FROM 命中 → WHERE 过滤 → 逐行投影对象（域引用取已求值绑定的全量对象） */
function buildInstances(env: DomainEnv): void {
  const ordered = [...env.plan.bindings].sort((a, b) => a.order - b.order);
  for (const binding of ordered) {
    const matched = env.rows.filter((row) => matchSource(binding.sub.from, row));
    const where = binding.sub.where;
    const filtered = where
      ? matched.filter((row) => truthy(evaluateExpr(where, row, null, env.track, env.warn)))
      : matched;
    const objects: FieldObject[] = [];
    const sourceRows: DataRow[] = [];
    for (const row of filtered) {
      const obj: FieldObject = {};
      binding.sub.select.forEach((field, i) => {
        const target = binding.refs[i];
        obj[field.name] = target >= 0
          ? domainColumnValue(env.instances.get(target)!, undefined)
          : resolveField(row, field.name, null);
      });
      objects.push(obj);
      sourceRows.push(row);
    }
    env.instances.set(binding.id, { binding, objects, sourceRows });
  }
}

/* ---------- 展开与投影 ---------- */

/**
 * 线性下标 → 各域下标（最后一维变化最快），保证展开顺序确定（字典序）。
 *
 * @param index - 0 起的总行号
 * @param counts - 各展开域的行数（与 ids 同序）
 * @param ids - 展开域绑定 id（与 counts 同序）
 * @returns 域 id → 行下标
 */
function decodeIndex(index: number, counts: number[], ids: number[]): Map<number, number> {
  const at = new Map<number, number>();
  let rest = index;
  for (let k = counts.length - 1; k >= 0; k--) {
    at.set(ids[k], counts[k] > 0 ? rest % counts[k] : 0);
    rest = counts[k] > 0 ? Math.floor(rest / counts[k]) : 0;
  }
  return at;
}

/** 逐 **YIELD** 项求值：写入该行变量环境（槽位名恒为裸名；无 **AS** 项只计算不绑定） */
function evalYields(env: DomainEnv, at: Map<number, number>): Map<string, FieldValue> {
  const vars = new Map<string, FieldValue>();
  for (const item of env.plan.yields) {
    const value = item.op === "in"
      ? inOp(rowValue(env, item.left, at), rowValue(env, item.right, at))
      : diffOp(aggValues(env, item.left), rowValue(env, item.right, at));
    if (item.slot !== null) vars.set(item.slot, value);
  }
  return vars;
}

/** **IN**：`a` 逐元素判断是否属于 `b`（`b` 为数组 → 集合成员；否则相等）；null 参 → false */
function inOp(a: FieldValue, b: FieldValue): FieldValue {
  if (b == null) return false;
  const probes = Array.isArray(a) ? a : [a];
  if (Array.isArray(b)) return probes.some((p) => b.some((v) => looseEquals(v, p)));
  return probes.some((p) => looseEquals(p, b));
}

/** **DIFF**：左参全集 \ 右参逐行值（保留左参顺序；右参为数组则整体剔除） */
function diffOp(all: FieldValue[], right: FieldValue): FieldValue {
  const drop = Array.isArray(right) ? right : right == null ? [] : [right];
  return all.filter((v) => !drop.some((d) => looseEquals(v, d)));
}

/** ROW 取值：`<域>::字段` 在当前行对象上的字段值；域不参与行展开或行越界 → null */
function rowValue(env: DomainEnv, ref: { def: number; field: string }, at: Map<number, number>): FieldValue {
  const inst = env.instances.get(ref.def);
  const index = at.get(ref.def);
  if (!inst || index === undefined) return null;
  const obj = inst.objects[index];
  return obj ? obj[ref.field] ?? null : null;
}

/**
 * AGG 取值：`<域>::字段` 在该域**全量对象**上的取值序列（**DIFF** 左参）。
 * 字段值为数组时按元素摊开（`<剧情>::chart` = `[傻青, 笨蛋]` → 全集 `[傻青, 笨蛋]`）；
 * null / 缺失不入全集（差集只关心真实取值）。
 */
function aggValues(env: DomainEnv, ref: { def: number; field: string }): FieldValue[] {
  const inst = env.instances.get(ref.def);
  if (!inst) return [];
  const out: FieldValue[] = [];
  for (const obj of inst.objects) {
    const value = obj[ref.field];
    if (value == null) continue;
    if (Array.isArray(value)) out.push(...value);
    else out.push(value);
  }
  return out;
}

/**
 * 域列取值：该域参与行展开 → 当前行对象（可能 null）；不参与行展开 → 全量对象
 * （单对象直接给对象本身，多对象给对象序列，空域给 null）。
 */
function domainColumnValue(inst: DomainInstance | undefined, index: number | undefined): FieldValue {
  if (!inst) return null;
  if (index !== undefined) return inst.objects[index] ?? null;
  return inst.objects.length === 1 ? inst.objects[0] : inst.objects.length === 0 ? null : inst.objects;
}

/* ---------- 调试信息 ---------- */

function buildDebug(
  q: Query,
  env: DomainEnv,
  opts: ExecuteOptions,
  started: number,
  warnCounts: Map<string, { type: string; count: number }>,
  missing: Map<string, FieldMiss>,
  total: number,
): QueryDebug {
  const lines: string[] = [];
  const sourceStats: SourceStat[] = [];
  for (const binding of [...env.plan.bindings].sort((a, b) => a.order - b.order)) {
    const inst = env.instances.get(binding.id)!;
    const from = binding.sub.from.kind === "folder" ? `"${binding.sub.from.path}"` : "标签源";
    lines.push(`子域 <${binding.name}>（FROM ${from}）：${inst.objects.length} 行`);
    sourceStats.push({ source: `子域 <${binding.name}> 数据源`, rows: inst.objects.length });
  }
  const rowLabels = env.plan.rowDomains.map((id) => `<${env.plan.bindings[id].name}>`);
  lines.push(
    `行展开：${rowLabels.length > 0 ? rowLabels.join(" × ") : "（无）"} = ${total} 行`,
  );
  for (const item of env.plan.yields) {
    const op = item.op === "in" ? "**IN**" : "**DIFF**";
    const detail = item.op === "in"
      ? `ROW：<${env.plan.bindings[item.left.def].name}>, <${env.plan.bindings[item.right.def].name}>`
      : `AGG：<${env.plan.bindings[item.left.def].name}>；ROW：<${env.plan.bindings[item.right.def].name}>`;
    lines.push(
      `YIELD ${item.slot === null ? "（无 **AS**，不投影）" : `$${item.slot}$`}：` +
      `<${env.plan.bindings[item.left.def].name}>::${item.left.field} ${op} ` +
      `<${env.plan.bindings[item.right.def].name}>::${item.right.field}（${detail}）`,
    );
  }

  const warnings: QueryWarning[] = [...warnCounts.entries()].map(([message, rec]) => ({
    type: rec.type,
    message: rec.count > 1 ? `${message}（${rec.count} 次）` : message,
  }));
  for (const item of opts.ingestWarnings ?? []) warnings.push(item);

  return {
    from: `域扩展查询：${env.plan.bindings.length} 个子域`,
    where: q.domains!.block.length > 0 ? `块内条目 ${q.domains!.block.length} 项` : null,
    sort: null,
    limit: null,
    fieldMisses: [...missing.values()],
    warnings,
    sourceStats,
    aggregates: [],
    search: [],
    count: [],
    domains: lines,
    executionTimeMs: round1(now() - started),
  };
}

/* ---------- 工具 ---------- */

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
