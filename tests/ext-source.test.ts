/**
 * @module tests/ext-source
 * @description [ext] 后缀过滤套件：语法、三态收集、按后缀分派、读取范围、执行求值、自研解析器
 */

import assert from "node:assert/strict";
import { collectExtFilters, executeQuery, EXT_ALL, type ResultSet } from "@dsql/executor";
import { LexError } from "@dsql/lexer";
import { parseQuery, QueryParseError } from "@dsql/parser";
import type { DataRow } from "@dsql/types";
import {
  failedListForRender,
  loadExtRows,
  type ExtLoadResult,
  type ExtSourceHost,
} from "@index/ext-source";
import { parseYamlFallback, type FallbackResult } from "@index/yaml-fallback";
import { normalizeSettings } from "@settings/normalize";
import { makeRow } from "./helpers";

let passed = 0;
const failures: { name: string; err: unknown }[] = [];
let queue: Promise<void> = Promise.resolve();

/** 串行执行（含异步用例）：失败记录并继续，结尾统一汇报并置退出码。 */
function test(name: string, fn: () => void | Promise<void>): void {
  queue = queue.then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures.push({ name, err });
      console.error(`  ✗ ${name}`);
      console.error(err);
    }
  });
}

/* ---------- 自研解析器（规范 §6.8 行为对照，逐个必须通过） ---------- */

function fb(text: string): FallbackResult {
  return parseYamlFallback(text);
}

test("[yaml] 同键同值×2 → 收集为数组", () => {
  assert.deepEqual(fb("---\nstate: 通过\nstate: 通过\n---"), { ok: true, value: { state: ["通过", "通过"] } });
});

test("[yaml] 同键异值 → 收集为数组", () => {
  assert.deepEqual(fb("---\nstate: 通过\nstate: pass\n---"), { ok: true, value: { state: ["通过", "pass"] } });
});

test("[yaml] 跨块不同键（4 围栏）→ 按键合并", () => {
  assert.deepEqual(fb("---\nstate:通过\n---\n---\ninfo:你好\n---"), { ok: true, value: { state: "通过", info: "你好" } });
});

test("[yaml] 跨块同键（4 围栏）→ 收集为数组", () => {
  assert.deepEqual(fb("---\nstate:通过\n---\n---\nstate:pass\n---"), { ok: true, value: { state: ["通过", "pass"] } });
});

test("[yaml] 标量+数组 → 不扁平", () => {
  assert.deepEqual(fb('---\nstate: 通过\nstate: ["a","b"]\n---'), { ok: true, value: { state: ["通过", ["a", "b"]] } });
});

test("[yaml] 标量+数组+标量 → 依次 push", () => {
  assert.deepEqual(fb('---\nstate: 通过\nstate: ["a","b"]\nstate: c\n---'), {
    ok: true,
    value: { state: ["通过", ["a", "b"], "c"] },
  });
});

test("[yaml] 流式数组×2 → 不扁平、不往内层 push", () => {
  assert.deepEqual(fb("---\ntags: [x,y]\ntags: [x,y]\n---"), { ok: true, value: { tags: [["x", "y"], ["x", "y"]] } });
});

test("[yaml] 块式列表 → 暂存整体作为数组赋键", () => {
  assert.deepEqual(fb("---\nloop:\n  - xxx\n  - zxx\n---"), { ok: true, value: { loop: ["xxx", "zxx"] } });
});

test("[yaml] 块式单子行 → 也是数组", () => {
  assert.deepEqual(fb("---\nloop:\n  - a\n---"), { ok: true, value: { loop: ["a"] } });
});

test("[yaml] 块式空值（无子行）→ null（摄取层归一 empty 值）", () => {
  assert.deepEqual(fb("---\nloop:\n---"), { ok: true, value: { loop: null } });
});

test("[yaml] 块式×2 → 不扁平", () => {
  assert.deepEqual(fb("---\nloop:\n  - a\n---\n---\nloop:\n  - b\n---"), { ok: true, value: { loop: [["a"], ["b"]] } });
});

test("[yaml] 类型推断：数组/布尔/null/~/引号/数字/裸字符串", () => {
  assert.deepEqual(fb('---\na: [1, 2]\nb: true\nc: null\nd: ~\ne: "x"\nf: 3.14\ng: bare\n---'), {
    ok: true,
    value: { a: [1, 2], b: true, c: null, d: null, e: "x", f: 3.14, g: "bare" },
  });
});

test("[yaml] 全文无 --- → error", () => {
  assert.deepEqual(fb("hello world"), { ok: false, level: "error", reason: "无 --- 围栏" });
});

test("[yaml] 奇数围栏 → warn（整体作废）", () => {
  assert.deepEqual(fb("---\nstate: 通过"), { ok: false, level: "warn", reason: "围栏不闭合" });
});

test("[yaml] 3 围栏整体作废 → warn（不允许保留完整前块）", () => {
  assert.deepEqual(fb("---\nA\n---\nB\n---"), { ok: false, level: "warn", reason: "围栏不闭合" });
});

test("[yaml] 空块（4 围栏无键值）→ error", () => {
  assert.deepEqual(fb("---\n---\n---\n---"), { ok: false, level: "error", reason: "有围栏、闭合、但无任何键值" });
});

test("[yaml] 正常 2 围栏 → ok", () => {
  assert.deepEqual(fb("---\nstate: 通过\n---"), { ok: true, value: { state: "通过" } });
});

test("[yaml] loop: 1 后跟无挂起 - stray → stray 跳过", () => {
  assert.deepEqual(fb("---\nloop: 1\n  - stray\n---"), { ok: true, value: { loop: 1 } });
});

test("[yaml] 嵌套缩进非 - 行不可见 → 键产出 null", () => {
  assert.deepEqual(fb("---\nloop:\n  child: x\n---"), { ok: true, value: { loop: null } });
});

/* ---------- 语法 ---------- */

test("[语法] [txt] / [txt, mp4] / [] 解析成 extFilter 原子", () => {
  assert.deepEqual(parseQuery('**FROM** "logs" **WHERE** [txt]').where, { kind: "extFilter", exts: ["txt"] });
  assert.deepEqual(parseQuery('**FROM** "logs" **WHERE** [txt, mp4]').where, { kind: "extFilter", exts: ["txt", "mp4"] });
  assert.deepEqual(parseQuery('**FROM** "logs" **WHERE** []').where, { kind: "extFilter", exts: [] });
});

test("[语法] 后缀不做归一化：[.TXT] / [Txt] / [-] 均按字面字符串", () => {
  assert.deepEqual(parseQuery('**FROM** "logs" **WHERE** [.TXT]').where, { kind: "extFilter", exts: [".TXT"] });
  assert.deepEqual(parseQuery('**FROM** "logs" **WHERE** [Txt]').where, { kind: "extFilter", exts: ["Txt"] });
  assert.deepEqual(parseQuery('**FROM** "logs" **WHERE** [-]').where, { kind: "extFilter", exts: ["-"] });
});

test("[语法] [ext] 出现在 SELECT / SORT / FROM → 解析错误（带行列号）", () => {
  for (const sql of [
    '**SELECT** [txt] **FROM** "logs"',
    '**FROM** "logs" **SORT** [txt]',
    '**FROM** [txt]',
  ]) {
    assert.throws(() => parseQuery(sql), (err: unknown) => {
      assert.ok(err instanceof QueryParseError);
      assert.match(err.message, /仅可在 \*\*WHERE\*\*/);
      assert.match(err.message, /第 1 行第 \d+ 列/);
      return true;
    });
  }
});

test("[语法] [ 未闭合 → 词法错误", () => {
  assert.throws(() => parseQuery('**FROM** "logs" **WHERE** [txt'), (err: unknown) => {
    assert.ok(err instanceof LexError);
    assert.match(err.message, /未闭合/);
    return true;
  });
});

test("[语法] 段内空格 trim，段内内容原样保留", () => {
  assert.deepEqual(parseQuery('**FROM** "logs" **WHERE** [ txt ,  mp4 ]').where, {
    kind: "extFilter",
    exts: ["txt", "mp4"],
  });
  assert.deepEqual(parseQuery('**FROM** "logs" **WHERE** [a.b-c]').where, {
    kind: "extFilter",
    exts: ["a.b-c"],
  });
});

test("[语法] 括号分组内的 [ext] 合法（WHERE 内原子）", () => {
  const where = parseQuery('**FROM** "logs" **WHERE** ([txt] **OR** [mp4]) **AND** status %==% \'x\'').where;
  assert.equal((where as { kind: string }).kind, "binary");
  assert.deepEqual(collectExtFilters(where), new Set(["txt", "mp4"]));
});

test("[语法] 注释里的 [ 不触发 extfilter", () => {
  const where = parseQuery('**FROM** "logs" **WHERE** status %==% \'x\' -- [txt] 只是注释').where;
  assert.equal(collectExtFilters(where), null);
});

test("[语法] 并置简写：[txt] status %==% 'x' ≡ [txt] **AND** status %==% 'x'（规范 §3 定稿示例）", () => {
  const where = parseQuery("**FROM** \"logs\" **WHERE** [txt, mp4] status %!=% 'error'").where;
  assert.deepEqual(where, {
    kind: "binary",
    op: "and",
    left: { kind: "extFilter", exts: ["txt", "mp4"] },
    right: { kind: "binary", op: "!=", left: { kind: "field", path: "status" }, right: { kind: "lit", value: "error" } },
  });
});

test("[语法] 并置简写优先级：[txt] a %==% 1 **OR** b %==% 2 → OR 连接隐式 AND 与后键", () => {
  const where = parseQuery('**FROM** "logs" **WHERE** [txt] a %==% 1 **OR** b %==% 2').where as { kind: string; op: string };
  assert.equal(where.op, "or");
  assert.equal((where as unknown as { left: { op: string } }).left.op, "and");
});

test("[语法] 并置简写可连续：[txt] [mp4] 与显式 AND 等价", () => {
  const where = parseQuery('**FROM** "logs" **WHERE** [txt] [mp4]').where as { kind: string; op: string };
  assert.equal(where.op, "and");
});

test("[求值] 并置简写语义与显式 AND 一致", async () => {
  const juxta = await run("**FROM** \"logs\" **WHERE** [txt] status %==% 'x'");
  const explicit = await run("**FROM** \"logs\" **WHERE** [txt] **AND** status %==% 'x'");
  assert.deepEqual(paths(juxta), ["logs/b.txt"]);
  assert.deepEqual(paths(juxta), paths(explicit));
});

/* ---------- 三种状态（collectExtFilters） ---------- */

test("[三态] 没写 [ext] → null（零回归）", () => {
  assert.equal(collectExtFilters(null), null);
  assert.equal(collectExtFilters(parseQuery('**FROM** "logs" **WHERE** status %==% \'x\'').where), null);
});

test("[三态] [] → EXT_ALL", () => {
  assert.equal(collectExtFilters(parseQuery('**FROM** "logs" **WHERE** []').where), EXT_ALL);
});

test("[三态] [txt] → Set(['txt'])", () => {
  assert.deepEqual(collectExtFilters(parseQuery('**FROM** "logs" **WHERE** [txt]').where), new Set(["txt"]));
});

test("[三态] [] + [txt] → 读取范围归 ALL", () => {
  assert.equal(
    collectExtFilters(parseQuery('**FROM** "logs" **WHERE** [] **AND** [txt]').where),
    EXT_ALL,
  );
});

test("[三态] [txt] AND [mp4] → 并集 Set（求值仍用各节点自己的 exts）", () => {
  assert.deepEqual(
    collectExtFilters(parseQuery('**FROM** "logs" **WHERE** [txt] **AND** [mp4]').where),
    new Set(["txt", "mp4"]),
  );
});

/* ---------- 分派 / 读取范围 / 求值的共用场景 ---------- */

interface FakeSpec {
  path: string;
  /** md 文件的 metadataCache frontmatter */
  md?: Record<string, unknown>;
  /** 非 md 文件原文（null = 文件在 listFiles 后消失，race） */
  text?: string | null;
}

function metaOf(path: string) {
  const parts = path.split("/");
  const name = parts.pop()!;
  return {
    path,
    basename: name.replace(/\.[^.]+$/, ""),
    folder: parts.join("/"),
    ext: name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "",
    size: 1,
    ctime: 1,
    mtime: 1,
  };
}

function makeHost(specs: FakeSpec[]): ExtSourceHost & { listCalls: string[][] } {
  const listCalls: string[][] = [];
  return {
    listCalls,
    async listFiles(folderPaths: string[]) {
      listCalls.push(folderPaths);
      return specs
        .map((s) => metaOf(s.path))
        .filter((m) =>
          folderPaths.some((p) => {
            const f = m.folder.toLowerCase();
            return p === "" || f === p.toLowerCase() || f.startsWith(`${p.toLowerCase()}/`);
          }),
        );
    },
    async readMd(path: string) {
      return specs.find((s) => s.path === path)?.md ?? null;
    },
    async readNonMdText(path: string) {
      const spec = specs.find((s) => s.path === path);
      return spec?.text === undefined ? null : spec.text;
    },
  };
}

/** 场景：logs 下 a.md(status=x,n=1) / b.txt(status=x,n=2) / c.mp4(解析失败) / g.txt(race 消失)，
 *  另有 e.md(status=z)、other/d.txt(status=y)。 */
const SPECS: FakeSpec[] = [
  { path: "logs/a.md", md: { status: "x", n: 1 } },
  { path: "logs/b.txt", text: "---\nstatus: x\nn: 2\n---" },
  { path: "logs/c.mp4", text: "hello world" },
  { path: "logs/g.txt", text: null },
  { path: "logs/sub/s.log", text: "---\nstatus: sub\n---" },
  { path: "logs/e.md", md: { status: "z" } },
  { path: "other/d.txt", text: "---\nstatus: y\n---" },
];

/** 行仓库 md 行（a.md / e.md 与 readMd 产出一致） */
const MD_ROWS: DataRow[] = [
  makeRow("logs/a.md", "logs", { status: "x", n: 1, tags: ["task"] }),
  makeRow("logs/e.md", "logs", { status: "z" }),
];

async function run(sql: string, host: ExtSourceHost & { listCalls: string[][] } = makeHost(SPECS)): Promise<ResultSet & { loaded: ExtLoadResult }> {
  const q = parseQuery(sql);
  const loaded = await loadExtRows(collectExtFilters(q.where), q.from, host);
  const result = executeQuery(q, MD_ROWS, null, { extRows: loaded.rows });
  return { ...result, loaded };
}

const paths = (r: ResultSet): string[] => r.rows.map((row) => row.path);

/* ---------- 读取范围（含禁止全库扫描回归） ---------- */

test("[范围] FROM logs + [txt] → 只读 logs 目录下的 txt", async () => {
  const host = makeHost(SPECS);
  const { loaded } = await run('**FROM** "logs" **WHERE** [txt]', host);
  assert.deepEqual(host.listCalls, [["logs"]]);
  assert.deepEqual(loaded.rows.map((r) => r.path), ["logs/b.txt"]);
});

test("[范围] FROM logs + [] → 读 logs 目录下全部文件（含子目录）", async () => {
  const { loaded } = await run('**FROM** "logs" **WHERE** []');
  assert.deepEqual(loaded.rows.map((r) => r.path).sort(), ["logs/a.md", "logs/b.txt", "logs/e.md", "logs/sub/s.log"]);
  assert.deepEqual(loaded.failed, ["logs/c.mp4", "logs/g.txt"]); // UTF-8 字节序
});

test("[范围] #标签源不触发非 md 读取（listFiles 不被调用）", async () => {
  const host = makeHost(SPECS);
  const result = await run('**FROM** #task **WHERE** [txt]', host);
  assert.deepEqual(host.listCalls, []);
  // 只走现有 md 行，行级过滤照常：md 行不满足 [txt] → 空结果（txt 文件未被读取）
  assert.deepEqual(paths(result), []);
});

test("[范围] 禁止全库扫描：other 目录的 txt 不出现在 logs 查询结果", async () => {
  const result = await run('**FROM** "logs" **WHERE** [txt] **OR** []');
  assert.ok(paths(result).every((p) => p.startsWith("logs/")));
});

/* ---------- 执行顺序与求值 ---------- */

test("[求值] [txt] 只出 txt 行（全部来自本次读取）", async () => {
  assert.deepEqual(paths(await run('**FROM** "logs" **WHERE** [txt]')), ["logs/b.txt"]);
});

test("[求值] [txt] AND status %==% 'x'", async () => {
  const r = await run('**FROM** "logs" **WHERE** [txt] **AND** status %==% \'x\'');
  assert.deepEqual(paths(r), ["logs/b.txt"]);
});

test("[求值] [txt] OR status %==% 'x' → 全部 txt + 满足 status 的 md", async () => {
  const r = await run('**FROM** "logs" **WHERE** [txt] **OR** status %==% \'x\'');
  assert.deepEqual(paths(r).sort(), ["logs/a.md", "logs/b.txt"]);
});

test("[求值] NOT [txt] 只出 md 行（txt 文件仍被读入再滤掉）", async () => {
  const r = await run('**FROM** "logs" **WHERE** **NOT** [txt]');
  assert.deepEqual(paths(r).sort(), ["logs/a.md", "logs/e.md"]);
});

test("[求值] [] 出 FROM 目录下 md + 全部非 md（失败剔除）", async () => {
  const r = await run('**FROM** "logs" **WHERE** []');
  assert.deepEqual(paths(r).sort(), ["logs/a.md", "logs/b.txt", "logs/e.md", "logs/sub/s.log"]);
});

test("[求值] [] AND NOT [txt] → 全部文件中非 txt 的行", async () => {
  const r = await run('**FROM** "logs" **WHERE** [] **AND** **NOT** [txt]');
  assert.deepEqual(paths(r).sort(), ["logs/a.md", "logs/e.md", "logs/sub/s.log"]);
});

test("[求值] [txt] AND [mp4] → 空结果（求值用各节点自己的 exts，不用并集）", async () => {
  const r = await run('**FROM** "logs" **WHERE** [txt] **AND** [mp4]');
  assert.deepEqual(paths(r), []);
});

/* ---------- 按后缀分派 ---------- */

test("[分派] [md] → md 交官方路径，且与行仓库按 path 去重", async () => {
  const r = await run('**FROM** "logs" **WHERE** [md]');
  assert.deepEqual(paths(r).sort(), ["logs/a.md", "logs/e.md"]);
});

test("[分派] [txt, md] → txt 交自研、md 交官方，两路行并入", async () => {
  const r = await run('**FROM** "logs" **WHERE** [txt, md]');
  assert.deepEqual(paths(r).sort(), ["logs/a.md", "logs/b.txt", "logs/e.md"]);
});

test("[分派] [md] 行字段来自 metadataCache；[txt] 行字段来自自研解析", async () => {
  const r = await run('**FROM** "logs" **WHERE** [txt, md] **AND** status %==% \'x\'');
  const row = r.rows.find((row) => row.path === "logs/b.txt");
  assert.equal(row?.fields.status, "x");
  assert.equal(row?.fields.n, 2); // 自研类型推断
});

test("[分派] 同一文件只走一条路径：md 不读原文，非 md 不查 metadataCache", async () => {
  const calls: string[] = [];
  const host: ExtSourceHost = {
    ...makeHost(SPECS),
    async readMd(path) {
      calls.push(`md:${path}`);
      return SPECS.find((s) => s.path === path)?.md ?? null;
    },
    async readNonMdText(path) {
      calls.push(`raw:${path}`);
      const spec = SPECS.find((s) => s.path === path);
      return spec?.text === undefined ? null : spec.text;
    },
  };
  await run('**FROM** "logs" **WHERE** [txt, md]', host);
  assert.ok(calls.includes("md:logs/a.md") && !calls.includes("raw:logs/a.md"));
  assert.ok(calls.includes("raw:logs/b.txt") && !calls.includes("md:logs/b.txt"));
});

test("[分派] [md] 行的 file.ext 为 md；非 md 行 file.ext 原样（不带点、不转小写）", async () => {
  const host = makeHost([{ path: "logs/X.TXT", text: "---\nstatus: up\n---" }]);
  const q = parseQuery('**FROM** "logs" **WHERE** [TXT] **OR** [TXT] ');
  const loaded = await loadExtRows(collectExtFilters(q.where), q.from, host);
  const row = loaded.rows.find((r) => r.path === "logs/X.TXT");
  assert.ok(row);
  assert.equal(row.file.ext, "TXT"); // 原样：不转小写、不带点
  assert.deepEqual(paths(executeQuery(q, MD_ROWS, null, { extRows: loaded.rows })), ["logs/X.TXT"]);
});

/* ---------- 其他 ---------- */

test("[回归] 不写 [ext] → 行为与现状完全一致（extRows 为空）", async () => {
  const host = makeHost(SPECS);
  const r = await run('**FROM** "logs" **WHERE** status %==% \'x\'', host);
  assert.deepEqual(paths(r), ["logs/a.md"]);
  assert.deepEqual(r.loaded, { rows: [], failed: [] });
  assert.deepEqual(host.listCalls, []); // 零触发：不调用 listFiles，不读任何文件
});

test("[范围] 目录含子目录：logs/sub 下的文件被读取", async () => {
  const r = await run('**FROM** "logs" **WHERE** [] **AND** status %==% \'sub\'');
  assert.deepEqual(paths(r), ["logs/sub/s.log"]);
});

test("[范围] FROM 多目录 OR → 并集读取", async () => {
  const host = makeHost(SPECS);
  const r = await run('**FROM** "logs" **OR** "other" **WHERE** [txt]', host);
  assert.deepEqual(host.listCalls, [["logs", "other"]]);
  assert.deepEqual(paths(r).sort(), ["logs/b.txt", "other/d.txt"]);
});

test("[范围] FROM 目录 AND 标签 → 目录触发读取，标签在行级过滤", async () => {
  const host = makeHost(SPECS);
  const r = await run('**FROM** "logs" **AND** #task **WHERE** [txt]', host);
  assert.deepEqual(host.listCalls, [["logs"]]);
  // b.txt（自研）无 tags 字段 → 不满足 #task；无文件可满足 → 空结果，读取已发生
  assert.deepEqual(paths(r), []);
  assert.ok(r.loaded.rows.some((row) => row.path === "logs/b.txt"));
});

test("[TOTAL] 含 [ext] 的查询中 TOTAL 统计 [ext] 全量行（聚合遍在并入之后）", async () => {
  const r = await run('**SELECT** **TOTAL** n **AS** $总$, n **FROM** "logs" **WHERE** [txt]');
  assert.equal(r.globals?.get("总"), 3); // md 行 n=1 + [ext] 并入的 b.txt n=2
});

test("[TOTAL] TOTAL 是冻结的全局量：每行投影看到同一值，不存在逐行累计状态", async () => {
  const { evaluateExpr } = await import("@dsql/executor");
  const r = await run('**SELECT** **TOTAL** 1 **AS** $总$, $总$ **AS** 分母, n **FROM** "logs" **WHERE** [txt, md]');
  assert.equal(r.globals?.get("总"), 3); // FROM 全量：md a.md/e.md + [ext] b.txt
  assert.equal(r.rows.length, 3);
  const 分母列 = r.columns.find((c) => c.alias === "分母")!;
  for (const row of r.rows) {
    // 每一行（md 或 [ext] txt）查到的 TOTAL 都相同——聚合遍冻结，非逐行累计
    assert.equal(evaluateExpr(分母列.expr, row, null, undefined, undefined, r.globals ?? undefined), 3);
  }
});

test("[race] 文件在 listFiles 后消失 → 剔除并计数，不静默", async () => {
  const { loaded } = await run('**FROM** "logs" **WHERE** [txt, mp4]');
  assert.ok(loaded.failed.includes("logs/g.txt"));
});

test("[yaml] 首围栏前的内容按围栏共享语义忽略（收集所有 --- 行）", () => {
  assert.deepEqual(fb("前言\n---\nstate: 通过\n---"), { ok: true, value: { state: "通过" } });
});

test("[设置] failedFileListLimit：正整数保留，非法恢复默认 3", () => {
  assert.equal(normalizeSettings({ failedFileListLimit: 5 }).failedFileListLimit, 5);
  assert.equal(normalizeSettings({ failedFileListLimit: 1 }).failedFileListLimit, 1);
  assert.equal(normalizeSettings({}).failedFileListLimit, 3);
  assert.equal(normalizeSettings({ failedFileListLimit: 0 }).failedFileListLimit, 3);
  assert.equal(normalizeSettings({ failedFileListLimit: -2 }).failedFileListLimit, 3);
  assert.equal(normalizeSettings({ failedFileListLimit: 2.5 }).failedFileListLimit, 3);
  assert.equal(normalizeSettings({ failedFileListLimit: "3" }).failedFileListLimit, 3);
});

test("[渲染] failedListForRender：截断后 label 计数与列表长度一致", () => {
  const failed = ["b.mp4", "a.mp4", "d.mp4", "c.mp4", "e.mp4"];
  assert.deepEqual(failedListForRender(failed, 3), { shown: ["b.mp4", "a.mp4", "d.mp4"], count: 3 });
  assert.deepEqual(failedListForRender(failed, 10), { shown: failed, count: 5 });
  assert.deepEqual(failedListForRender(failed, 1), { shown: ["b.mp4"], count: 1 });
  // 非法 limit 按 1 处理
  assert.equal(failedListForRender(failed, 0).count, 1);
  assert.equal(failedListForRender(failed, -1).count, 1);
  assert.equal(failedListForRender(failed, 2.5).count, 1);
});

queue.then(() => {
  if (failures.length > 0) {
    console.error(`\n[ext] 后缀过滤测试：${passed} 通过，${failures.length} 失败`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[ext] 后缀过滤测试：全部 ${passed} 个通过`);
});
