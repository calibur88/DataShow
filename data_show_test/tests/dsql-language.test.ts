/* DSQL 语言示例测试：词法、语法结构、子句前件关系、错误报告。 */
import assert from "node:assert/strict";
import { executeQuery, evaluateExpr } from "../src/query/executor";
import { parseQuery, QueryParseError } from "../src/query/parser";
import { exec } from "./helpers";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/* ---------- 语法结构 ---------- */

test("v1.3 标准查询：**TABLE** **SELECT** ... **FROM** ... **WHERE** ... **SORT** ... **LIMIT**", () => {
  const r = exec(
    `**TABLE** **SELECT** status **AS** 状态, owner **AS** 负责人 **FROM** "Notes" **WHERE** status %==% '进行中' **SORT** priority **ASC**`,
  );
  assert.equal(r.view, "table");
  assert.deepEqual(r.columns.map((c) => c.alias), ["状态", "负责人"]);
  assert.deepEqual(r.rows.map((r) => r.file.name), ["任务A", "任务C"]);
});

test("视图可省略（默认 TABLE），**LIST** 亦可用", () => {
  assert.equal(exec(`**SELECT** status **FROM** "Notes"`).view, "table");
  assert.equal(exec(`**LIST** **SELECT** status **FROM** "Notes"`).view, "list");
});

test("**SELECT** * 自动列；**WITHOUT** **ID**", () => {
  const r = exec(`**SELECT** * **FROM** "Notes" **LIMIT** 1`);
  assert.ok(r.columns.length >= 3);
  const r2 = exec(`**TABLE** **WITHOUT** **ID** **SELECT** status **FROM** "Notes"`);
  assert.equal(r2.columns.length, 1); // WITHOUT ID 时面板隐藏文件列，列本身仍存在
});

test("无别名投影：字段路径为默认别名，表达式为 列N", () => {
  const r = exec(`**SELECT** status, priority %+% 1 **FROM** "Notes" **LIMIT** 1`);
  assert.deepEqual(r.columns.map((c) => c.alias), ["status", "列2"]);
});

/* ---------- 子句前件关系（书写顺序自由） ---------- */

test("**SELECT** 可省略（默认 *），**LIST** **FROM** ... **WHERE** ... 直接可用", () => {
  const r = parseQuery(`**LIST** **FROM** "Notes" **WHERE** **contains**(file.outlinks, "Notes/任务A.md")`);
  assert.equal(r.view, "list");
  assert.equal(r.select, "*");
  assert.ok(r.where);
  const r2 = parseQuery(`**FROM** "Notes"`);
  assert.equal(r2.select, "*");
  assert.equal(r2.from.kind, "folder");
});

test("子句按前件关系任意书写顺序（WHERE/SORT/LIMIT 只要求 **FROM** 在前）", () => {
  // SORT 在 WHERE 前：两者都只要求 FROM
  const r = exec(`**SELECT** a **FROM** "Notes" **SORT** priority **DESC** **WHERE** done`);
  assert.deepEqual(r.rows.map((r) => r.file.name), ["任务B"]);
  // LIMIT 在 SORT 前
  const r2 = exec(`**FROM** "Notes" **LIMIT** 1 **SORT** priority **ASC**`);
  assert.equal(r2.rows.length, 1);
  assert.equal(r2.rows[0].file.name, "任务B");
});

test("前件缺失报错：WHERE/SORT/LIMIT 缺 **FROM**；缺少 **FROM** 子句", () => {
  assert.throws(() => parseQuery(`**SELECT** a **WHERE** b %==% 1 **FROM** "x"`), (e: unknown) =>
    e instanceof QueryParseError && /\*\*WHERE\*\* 需要 \*\*FROM\*\* 作为前件/.test((e as Error).message));
  assert.throws(() => parseQuery(`**SELECT** a **SORT** b **FROM** "x"`), /\*\*SORT\*\* 需要 \*\*FROM\*\* 作为前件/);
  assert.throws(() => parseQuery(`**SELECT** a **LIMIT** 1 **FROM** "x"`), /\*\*LIMIT\*\* 需要 \*\*FROM\*\* 作为前件/);
  assert.throws(() => parseQuery(`**SELECT** a **WHERE** b`), /\*\*WHERE\*\* 需要 \*\*FROM\*\* 作为前件/);
  assert.throws(() => parseQuery(`**SELECT** a`), /缺少 \*\*FROM\*\* 子句/);
});

test("子句重复报错（每条至多一次，含 WITHOUT ID）", () => {
  assert.throws(() => parseQuery(`**SELECT** a **FROM** "x" **FROM** "y"`), /\*\*FROM\*\* 子句重复出现/);
  assert.throws(() => parseQuery(`**FROM** "x" **WHERE** a **WHERE** b`), /\*\*WHERE\*\* 子句重复出现/);
  assert.throws(() => parseQuery(`**FROM** "x" **LIMIT** 1 **LIMIT** 2`), /\*\*LIMIT\*\* 子句重复出现/);
  assert.throws(() => parseQuery(`**FROM** "x" **WITHOUT** **ID** **WITHOUT** **ID**`), /重复出现/);
  assert.throws(() => parseQuery(`**FROM** "x" **WHERE** a **ASC**`), /多余的查询子句/);
});

test("**WITHOUT** **ID** 可在任意子句位置", () => {
  const r = exec(`**FROM** "Notes" **WITHOUT** **ID** **LIMIT** 1`);
  assert.equal(r.rows.length, 1);
});

test("错误带行列号；未知 **关键词** 报错；旧写法不再兼容", () => {
  assert.throws(
    () => parseQuery(`**SELECT** a\n**FROM** "x"\n**LIMIT** abc`),
    (e: unknown) => e instanceof QueryParseError && /第 3 行/.test((e as Error).message),
  );
  assert.throws(() => parseQuery(`**FOO**`), /未知关键词/);
  assert.throws(() => parseQuery(`TABLE SELECT a FROM "x"`), /缺少 \*\*FROM\*\* 子句/); // 旧写法不再兼容
});

test("**SORT** **BY** 语法错误", () => {
  assert.throws(() => parseQuery(`**SELECT** a **FROM** "x" **SORT** s **BY** 'a'`), /预期 \(/);
  assert.throws(() => parseQuery(`**SELECT** a **FROM** "x" **SORT** s **BY** ('a', b)`), /\*\*BY\*\* 列表中应为字面量/);
});

/* ---------- 执行层基本联动 ---------- */

test("parse → execute 全链路（表达式求值与列别名一致）", () => {
  const r = exec(`**SELECT** priority %+% 1 **AS** 加一 **FROM** "Notes" **WHERE** priority %==% 2 **LIMIT** 1`);
  assert.equal(r.rows.length, 1);
  assert.equal(evaluateExpr(r.columns[0].expr, r.rows[0], null), 3);
});

console.log(`\nDSQL 语言示例测试：全部 ${passed} 个通过`);
