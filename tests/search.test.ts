/**
 * @module tests/search
 * @description SEARCH 正文抽取套件：语法 / STRING 词法 / 正则 / 求值 / 执行顺序 / 冲突 /
 * body 来源 / §6.3 算术比较排序补丁 / 排序 / 回归（规范 §十三）
 */

import assert from "node:assert/strict";
import { evaluateExpr, executeQuery, type ResultSet } from "@dsql/executor";
import { parseQuery, QueryParseError } from "@dsql/parser";
import { EMPTY, type DataRow } from "@dsql/types";
import { extractMdBody, stripFenceBlocks } from "@index/body";
import { loadBodies, type ExtSourceHost } from "@index/ext-source";
import { buildRow } from "@index/row-builder";
import { makeRow } from "./helpers";

let passed = 0;
const failures: { name: string; err: unknown }[] = [];
let queue: Promise<void> = Promise.resolve();

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

/* ---------- 共用场景 ---------- */

const MD_ROWS: DataRow[] = [
  makeRow("小说/甲.md", "小说", { 状态: "连载中" }),
  makeRow("小说/乙.md", "小说", {}),
];

function run(sql: string, bodies?: Map<string, string>): ResultSet & { debug: NonNullable<ResultSet["debug"]> } {
  const q = parseQuery(sql);
  const r = executeQuery(q, MD_ROWS, null, { bodies, debug: true });
  return r as ResultSet & { debug: NonNullable<ResultSet["debug"]> };
}

/** 构造 SEARCH 查询捷径：给两行各配一个 body */
function searchRun(item: string, bodies: Record<string, string>) {
  const map = new Map(Object.entries(bodies));
  return run(`**FROM** "小说" **SEARCH** ${item}`, map);
}

const parseErr = (sql: string, match: RegExp): void => {
  assert.throws(() => parseQuery(sql), (err: unknown) => {
    assert.ok(err instanceof QueryParseError, `应为 QueryParseError，实际：${String(err)}`);
    assert.match(err.message, match);
    assert.match(err.message, /第 \d+ 行第 \d+ 列/);
    return true;
  });
};

/* ---------- 13.1 语法 ---------- */

test("[语法] SEARCH 'a' AS x 解析成 SearchNode（pattern / regex / alias / 行列号）", () => {
  const q = parseQuery('**FROM** "小说" **SEARCH** \'a\' **AS** x');
  assert.equal(q.search!.length, 1);
  assert.equal(q.search![0].pattern, "a");
  assert.ok(q.search![0].regex instanceof RegExp);
  assert.equal(q.search![0].alias, "x");
  assert.ok(q.search![0].line >= 1 && q.search![0].col >= 1);
});

test("[语法] 多条模板逗号分隔", () => {
  const q = parseQuery("**FROM** \"小说\" **SEARCH**\n  '第([一二三四五六七八九十百\\d]+)章' **AS** 章节号,\n  '\\[(.+?)\\]' **AS** 标题");
  assert.deepEqual(q.search!.map((s) => s.alias), ["章节号", "标题"]);
  assert.equal(q.search![0].pattern, "第([一二三四五六七八九十百\\d]+)章");
  assert.equal(q.search![1].pattern, "\\[(.+?)\\]");
});

test("[语法] SEARCH 出现两次 → 解析错误（子句重复）", () => {
  parseErr('**FROM** "小说" **SEARCH** \'a\' **AS** x **SEARCH** \'b\' **AS** y', /子句重复/);
});

test("[语法] SEARCH 'a'（缺 AS）→ 解析错误", () => {
  parseErr('**FROM** "小说" **SEARCH** \'a\'', /\*\*AS\*\*/);
});

test("[语法] SEARCH 'a' AS $x$（变量别名）→ 解析错误", () => {
  parseErr('**FROM** "小说" **SEARCH** \'a\' **AS** $x$', /裸标识符/);
});

test("[语法] SEARCH 出现在 WHERE / SELECT 表达式内 → 解析错误", () => {
  parseErr('**FROM** "小说" **WHERE** **SEARCH**', /应为表达式/);
  parseErr('**SELECT** **SEARCH** **FROM** "小说"', /应为表达式/);
});

test("[语法] SEARCH 需要 FROM 前件", () => {
  parseErr('**SEARCH** \'a\' **AS** x', /前件/);
});

/* ---------- 13.2 STRING 解析 ---------- */

const patternOf = (sql: string): string => parseQuery(`**FROM** "小说" **SEARCH** ${sql} **AS** x`).search![0].pattern;

test("[STRING] 转义逐字符原样（规范 §3.2 行为对照）", () => {
  assert.equal(patternOf("'\\d+'"), "\\d+");
  assert.equal(patternOf("'\\\\d'"), "\\\\d"); // 两个反斜杠 + d
  assert.equal(patternOf("'\\\\p{L}'"), "\\\\p{L}"); // 合法，不报错
  assert.equal(patternOf("'it\\'s'"), "it's");
  assert.equal(patternOf("'abc\\\\'"), "abc\\\\"); // 两个反斜杠
  assert.equal(patternOf("'a\\'b'"), "a'b");
  assert.equal(patternOf("'abc\\\\\\\\'"), "abc\\\\\\\\"); // 四个反斜杠
});

test("[STRING] 'abc\\'（奇数反斜杠吃掉终止符）→ 词法错误", () => {
  assert.throws(() => parseQuery("**FROM** \"小说\" **SEARCH** 'abc\\' **AS** x"), /字符串未闭合/);
});

/* ---------- 13.3 正则 ---------- */

test("[正则] '(' / 'a**b' → parse 期致命错误", () => {
  parseErr('**FROM** "小说" **SEARCH** \'(\' **AS** x', /SEARCH 正则非法/);
  parseErr('**FROM** "小说" **SEARCH** \'a**b\' **AS** x', /SEARCH 正则非法/);
});

test("[正则] 未转义 \\p{ → parse 期致命错误（奇偶判定）", () => {
  parseErr('**FROM** "小说" **SEARCH** \'\\p{L}\' **AS** x', /不支持 \\p\{…\}/);
  assert.doesNotThrow(() => parseQuery('**FROM** "小说" **SEARCH** \'\\\\p{L}\' **AS** x')); // 偶数反斜杠 = 字面文本
});

test("[正则] 无 flags：大小写敏感", () => {
  const r = searchRun("'abc' **AS** m", { "小说/甲.md": "ABC abc" });
  assert.equal(r.rows[0].fields.m, "abc"); // 只命中小写
});

/* ---------- 13.4 求值 ---------- */

test("[求值] 有捕获组取 m[1]，无捕获组取 m[0]，输出原样字符串", () => {
  const r = searchRun("'第(\\d+)章' **AS** 章节号, '第\\d+章' **AS** 整体", { "小说/甲.md": "第3章" });
  assert.equal(r.rows[0].fields.章节号, "3");
  assert.equal(r.rows[0].fields.整体, "第3章");
});

test("[求值] 无匹配 → null；'\\d+' 对 007 → '007'（不转数字）", () => {
  const r = searchRun("'\\d+' **AS** n, 'xyz' **AS** 无", { "小说/甲.md": "007" });
  assert.equal(r.rows[0].fields.n, "007");
  assert.equal(r.rows[0].fields.无, null);
});

test("[求值] 只取首个匹配与第一个捕获组；可选捕获组未匹配回落 m[0]", () => {
  const r = searchRun("'(\\d+).*(\\d+)' **AS** 首组, '\\d+' **AS** 多段, 'x(\\d+)?' **AS** 可选", { "小说/甲.md": "a1b2c3 x" });
  const row = r.rows[0].fields;
  assert.equal(row.首组, "1");
  assert.equal(row.多段, "1");
  assert.equal(row.可选, "x"); // m[1] === undefined → 回落 m[0]
});

test("[求值] 无 body 的行 → 全部字段 null（不是 empty 值，不是 \"\"）", () => {
  const r = searchRun("'\\d+' **AS** n", {}); // 两行都无 body
  for (const row of r.rows) {
    assert.equal(row.fields.n, null);
    assert.notEqual(row.fields.n, EMPTY);
  }
  assert.equal(r.debug.search[0].hits, 0);
  assert.equal(r.debug.search[0].misses, 2);
});

/* ---------- 13.5 执行顺序 ---------- */

test("[顺序] SEARCH 字段在 WHERE / SORT / SELECT 全部可用", () => {
  const map = new Map([["小说/甲.md", "第3章"], ["小说/乙.md", "第12章"]]);
  const where = run("**FROM** \"小说\" **SEARCH** '第(\\d+)章' **AS** 章节号 **WHERE** 章节号 %==% '3'", map);
  assert.equal(where.rows.length, 1);
  assert.equal(where.rows[0].path, "小说/甲.md");

  const sort = run("**FROM** \"小说\" **SEARCH** '第(\\d+)章' **AS** 章节号 **SORT** 章节号 %+% 0 **DESC**", map);
  assert.equal(sort.rows[0].path, "小说/乙.md"); // 数值序 12 > 3

  const select = run("**FROM** \"小说\" **SEARCH** '第(\\d+)章' **AS** 章节号 **SELECT** 章节号", map);
  assert.deepEqual(select.columns.map((c) => c.alias), ["章节号"]);
});

/* ---------- 13.6 冲突 ---------- */

test("[冲突] SEARCH 别名互相同名 → parse 期", () => {
  parseErr('**FROM** "小说" **SEARCH** \'a\' **AS** x, \'b\' **AS** x', /重复/);
});

test("[冲突] SEARCH 别名与 SELECT 别名同名 → parse 期（子句乱序也可判定）", () => {
  parseErr('**SELECT** 状态 **AS** x **FROM** "小说" **SEARCH** \'a\' **AS** x', /与 SELECT 别名冲突/);
  parseErr('**FROM** "小说" **SELECT** 状态 **AS** x **SEARCH** \'a\' **AS** x', /与 SELECT 别名冲突/);
});

test("[冲突] SEARCH 别名与 frontmatter 字段并集冲突 → prepare 期（带 SEARCH 别名行列号）", () => {
  assert.throws(
    () => run('**FROM** "小说" **SEARCH** \'a\' **AS** 状态', new Map([["小说/甲.md", "a"]])),
    (err: unknown) => {
      assert.match(String(err), /SEARCH 别名 '状态' 与现有字段名冲突/);
      assert.match(String(err), /第 \d+ 行第 \d+ 列/);
      return true;
    },
  );
});

test("[冲突] SEARCH 别名与 file.* 内置字段冲突 → prepare 期", () => {
  assert.throws(() => run('**FROM** "小说" **SEARCH** \'a\' **AS** name'), /与现有字段名冲突/);
  assert.throws(() => run('**FROM** "小说" **SEARCH** \'a\' **AS** file.name'), /与现有字段名冲突/);
});

/* ---------- 13.7 body 来源 ---------- */

test("[body] md：frontmatterPosition.end.offset 剥离 + 去一个前导 \\n", () => {
  const text = "---\nstatus: x\n---\n第3章\n\n\n后文";
  assert.equal(extractMdBody(text, text.indexOf("---", 4) + 3), "第3章\n\n\n后文");
});

test("[body] md 无 frontmatter → body = 全文，前导 \\n 不去除（^ 可锚定）", () => {
  assert.equal(extractMdBody("\n第3章", null), "\n第3章");
  assert.ok(/^第3章/.test(extractMdBody("第3章", null)));
});

test("[body] md 正文水平线 --- 不误伤", () => {
  const body = extractMdBody("---\na: 1\n---\nintro\n\n---\n\noutro", 12);
  assert.equal(body, "intro\n\n---\n\noutro");
});

test("[body] 非 md：剥掉全部 --- 围栏及之间内容；``` 围栏原样保留", () => {
  assert.equal(stripFenceBlocks("---\n隐藏\n---\nvisible\n```\ncode\n```\n---\nhidden2\n---\ntail"), "visible\n```\ncode\n```\ntail");
});

test("[body] 非 md：未闭合围栏剥到 EOF；奇数个围栏最后一个之后全剥", () => {
  assert.equal(stripFenceBlocks("---\n隐藏"), "");
  assert.equal(stripFenceBlocks("keep\n---\na\n---\nb\n---\nc"), "keep\nb");
});

test("[body] body 末尾 \\n 不规范化：$ 严格匹配输入末尾（JS 与 Python/PCRE 差异）", () => {
  assert.equal(/第3章$/.test("第3章\n"), false);
  assert.equal(/第3章\n?$/.test("第3章\n"), true);
  const bodies = new Map([["小说/甲.md", "第3章\n"]]);
  const miss = searchRun("'第(\\d+)章$' **AS** c", Object.fromEntries(bodies));
  assert.equal(miss.rows[0].fields.c, null);
  const hit = searchRun("'第(\\d+)章\\n?$' **AS** c", Object.fromEntries(bodies));
  assert.equal(hit.rows[0].fields.c, "3");
});

test("[body] loadBodies：md / 非 md 按 ext 分派；读取失败不入表（无 body → null 不 warning）", async () => {
  const host = {
    async readBody(path: string) {
      if (path === "m.md") return { text: "---\na: 1\n---\n正文", frontmatterEnd: 12 };
      if (path === "t.txt") return { text: "---\n隐藏\n---\n正文2", frontmatterEnd: null };
      return null; // race：文件消失
    },
  } as unknown as ExtSourceHost;
  const rows = [
    makeRow("m.md", "x", {}),
    makeRow("t.txt", "x", {}),
    makeRow("gone.txt", "x", {}),
  ];
  rows[1].file.ext = "txt"; // makeRow 默认 ext 为 md，非 md 行需显式改
  const bodies = await loadBodies(rows, host);
  assert.equal(bodies.get("m.md"), "正文");
  assert.equal(bodies.get("t.txt"), "正文2");
  assert.equal(bodies.has("gone.txt"), false);
});

/* ---------- 13.8 算术 / 比较（§6.3 补丁回归） ---------- */

/** 单行单表达式求值（投影在渲染层求值，执行器不产警告，故挂独立 warn 接收器） */
function evalOn(expr: string, fields: DataRow["fields"] = {}): { value: unknown; warnings: string[] } {
  const row = makeRow("M/一行.md", "M", fields);
  const q = parseQuery(`**SELECT** ${expr} **AS** v **FROM** "M"`);
  executeQuery(q, [row], null, { debug: true });
  const warnings: string[] = [];
  const value = evaluateExpr(q.select[0].expr, row, null, undefined, (msg) => warnings.push(msg));
  return { value, warnings };
}

test("[算术] 数字串隐式转数字；非数值串 / 空白 → null + warning", () => {
  assert.equal(evalOn("'123' %+% 0").value, 123);
  assert.equal(evalOn("'007' %+% 0").value, 7);
  const bad = evalOn("'asdd1213' %+% 0");
  assert.equal(bad.value, null);
  assert.equal(bad.warnings.length, 1);
  assert.equal(evalOn("'' %+% 0").value, null);
  assert.equal(evalOn("'' %+% 0").warnings.length, 1);
  assert.equal(evalOn("' ' %+% 0").value, null);
  assert.equal(evalOn("' ' %+% 0").warnings.length, 1);
});

test("[算术] null / empty → null 不计 warning；非原始值 → null + warning（禁止 Number([5]) 静默转换）", () => {
  assert.equal(evalOn("null %+% 0").value, null);
  assert.equal(evalOn("null %+% 0").warnings.length, 0);
  const emptyVal = evalOn("未赋值 %+% 0", { 未赋值: EMPTY });
  assert.equal(emptyVal.value, null);
  assert.equal(emptyVal.warnings.length, 0);
  assert.equal(evalOn("arr %+% 0", { arr: [5] }).value, null);
  assert.equal(evalOn("arr %+% 0", { arr: [5] }).warnings.length, 1);
  assert.equal(evalOn("arr %+% 0", { arr: [1, 2] }).value, null);
  // 空数组经摄取层归一为 null（buildRow）→ null 守卫，不计 warning
  const ingestRow = buildRow({ path: "M/r.md", basename: "r", folder: "M", ext: "md", size: 1, ctime: 1, mtime: 1 }, { arr: [] }, [], []);
  const q2 = parseQuery('**SELECT** arr %+% 0 **AS** v **FROM** "M"');
  executeQuery(q2, [ingestRow], null, { debug: true });
  const warnings2: string[] = [];
  assert.equal(evaluateExpr(q2.select[0].expr, ingestRow, null, undefined, (msg) => warnings2.push(msg)), null);
  assert.equal(warnings2.length, 0);
});

test("[比较] 同载数值比 / 同不转字符串比 / 混合 false / null 同一性", () => {
  assert.equal(evalOn("'123' %==% 123").value, true);
  assert.equal(evalOn("'007' %==% '7'").value, true);
  assert.equal(evalOn("'abc' %==% 'abc'").value, true);
  assert.equal(evalOn("'123' %==% 'abc'").value, false);
  assert.equal(evalOn("'' %==% ''").value, true);
  assert.equal(evalOn("'' %==% 0").value, false);
  assert.equal(evalOn("' ' %==% ''").value, false);
  assert.equal(evalOn("null %==% null").value, true);
  assert.equal(evalOn("null %==% 0").value, false);
});

test("[比较] 非原始值守卫在一切隐式转换之前（[5] %==% \"5\" 不因 toString 漏成 true）", () => {
  assert.equal(evalOn("arr %==% 5", { arr: [5] }).value, false);
  assert.equal(evalOn("arr %==% '5'", { arr: [5] }).value, false);
  assert.equal(evalOn("arr %==% arr", { arr: [5] }).value, false);
  assert.equal(evalOn("arr %==% null", { arr: [5] }).value, false); // 非原始值非 null
});

test("[排序比较] > 口径同 §6.3：数字串按数值（'10' %>% 2 由旧口径 false 变 true），混合 → false", () => {
  assert.equal(evalOn("'3' %>% 2").value, true);
  assert.equal(evalOn("'10' %>% 2").value, true); // 数值 10 > 2（旧字节比 "1" < "2" → false）
  assert.equal(evalOn("'2' %>% 10").value, false);
  assert.equal(evalOn("'abc' %>% 2").value, false); // 一边能转一边不能
  assert.equal(evalOn("'abc' %>% 'abd'").value, false); // 都转不出 → 字符串比
  assert.equal(evalOn("'abc' %>% 'aba'").value, true);
  assert.equal(evalOn("null %>% 2").value, false);
  assert.equal(evalOn("arr %>% 2", { arr: [5] }).value, false);
});

/* ---------- 13.9 排序 ---------- */

test("[排序] SORT 字段 %+% 0：数值序，null 排末尾；非原始值同 empty 排末尾", () => {
  const rows: DataRow[] = [
    makeRow("S/a.md", "S", { 字数: "123" }),
    makeRow("S/b.md", "S", { 字数: "45" }),
    makeRow("S/c.md", "S", {}), // 无字段 → null
    makeRow("S/d.md", "S", {}),
    makeRow("S/e.md", "S", {}),
  ];
  const r = executeQuery(parseQuery('**FROM** "S" **SEARCH** \'.*\' **AS** 任意 **SELECT** file.name **AS** 名, 字数 **SORT** 字数 %+% 0 **DESC**'), rows, null, {
    bodies: new Map([["S/a.md", "x"], ["S/b.md", "x"], ["S/c.md", "x"], ["S/d.md", "x"], ["S/e.md", "x"]]),
  });
  assert.deepEqual(r.rows.map((row) => row.path), ["S/a.md", "S/b.md", "S/c.md", "S/d.md", "S/e.md"]); // 123 → 45 → null 末尾稳定序
});

test("[排序] 非原始值排末尾（同 empty）；空串按 UTF-8 序排最前", () => {
  const rows: DataRow[] = [
    makeRow("S/a.md", "S", { 标题: "" }),
    makeRow("S/b.md", "S", { 标题: [5] }),
    makeRow("S/c.md", "S", { 标题: "甲" }),
  ];
  const r = executeQuery(parseQuery('**SELECT** file.name **AS** 名 **FROM** "S" **SORT** 标题 **ASC**'), rows, null, {});
  assert.deepEqual(r.rows.map((row) => row.path), ["S/a.md", "S/c.md", "S/b.md"]); // "" → 甲 → [5] 末尾
});

test("[排序] empty 值视同 null 排末尾且稳定保序", () => {
  const rows: DataRow[] = [
    makeRow("S/a.md", "S", { 状态: "乙" }),
    makeRow("S/b.md", "S", { 状态: EMPTY }),
    makeRow("S/c.md", "S", { 状态: "甲" }),
    makeRow("S/d.md", "S", {}),
  ];
  const r = executeQuery(parseQuery('**SELECT** file.name **AS** 名 **FROM** "S" **SORT** 状态 **ASC**'), rows, null, {});
  assert.deepEqual(r.rows.map((row) => row.path), ["S/a.md", "S/c.md", "S/b.md", "S/d.md"]); // 乙 甲（UTF-8 序）+ 末尾稳定序
});

/* ---------- 13.10 回归 ---------- */

test("[回归] 无 SEARCH 的查询不传 bodies，行为与现状完全一致", () => {
  const r = run('**SELECT** 状态 **FROM** "小说" **WHERE** 状态 %==% \'连载中\'');
  assert.equal(r.rows.length, 1);
  assert.equal(r.debug.search.length, 0);
});

test("[回归] TOTAL 口径不变：恒忽略 WHERE，基于 FROM 全量行", () => {
  const map = new Map([["小说/甲.md", "v"]]);
  const r = run("**FROM** \"小说\" **SEARCH** 'v' **AS** x **SELECT** **TOTAL** 1 **AS** $行数$, x **WHERE** x %==% 'v'", map);
  assert.equal(r.globals?.get("行数"), 2); // 聚合遍忽略 WHERE（乙无 body → x=null 也计入 FROM 全量）
  assert.equal(r.rows.length, 1); // WHERE 只过滤显示行
});

test("[调试] search 统计：命中数 / 未命中数 / 示例 ≤3", () => {
  const r = searchRun("'\\d+' **AS** n", { "小说/甲.md": "a1b2c3", "小说/乙.md": "abc" });
  assert.deepEqual(r.debug.search, [{ alias: "n", pattern: "\\d+", hits: 1, misses: 1, samples: ["1"] }]);
});

queue.then(() => {
  if (failures.length > 0) {
    console.error(`\nSEARCH 抽取测试：${passed} 通过，${failures.length} 失败`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nSEARCH 抽取测试：全部 ${passed} 个通过`);
});
