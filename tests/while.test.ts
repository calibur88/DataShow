/**
 * @module tests/while
 * @description DSQL 2.4 WHILE 循环驱动套件：语法 / 词法隔离 / 迭代语义 / 边界报错 /
 * 与 SEARCH 的耦合 / TOTAL 与 COUNT 口径（规范 §六.12）
 */

import assert from "node:assert/strict";
import { executeQuery, type ResultSet } from "@dsql/executor";
import { Lexer } from "@dsql/lexer";
import { parseQuery, QueryParseError } from "@dsql/parser";
import type { DataRow } from "@dsql/types";
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

const ROWS: DataRow[] = [
  makeRow("会议/A.md", "会议", { 状态: "待办" }),
  makeRow("会议/B.md", "会议", { 状态: "待办" }),
  makeRow("会议/C.md", "会议", { 状态: "无" }),
];

/** A 两条待办 / B 一条 / C 无匹配 */
const BODIES = new Map([
  ["会议/A.md", "- [ ] 待办1\n- [ ] 待办2"],
  ["会议/B.md", "- [ ] 待办X"],
  ["会议/C.md", "正文没有任何待办"],
]);

function run(sql: string, bodies: Map<string, string> = BODIES, rows: DataRow[] = ROWS): ResultSet & { debug: NonNullable<ResultSet["debug"]> } {
  return executeQuery(parseQuery(sql), rows, null, { bodies, debug: true }) as ResultSet & { debug: NonNullable<ResultSet["debug"]> };
}

const TODO = "'- \\[ \\] (.+)' **AS** 待办";
const values = (r: ResultSet): unknown[] => r.rows.map((row) => row.fields.待办);

const parseErr = (sql: string, match: RegExp): void => {
  assert.throws(() => parseQuery(sql), (err: unknown) => {
    assert.ok(err instanceof QueryParseError, `应为 QueryParseError，实际：${String(err)}`);
    assert.match(err.message, match);
    assert.match(err.message, /第 \d+ 行第 \d+ 列/);
    return true;
  });
};

/* ---------- 14.1 语法与词法 ---------- */

test("[语法] **WHILE** [0, 3] 解析成 WhileNode（两边界为数值 + 行列号）", () => {
  const q = parseQuery(`**FROM** "会议" **WHILE** [0, 3] **SEARCH** 'a' **AS** b`);
  assert.equal(q.while!.start, 0);
  assert.equal(q.while!.end, 3);
  assert.ok(q.while!.line >= 1 && q.while!.col >= 1);
});

test("[语法] 边界仅接受非负整数字面量：表达式 / 字段 / 函数 / 变量 → parse 期致命", () => {
  parseErr(`**FROM** "会议" **WHILE** [0, 2 %+% 1] **SEARCH** 'a' **AS** b`, /\*\*WHILE\*\* 结束边界须为 NUMBER 字面量/);
  parseErr(`**FROM** "会议" **WHILE** [0, 轮次] **SEARCH** 'a' **AS** b`, /\*\*WHILE\*\* 结束边界须为 NUMBER 字面量/);
  parseErr(`**FROM** "会议" **WHILE** [$x$, 3] **SEARCH** 'a' **AS** b`, /\*\*WHILE\*\* 起始边界须为 NUMBER 字面量/);
  parseErr(`**FROM** "会议" **WHILE** [0, 1.5] **SEARCH** 'a' **AS** b`, /\*\*WHILE\*\* 结束边界须为非负整数/);
  // 边界语法不含逗号（NUMBER 字面量无参数列表）：带逗号的表达式按顶层逗号切分 → 段数不符
  parseErr(`**FROM** "会议" **WHILE** [0, **root**(4, 2)] **SEARCH** 'a' **AS** b`, /\*\*WHILE\*\* 需两个边界/);
});

test("[语法] 缺逗号 / 三值 / 非方括号 / 空片段 → parse 期致命（带行列号）", () => {
  parseErr(`**FROM** "会议" **WHILE** [0] **SEARCH** 'a' **AS** b`, /\*\*WHILE\*\* 需两个边界/);
  parseErr(`**FROM** "会议" **WHILE** [0, 1, 2] **SEARCH** 'a' **AS** b`, /\*\*WHILE\*\* 需两个边界/);
  parseErr(`**FROM** "会议" **WHILE** [0, ] **SEARCH** 'a' **AS** b`, /边界不能为空/);
  parseErr(`**FROM** "会议" **WHILE** 0, 1 **SEARCH** 'a' **AS** b`, /方括号包裹两个非负整数字面量/);
  // 缺右方括号 → 词法层拦截（`[` 未闭合）
  assert.throws(() => parseQuery(`**FROM** "会议" **WHILE** [0, 1 **SEARCH** 'a' **AS** b`), /未闭合/);
});

test("[语法] 边界报错列号为绝对列（指向 `[`），片段内词法错误按 `[` 重定位", () => {
  assert.throws(
    () => parseQuery(`**FROM** "会议" **WHILE** [$x$, 3] **SEARCH** 'a' **AS** b`),
    (err: unknown) => {
      assert.match((err as Error).message, /\*\*WHILE\*\* 起始边界须为 NUMBER 字面量/);
      const col = Number(/第 1 行第 (\d+) 列/.exec((err as Error).message)![1]);
      assert.ok(col > 20, `列号应为绝对列，实际 ${col}`);
      return true;
    },
  );
  // 片段内词法错误 → 按 `[` 重定位（绝对列），而非裸报片段内列号
  assert.throws(
    () => parseQuery(`**FROM** "会议" **WHILE** [0, 1.] **SEARCH** 'b' **AS** c`),
    (err: unknown) => {
      assert.match((err as Error).message, /非法数字/);
      const col = Number(/第 1 行第 (\d+) 列/.exec((err as Error).message)![1]);
      assert.ok(col > 20, `列号应为绝对列，实际 ${col}`);
      return true;
    },
  );
});

test("[词法] **WHILE** 全大写/小写标记均可（标记内大小写不敏感）", () => {
  assert.doesNotThrow(() => parseQuery(`**FROM** "会议" **while** [0, 1] **SEARCH** 'a' **AS** b`));
});

test("[词法] while（裸标识符）仍可作字段名 / 槽位名；'**WHILE**' 字符串天然隔离", () => {
  // 裸 while = 字段引用（排序键）
  const q = parseQuery(`**FROM** "会议" **WHILE** [0, 1] **SEARCH** 'a' **AS** b **SORT** while **ASC**`);
  assert.deepEqual(q.sort!.keys[0].expr, { kind: "field", path: "while" });
  // $while$ = 槽位声明
  const q2 = parseQuery(`**SELECT** $while$ **FROM** "会议" **WHILE** [0, 1] **SEARCH** 'a' **AS** b`);
  assert.equal(q2.select !== "*" && q2.select[0].slot, true);
  // 字符串内的 **WHILE** 只是正则文本
  const q3 = parseQuery(`**FROM** "会议" **WHILE** [0, 1] **SEARCH** '\\*\\*WHILE\\*\\*' **AS** b`);
  assert.equal(q3.search![0].pattern, "\\*\\*WHILE\\*\\*");
});

test("[词法] [ ] 内换行（LF / CRLF / CR）折为一个空格；CRLF 行号不双计", () => {
  const val = (src: string): string => new Lexer(src).tokenize().find((t) => t.type === "extfilter")!.value;
  assert.equal(val("[a\nb]"), "a b");
  assert.equal(val("[a\r\nb]"), "a b");
  assert.equal(val("[a\rb]"), "a b");
  assert.equal(val("[0,\r\n5]"), "0, 5");
  // CRLF 在括号内只推一行（\r 不额外计行）
  const toks = new Lexer(`**FROM** "x" **WHERE** [a,\r\nb] **SORT** c **ASC**`).tokenize();
  assert.equal(toks.find((t) => t.type === "marked" && t.value === "SORT")!.line, 2);
  // 折叠后 WHILE 边界照常可解析
  const q = parseQuery(`**FROM** "会议" **WHILE** [0,\r\n5] **SEARCH** 'a' **AS** b`);
  assert.equal(q.while!.start, 0);
  assert.equal(q.while!.end, 5);
});

/* ---------- 14.2 迭代语义 ---------- */

test("[迭代] 迭代序列 a..b-1：次数 = b - a，每行产出固定行数", () => {
  const r = run(`**FROM** "会议" **WHILE** [0, 4] **SEARCH** ${TODO}`);
  assert.equal(r.rows.length, 12); // 3 行 × 4 轮
  assert.deepEqual(values(r), ["待办1", "待办2", null, null, "待办X", null, null, null, null, null, null, null]);
});

test("[迭代] [2, 5] → 3 次，与 [0, 3] 同值（无轮次变量，起始的绝对值不影响结果）", () => {
  const a = run(`**FROM** "会议" **WHILE** [0, 3] **SEARCH** ${TODO}`);
  const b = run(`**FROM** "会议" **WHILE** [2, 5] **SEARCH** ${TODO}`);
  assert.equal(b.rows.length, 9);
  assert.deepEqual(values(b), values(a));
});

test("[迭代] [0, 1] 等价单轮 = 首个匹配（SEARCH-only 查询的迁移口径）", () => {
  const r = run(`**FROM** "会议" **WHILE** [0, 1] **SEARCH** ${TODO}`);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(values(r), ["待办1", "待办X", null]);
});

test("[迭代] 匹配不足补 null、不提前停；无 body 的行同样产出全 null 行", () => {
  const r = run(`**FROM** "会议" **WHILE** [0, 3] **SEARCH** ${TODO}`, new Map());
  assert.equal(r.rows.length, 9); // 3 行 × 3 轮，全 null 也照产
  assert.deepEqual(values(r), [null, null, null, null, null, null, null, null, null]);
});

test("[迭代] 多模板各自推进游标（互不干扰）", () => {
  const r = run(`**FROM** "会议" **WHILE** [0, 2] **SEARCH** '- \\[ \\] (.+)' **AS** 待办, '\\[( )\\]' **AS** 框`);
  assert.deepEqual(r.rows.map((row) => [row.fields.待办, row.fields.框]), [
    ["待办1", " "], ["待办2", " "], ["待办X", " "], [null, null], [null, null], [null, null],
  ]);
});

/* ---------- 14.3 边界校验（parse 期静态） ---------- */

test("[边界] 起始 ≥ 结束 / 小数 / 负数 / null / 缺失字段 → parse 期致命（不跳过、不静默）", () => {
  parseErr(`**FROM** "会议" **WHILE** [3, 3] **SEARCH** ${TODO}`, /起始边界须小于结束边界/);
  parseErr(`**FROM** "会议" **WHILE** [3, 0] **SEARCH** ${TODO}`, /起始边界须小于结束边界/);
  parseErr(`**FROM** "会议" **WHILE** [0.5, 5] **SEARCH** ${TODO}`, /\*\*WHILE\*\* 起始边界须为非负整数/);
  parseErr(`**FROM** "会议" **WHILE** [0, 2.5] **SEARCH** ${TODO}`, /\*\*WHILE\*\* 结束边界须为非负整数/);
  parseErr(`**FROM** "会议" **WHILE** [%-% 1, 3] **SEARCH** ${TODO}`, /起始边界须为 NUMBER 字面量/);
  parseErr(`**FROM** "会议" **WHILE** [null, 3] **SEARCH** ${TODO}`, /起始边界须为 NUMBER 字面量/);
  parseErr(`**FROM** "会议" **WHILE** [0, 轮次] **SEARCH** ${TODO}`, /结束边界须为 NUMBER 字面量/);
});

/* ---------- 14.4 与 SEARCH 的耦合与执行位置 ---------- */

test("[耦合] SEARCH 抽取字段对 WHERE / SORT / SELECT 全部可用", () => {
  const where = run(`**FROM** "会议" **WHILE** [0, 5] **SEARCH** ${TODO} **WHERE** 待办 %!=% null`);
  assert.equal(where.rows.length, 3); // A2 + B1；C 的 5 行全 null 被过滤
  const sort = run(`**FROM** "会议" **WHILE** [0, 5] **SEARCH** ${TODO} **WHERE** 待办 %!=% null **SORT** 待办 **DESC**`);
  assert.deepEqual(values(sort), ["待办X", "待办2", "待办1"]);
  const select = run(`**FROM** "会议" **WHILE** [0, 5] **SEARCH** ${TODO} **SELECT** 待办`);
  assert.deepEqual(select.columns.map((c) => c.alias), ["待办"]);
});

test("[耦合] 与 [ext] 并入行协同：非 md 行按 body 同样参与迭代", () => {
  const ext = makeRow("会议/D.txt", "会议", {});
  ext.file.ext = "txt";
  const bodies = new Map([...BODIES, ["会议/D.txt", "第一行\n第二行"]]);
  const r = executeQuery(parseQuery(`**FROM** "会议" **WHILE** [0, 2] **SEARCH** '(.+)' **AS** 行`), ROWS, null, {
    bodies,
    extRows: [ext],
  });
  assert.equal(r.rows.length, 8); // 4 行 × 2 轮
  assert.deepEqual(r.rows.slice(6).map((row) => row.fields.行), ["第一行", "第二行"]);
});

/* ---------- 14.5 TOTAL / COUNT 口径 ---------- */

test("[口径] TOTAL 基于匹配后行集（含补 null 行），恒忽略 WHERE", () => {
  const r = run(`**SELECT** **TOTAL** 1 **AS** $总行数$, 待办 **FROM** "会议" **WHILE** [0, 5] **SEARCH** ${TODO} **WHERE** 待办 %!=% null`);
  assert.equal(r.globals!.get("总行数"), 15); // 3 × 5，含 null 行，不含 WHERE 影响
  assert.equal(r.rows.length, 3); // WHERE 只过滤显示行
});

test("[口径] TOTAL 与 COUNT 正交：差 = 补 null 行数", () => {
  const r = run(`**SELECT** **TOTAL** 1 **AS** $全量$, $有效$ **FROM** "会议" **WHILE** [0, 5] **SEARCH** ${TODO} **COUNT** 待办 %!=% null **AS** $有效$`);
  assert.equal(r.globals!.get("全量"), 15);
  assert.equal(r.globals!.get("有效"), 3);
  assert.equal(r.rows.length, 1); // SELECT 仅 TOTAL + 槽位 → 单行合成
});

test("[口径] TOTAL 可聚合 SEARCH 抽取字段（隐式转换，非数值跳过 + warning）", () => {
  const rows: DataRow[] = [makeRow("账单/A.md", "账单", {}), makeRow("账单/B.md", "账单", {})];
  const bodies = new Map([
    ["账单/A.md", "金额:10\n金额:20"],
    ["账单/B.md", "金额:abc"],
  ]);
  const r = run(`**SELECT** file.name **AS** 文件, 金额, **TOTAL** 金额 **AS** $金额总和$ **FROM** "账单" **WHILE** [0, 3] **SEARCH** '金额:(.+)' **AS** 金额`, bodies, rows);
  assert.equal(r.globals!.get("金额总和"), 30); // 10 + 20；"abc" 跳过
  assert.equal(r.rows.length, 6); // 2 行 × 3 轮
  assert.deepEqual(r.rows.map((row) => row.fields.金额), ["10", "20", null, "abc", null, null]);
  assert.ok(r.debug.warnings.some((w) => /跳过 1 个非数值行/.test(w.message)));
});

/* ---------- 14.6 调试 ---------- */

test("[调试] search 统计按产出单元格计数（命中 / 补 null / 示例 ≤3）", () => {
  const r = run(`**FROM** "会议" **WHILE** [0, 5] **SEARCH** ${TODO}`);
  assert.deepEqual(r.debug.search, [
    { alias: "待办", pattern: "- \\[ \\] (.+)", hits: 3, misses: 12, samples: ["待办1", "待办2", "待办X"] },
  ]);
});

test("[调试] 空匹配正则（.*）不死循环：空匹配推进 lastIndex", () => {
  const r = run(`**FROM** "会议" **WHILE** [0, 3] **SEARCH** '.*' **AS** 全`, new Map([["会议/A.md", "ab"]]), ROWS.slice(0, 1));
  assert.deepEqual(r.rows.map((row) => row.fields.全), ["ab", "", null]);
});

queue.then(() => {
  if (failures.length > 0) {
    console.error(`\nWHILE 循环驱动测试：${passed} 通过，${failures.length} 失败`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nWHILE 循环驱动测试：全部 ${passed} 个通过`);
});
