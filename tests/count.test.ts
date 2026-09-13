/**
 * @module tests/count
 * @description COUNT 分类计数套件：语法 / 槽位模型 / 口径 / 惯用法 / 错误路径（DSQL 2.3）
 */

import assert from "node:assert/strict";
import { evaluateExpr, executeQuery, type ResultSet } from "@dsql/executor";
import { parseQuery, QueryParseError } from "@dsql/parser";
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

const ROWS = [
  makeRow("C/a.md", "C", { state: "过载", due: "2024-06-01" }),
  makeRow("C/b.md", "C", { state: "过载", due: "2023-01-01" }),
  makeRow("C/c.md", "C", { state: "无" }),
];

function run(sql: string, opts: { extRows?: DataRow[] } = {}): ResultSet & { debug: NonNullable<ResultSet["debug"]> } {
  const r = executeQuery(parseQuery(sql), ROWS, null, { ...opts, debug: true });
  return r as ResultSet & { debug: NonNullable<ResultSet["debug"]> };
}

const parseErr = (sql: string, match: RegExp): void => {
  assert.throws(() => parseQuery(sql), (err: unknown) => {
    assert.ok(err instanceof QueryParseError, `应为 QueryParseError，实际：${String(err)}`);
    assert.match(err.message, match);
    assert.match(err.message, /第 \d+ 行第 \d+ 列/);
    return true;
  });
};

const globalsOf = (r: ResultSet, name: string) => r.globals?.get(name);

/* ---------- 语法 ---------- */

test("[语法] 显式比较 + $槽位$ 解析成 CountItemNode", () => {
  const q = parseQuery('**FROM** "C" **SELECT** $过载数$ **COUNT** state %==% \'过载\' **AS** $过载数$');
  assert.equal(q.count!.length, 1);
  assert.equal(q.count![0].cmp.op, "==");
  assert.equal(q.count![0].slot, "过载数");
  assert.ok(q.count![0].line >= 1 && q.count![0].col >= 1);
});

test("[语法] 多条计数逗号分隔，互不干扰", () => {
  const r = run("**FROM** \"C\" **SELECT** $过载$, $无$ **COUNT** state %==% '过载' **AS** $过载$, state %==% '无' **AS** $无$");
  assert.equal(globalsOf(r, "过载"), 2);
  assert.equal(globalsOf(r, "无"), 1);
});

test("[语法] COUNT 子句重复 → 解析错误", () => {
  parseErr('**FROM** "C" **COUNT** a %==% 1 **AS** $x$ **COUNT** b %==% 2 **AS** $y$', /子句重复/);
});

test("[语法] 前件 FROM 缺失 → 解析错误（带行列号）", () => {
  parseErr("**COUNT** a %==% 1 **AS** $x$", /前件/);
});

test("[语法] 裸操作数（无比较符）→ 解析错误", () => {
  parseErr('**FROM** "C" **COUNT** state **AS** $x$', /需比较语句/);
});

test("[语法] 与 AND / OR 组合 → 解析错误（COUNT 是子句不是表达式）", () => {
  parseErr("**FROM** \"C\" **COUNT** state %==% '过载' **AND** due **AS** $x$", /预期 \*\*AS\*\*/);
});

test("[语法] 比较内引用 $变量$ → 致命（聚合变量仅 SELECT 可引用）", () => {
  parseErr("**FROM** \"C\" **SELECT** $x$ **COUNT** $x$ %==% 1 **AS** $x$", /仅可在 \*\*SELECT\*\* 中引用/);
});

test("[语法] AS 裸名（非 $槽位$）→ 解析错误", () => {
  parseErr("**FROM** \"C\" **COUNT** state %==% '过载' **AS** 过载数", /别名必须为槽位/);
});

/* ---------- 槽位模型 ---------- */

test("[槽位] AS $x$ 未在 SELECT 声明 → parse 期致命", () => {
  parseErr('**FROM** "C" **COUNT** state %==% \'过载\' **AS** $过载数$', /映射名 \$过载数\$ 未在 SELECT 声明/);
});

test("[槽位] 指向输出别名（expr AS $x$）→ 非槽位声明致命", () => {
  parseErr("**SELECT** state %+% 1 **AS** $x$ **FROM** \"C\" **COUNT** state %==% '过载' **AS** $x$", /非槽位声明/);
});

test("[槽位] 同一槽位被 TOTAL 与 COUNT 双填充 → 已被填充", () => {
  parseErr("**SELECT** $x$, **TOTAL** 1 **AS** $x$ **FROM** \"C\" **COUNT** state %==% '过载' **AS** $x$", /已被填充/);
});

test("[槽位] 裸槽位重复声明 → 致命", () => {
  parseErr('**SELECT** $x$, $x$ **FROM** "C" **COUNT** state %==% \'过载\' **AS** $x$', /重复声明/);
});

test("[槽位] expr AS $x$ 与裸 $x$ 撞名 → 重复声明", () => {
  parseErr("**SELECT** state %+% 1 **AS** $x$, $x$ **FROM** \"C\" **COUNT** state %==% '过载' **AS** $x$", /重复声明/);
});

test("[槽位] 未填充槽位静默忽略（不投影、不报错）", () => {
  const r = run("**FROM** \"C\" **SELECT** state, $过载数$, $未用槽$ **COUNT** state %==% '过载' **AS** $过载数$");
  assert.deepEqual(r.columns.map((c) => c.alias), ["state", "过载数"]);
});

/* ---------- 口径与求值 ---------- */

test("[口径] 无 WHERE → FROM 全量口径", () => {
  const r = run("**FROM** \"C\" **SELECT** state, $过载数$ **COUNT** state %==% '过载' **AS** $过载数$");
  assert.equal(globalsOf(r, "过载数"), 2);
  assert.match(r.debug.count[0], /全量/);
});

test("[口径] 有 WHERE → 过滤后行集；TOTAL 1 恒全量（两口径对照）", () => {
  const r = run("**SELECT** **TOTAL** 1 **AS** $全量$, state, $过载数$ **FROM** \"C\" **WHERE** due %>% '2023-06-01' **COUNT** state %==% '过载' **AS** $过载数$");
  assert.equal(globalsOf(r, "全量"), 3); // TOTAL 恒全量
  assert.equal(globalsOf(r, "过载数"), 1); // WHERE 后仅 a（过载 + due 2024）
  assert.match(r.debug.count[0], /WHERE 过滤后行集/);
});

test("[惯用法] true %==% true = WHERE 过滤后行数（COUNT(*) 等价）", () => {
  const r = run("**SELECT** **TOTAL** 1 **AS** $全量$, $过滤文件数$ **FROM** \"C\" **WHERE** state %==% '过载' **COUNT** true %==% true **AS** $过滤文件数$");
  assert.equal(globalsOf(r, "过滤文件数"), 2); // WHERE 后行数
  assert.equal(globalsOf(r, "全量"), 3); // TOTAL 恒全量
});

test("[求值] 复用 §6.3 比较口径：null 参与按同一性（缺失字段不计入）", () => {
  const r = run("**FROM** \"C\" **SELECT** $有due$ **COUNT** due %!=% null **AS** $有due$");
  assert.equal(globalsOf(r, "有due"), 2); // c 行 due 缺失 → null %!=% null → false
});

test("[引用] COUNT 可消费 SEARCH 抽取字段", () => {
  const q = parseQuery('**FROM** "C" **SEARCH** \'过载\' **AS** 标记 **SELECT** $命中$ **COUNT** 标记 %!=% null **AS** $命中$');
  const bodies = new Map([["C/a.md", "服务过载"], ["C/b.md", "正常"], ["C/c.md", "正常"]]);
  const r = executeQuery(q, ROWS, null, { bodies });
  assert.equal(globalsOf(r, "命中"), 1); // 仅 a 行 body 命中「过载」
});

test("[引用] COUNT 对 [ext] 并入行同样生效", () => {
  const extRows = [makeRow("C/d.txt", "C", { state: "过载" })];
  const r = run("**SELECT** $过载数$ **FROM** \"C\" **WHERE** [txt, md] **COUNT** state %==% '过载' **AS** $过载数$", { extRows });
  assert.equal(globalsOf(r, "过载数"), 3); // md 2 + ext 1
});

test("[边界] 空行集 → 计数 0，不 warning", () => {
  const r = run('**FROM** "空目录" **SELECT** $n$ **COUNT** true %==% true **AS** $n$');
  assert.equal(globalsOf(r, "n"), 0);
  assert.equal(r.debug.warnings.length, 0);
});

test("[调试] count 统计进入调试信息", () => {
  const r = run("**FROM** \"C\" **SELECT** $过载数$ **COUNT** state %==% '过载' **AS** $过载数$");
  assert.ok(r.debug.count.some((m) => m.includes("过载数 = 2")));
});

/* ---------- 书写顺序自由 ---------- */

test("[顺序] COUNT 可写在 WHERE 之前（前件仅 FROM）", () => {
  const r = run("**FROM** \"C\" **COUNT** state %==% '过载' **AS** $过载数$ **WHERE** due %>% '2023-06-01' **SELECT** state, $过载数$");
  assert.equal(globalsOf(r, "过载数"), 1);
});

queue.then(() => {
  if (failures.length > 0) {
    console.error(`\nCOUNT 计数测试：${passed} 通过，${failures.length} 失败`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nCOUNT 计数测试：全部 ${passed} 个通过`);
});
