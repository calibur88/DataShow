/* DSQL 语言示例测试：词法、语法结构、子句前件关系、错误报告。 */
import assert from "node:assert/strict";
import { executeQuery, evaluateExpr } from "@dsql/executor";
import { parseQuery, QueryParseError } from "@dsql/parser";
import type { ColumnSel } from "@dsql/ast";
import { exec } from "./helpers";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/* ---------- 语法结构 ---------- */

test("v2.0 标准查询：**TABLE_VIEW** **SELECT** ... **FROM** ... **WHERE** ... **SORT** ... **LIMIT**", () => {
  const r = exec(
    `**TABLE_VIEW** **SELECT** status **AS** 状态, owner **AS** 负责人 **FROM** "Notes" **WHERE** status %==% '进行中' **SORT** priority **ASC**`,
  );
  assert.equal(r.view, "TABLE_VIEW");
  assert.deepEqual(r.columns.map((c) => c.alias), ["状态", "负责人"]);
  assert.deepEqual(r.rows.map((r) => r.file.name), ["任务A", "任务C"]);
});

test("视图可省略（默认 TABLE_VIEW），**LIST_VIEW** / **CARD_VIEW** 亦可用", () => {
  assert.equal(exec(`**SELECT** status **FROM** "Notes"`).view, "TABLE_VIEW");
  assert.equal(exec(`**LIST_VIEW** **SELECT** status **FROM** "Notes"`).view, "LIST_VIEW");
  assert.equal(exec(`**CARD_VIEW** **SELECT** status **FROM** "Notes"`).view, "CARD_VIEW");
});

test("**SELECT** * 自动列；**WITHOUT** **ID**", () => {
  const r = exec(`**SELECT** * **FROM** "Notes" **LIMIT** 1`);
  assert.ok(r.columns.length >= 3);
  const r2 = exec(`**TABLE_VIEW** **WITHOUT** **ID** **SELECT** status **FROM** "Notes"`);
  assert.equal(r2.columns.length, 1); // WITHOUT ID 时面板隐藏文件列，列本身仍存在
});

test("无别名投影：字段路径为默认别名，表达式为 列N", () => {
  const r = exec(`**SELECT** status, priority %+% 1 **FROM** "Notes" **LIMIT** 1`);
  assert.deepEqual(r.columns.map((c) => c.alias), ["status", "列2"]);
});

/* ---------- 子句前件关系（书写顺序自由） ---------- */

test("**SELECT** 可省略（默认 *），**LIST_VIEW** **FROM** ... **WHERE** ... 直接可用", () => {
  const r = parseQuery(`**LIST_VIEW** **FROM** "Notes" **WHERE** **contains**(file.outlinks, "Notes/任务A.md")`);
  assert.equal(r.view, "LIST_VIEW");
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

test("错误带行列号；未知 **关键词** 报错；v2.0 旧视图词直接报错", () => {
  assert.throws(
    () => parseQuery(`**SELECT** a\n**FROM** "x"\n**LIMIT** abc`),
    (e: unknown) => e instanceof QueryParseError && /第 3 行/.test((e as Error).message),
  );
  assert.throws(() => parseQuery(`**FOO**`), /未知关键词/);
  // v2.0：**TABLE** / **LIST** 不再是关键词，直接报「未知关键词」
  assert.throws(() => parseQuery(`**TABLE** **SELECT** a **FROM** "x"`), /未知关键词/);
  assert.throws(() => parseQuery(`**LIST** **SELECT** a **FROM** "x"`), /未知关键词/);
});

/* ---------- v2.0 字符串字面量边界：'**TABLE**' 等不应被误判为视图关键词（R4） ---------- */

test("字符串字面量中的 '**TABLE**' / '**LIST**' / '**CARD_VIEW**' 不参与视图识别", () => {
  // 这些 SQL 应正常解析，r.view 应为缺省 TABLE_VIEW
  for (const lit of ["**TABLE**", "**LIST**", "**CARD_VIEW**", "**TABLE_VIEW**", "**LIST_VIEW**"]) {
    const r = parseQuery(`**SELECT** '${lit}' **AS** 保留字测试 **FROM** "x"`);
    assert.equal(r.view, "TABLE_VIEW", `字符串字面量 '${lit}' 不应改变 view`);
  }
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

/* ---------- DSQL 1.4：TOTAL 聚合与 $变量$ 校验 ---------- */

test("**TOTAL** 必须带 **AS** 别名", () => {
  assert.throws(() => parseQuery(`**SELECT** **TOTAL** 成绩 **FROM** "M"`), /TOTAL 必须带 AS 别名|必须带 \*\*AS\*\* 别名/);
});

test("**TOTAL** 操作数内引用变量 → 致命报错", () => {
  assert.throws(
    () => parseQuery(`**SELECT** **TOTAL** $总薪资$ **AS** $x$ **FROM** "M"`),
    /不支持引用变量/,
  );
});

test("WHERE 中引用 $变量$ → 致命报错（变量仅 SELECT 可用）", () => {
  assert.throws(
    () => parseQuery(`**SELECT** 成绩 **FROM** "M" **WHERE** $总成绩$ %>% 0`),
    /仅可在 \*\*SELECT\*\* 中引用/,
  );
});

test("引用未定义变量（含反向引用）→ 致命报错", () => {
  assert.throws(() => parseQuery(`**SELECT** $平均分$ **AS** $x$ **FROM** "M"`), /变量 \$平均分\$ 未定义/);
  assert.throws(
    () => parseQuery(`**SELECT** 成绩 %-% $平均分$ **AS** $偏差$, ($总成绩$ %/% 2) **AS** $平均分$ **FROM** "M"`),
    /变量 \$平均分\$ 未定义/,
  );
});

test("两个 AS 别名同名 → 致命报错（DSQL 1.5 别名唯一性）", () => {
  assert.throws(
    () => parseQuery(`**SELECT** 成绩 %+% 1 **AS** $x$, 成绩 %+% 2 **AS** $x$ **FROM** "M"`),
    /重复定义/,
  );
  assert.throws(
    () => parseQuery(`**SELECT** a **AS** v, b **AS** v **FROM** "M"`),
    /重复定义/,
  );
});

test("非 TOTAL 场景别名与行字段冲突 → 致命报错（DSQL 1.5：聚合遍开始前校验）", () => {
  assert.throws(
    () => exec(`**SELECT** priority %+% 1 **AS** status **FROM** "Notes"`),
    /与现有字段名冲突/,
  );
});

test("NUMBER 词法：1. 与 .5 均为词法错误（小数点后必须至少一位数字）", () => {
  assert.throws(() => parseQuery(`**SELECT** 1. **AS** v **FROM** "M"`), /非法数字/);
  assert.throws(() => parseQuery(`**SELECT** .5 **AS** v **FROM** "M"`), /小数点开头/);
  assert.throws(() => parseQuery(`**FROM** "M" **LIMIT** 1.`), /非法数字/);
});

test("别名与行字段名冲突 → 致命报错（执行期校验）", () => {
  // 共享数据集行字段含 status：别名 status 与之冲突
  assert.throws(
    () => exec(`**SELECT** **TOTAL** 1 **AS** $status$ **FROM** "Notes"`),
    /与现有字段名冲突/,
  );
});

test("AS 别名接受 $var$ 与裸名两种写法（归一化）", () => {
  const a = parseQuery(`**SELECT** **TOTAL** 1 **AS** $总人数$ **FROM** "M"`);
  const b = parseQuery(`**SELECT** **TOTAL** 1 **AS** 总人数 **FROM** "M"`);
  assert.deepEqual((a.select as ColumnSel[])[0].alias, "总人数");
  assert.deepEqual((b.select as ColumnSel[])[0].alias, "总人数");
});

console.log(`\nDSQL 语言示例测试：全部 ${passed} 个通过`);
