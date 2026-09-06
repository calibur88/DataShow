/* 数学示例测试：算术运算、乘方、比较、字符串连接、内置函数、非致命语义、UTF-8 字节序。 */
import assert from "node:assert/strict";
import { compareUtf8, evaluateExpr, executeQuery } from "../src/query/executor";
import type { FieldValue } from "../src/types";
import { makeRow, exec } from "./helpers";
import { parseQuery } from "../src/query/parser";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const evalOn = (fields: Record<string, unknown>) => (sql: string): unknown => {
  const data = [makeRow("M/x.md", "M", fields)];
  const r = executeQuery(parseQuery(`**SELECT** ${sql} **AS** v **FROM** "M"`), data, null);
  return evaluateExpr(r.columns[0].expr, r.rows[0], null);
};

/* ---------- 算术 ---------- */

test("投影表达式 + **AS** 别名（四则运算）", () => {
  const evalOne = evalOn({ 价格: 10, 运费: 3, 库存: 5 });
  assert.equal(evalOne(`价格 %+% 运费`), 13);
  assert.equal(evalOne(`库存 %*% 价格`), 50);
});

test("算术：乘方右结合、取模、除零非致命为 null", () => {
  const evalOne = evalOn({ a: 2, b: 3 });
  assert.equal(evalOne(`a %^% b %^% 2`), 512); // 2^(3^2)=2^9，右结合
  assert.equal(evalOne(`(a %+% b) %*% 2`), 10);
  assert.equal(evalOne(`b %%% a`), 1);
  assert.equal(evalOne(`a %/% (b %-% 3)`), null); // 除零 → null
  assert.equal(evalOne(`a %+% '字符串'`), null);  // 类型不匹配 → null
  assert.equal(evalOne(`(%-%2) %^% 0.5`), null);  // 负数开偶次方 → null
  assert.equal(evalOne(`2 %^% 0.5`), Math.SQRT2); // 分数指数
});

test("字符串连接 %||%", () => {
  const r = exec(`**SELECT** owner %||% '：' %||% status **AS** 条目 **FROM** "Notes" **LIMIT** 1`);
  assert.equal(evaluateExpr(r.columns[0].expr, r.rows[0], null), "张三：进行中");
});

/* ---------- 比较 ---------- */

test("比较运算与裸真值判断", () => {
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** priority %>% 2`).rows.length, 1);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** priority %<=% 2`).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** done`).rows.length, 1);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** **NOT** done`).rows.length, 2);
  assert.equal(
    exec(`**SELECT** a **FROM** "Notes" **WHERE** status %==% '已完成' **OR** priority %>=% 3`).rows.length,
    2,
  );
});

test("== 按字节精确（区分大小写）", () => {
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** status %==% '进行中'`).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** **contains**(owner, 'zhang')`).rows.length, 0);
});

/* ---------- 内置函数 ---------- */

test("内置函数 sqrt/cbrt/root/contains/length/lower/upper/empty", () => {
  const evalOne = evalOn({ 值: 16, 标签: ["a", "b"], 名: "ABC" });
  assert.equal(evalOne(`**sqrt**(值)`), 4);
  assert.equal(evalOne(`**cbrt**(27)`), 3);
  assert.equal(evalOne(`**root**(值, 4)`), 2);
  assert.equal(evalOne(`**root**(%-%8, 3)`), -2); // 负号也是 %-% 运算符
  assert.equal(evalOne(`**root**(值, 0)`), null);
  assert.equal(evalOne(`**sqrt**(%-%1)`), null);
  assert.equal(evalOne(`**length**(标签)`), 2);
  assert.equal(evalOne(`**lower**(名)`), "abc");
  assert.equal(evalOne(`**upper**(名)`), "ABC");
  assert.equal(evalOne(`**empty**(缺失)`), true);
});

test("**contains** 区分大小写（数组严格相等、字符串子串）", () => {
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** **contains**(status, '进行中')`).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** **contains**(status, '进行')`).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** **contains**(owner, '张三')`).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** **contains**(owner, 'zhang')`).rows.length, 0);
  // 忽略大小写用 **lower** 组合
  assert.equal(
    exec(`**SELECT** a **FROM** "Notes" **WHERE** **contains**(**lower**(status), '已完成')`).rows.length,
    1,
  );
});

/* ---------- UTF-8 字节序 ---------- */

test("UTF-8 字节序：递归下降与混排确定", () => {
  assert.ok(compareUtf8("你好AAAA", "你好AAAB") < 0);
  assert.ok(compareUtf8("abc", "abcd") < 0);
  assert.ok(compareUtf8("a", "你") < 0);
  assert.ok(compareUtf8("Z", "a") < 0);
});

test("SELECT * 自动列按 UTF-8 字节序排列", () => {
  const data = [makeRow("M/x.md", "M", { 你好: 1, abc: 2, Zed: 3 })];
  const r = executeQuery(parseQuery(`**SELECT** * **FROM** "M"`), data, null);
  assert.deepEqual(r.columns.map((c) => c.alias), ["Zed", "abc", "你好"]); // 0x5A < 0x61 < 0xE4…
});

/* ---------- DSQL 1.4：TOTAL 聚合与派生变量数值语义 ---------- */

const students = [
  makeRow("S/a.md", "S", { 姓名: "甲", 成绩: 100, 及格: true }),
  makeRow("S/b.md", "S", { 姓名: "乙", 成绩: "缺考", 及格: false }),
  makeRow("S/c.md", "S", { 姓名: "丙", 成绩: 200, 及格: true }),
  makeRow("S/d.md", "S", { 姓名: "丁", 及格: false }),
];
const execS = (sql: string) => executeQuery(parseQuery(sql), students, null);

test("**TOTAL** 字段求和：null 跳过、缺失行跳过", () => {
  const r = execS(`**SELECT** **TOTAL** 成绩 **AS** $总成绩$ **FROM** "S"`);
  assert.equal(r.globals?.get("总成绩"), 300);
});

test("**TOTAL** 1 = 总行数（COUNT 等价）；**TOTAL** 0 = 0", () => {
  const r = execS(`**SELECT** **TOTAL** 1 **AS** $总人数$, **TOTAL** 0 **AS** $零$ **FROM** "S"`);
  assert.equal(r.globals?.get("总人数"), 4);
  assert.equal(r.globals?.get("零"), 0);
});

test("**TOTAL** 恒忽略 WHERE（全表口径）", () => {
  const r = execS(`**SELECT** 姓名, **TOTAL** 1 **AS** $总人数$ **FROM** "S" **WHERE** 及格`);
  assert.equal(r.rows.length, 2); // WHERE 只过滤显示行
  assert.equal(r.globals?.get("总人数"), 4); // 聚合仍是全表
});

test("平均派生（总成绩/总人数，投影期链式计算）", () => {
  const r = execS(
    `**SELECT** **TOTAL** 成绩 **AS** $总成绩$, **TOTAL** 1 **AS** $总人数$, ($总成绩$ %/% $总人数$) **AS** $平均分$ **FROM** "S"`,
  );
  assert.equal(r.globals?.get("总成绩"), 300);
  // 派生变量在投影期逐行计算：用行内变量环境求值 $平均分$ 列
  const vars = new Map(r.globals ?? undefined);
  const col = r.columns.find((c) => c.alias === "平均分")!;
  const v = evaluateExpr(col.expr, r.rows[0], null, undefined, undefined, vars);
  assert.equal(v, 75); // 300 / 4（TOTAL 1 计全部命中行）
});

test("链式派生列（从左到右，前变量可供后列引用）", () => {
  const orders = [
    makeRow("O/x.md", "O", { 单价: 10, 数量: 2 }),
    makeRow("O/y.md", "O", { 单价: 5, 数量: 4 }),
  ];
  const r = executeQuery(
    parseQuery(`**SELECT** 单价 %*% 数量 **AS** $小计$, $小计$ %*% 0.8 **AS** $折扣价$, $小计$ %-% $折扣价$ **AS** $优惠$ **FROM** "O"`),
    orders,
    null,
  );
  const vars = new Map<string, FieldValue>();
  const v0 = r.columns.map((c) => {
    const v = evaluateExpr(c.expr, r.rows[0], null, undefined, undefined, vars);
    if (c.alias) vars.set(c.alias, v);
    return v;
  });
  assert.deepEqual(v0, [20, 16, 4]);
});

test("SELECT 仅含 TOTAL 项 → 单行合成结果", () => {
  const r = execS(`**SELECT** **TOTAL** 成绩 **AS** $总成绩$, **TOTAL** 1 **AS** $总人数$ **FROM** "S"`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].file.name, "汇总");
});

test("空表 TOTAL → null（仍输出合成行）", () => {
  const r = executeQuery(
    parseQuery(`**SELECT** **TOTAL** 成绩 **AS** $总成绩$ **FROM** "空目录"`),
    students,
    null,
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.globals?.get("总成绩"), null);
});

test("命名空间隔离：$变量$ 查变量表，裸标识符查行字段", () => {
  const r = execS(`**SELECT** **TOTAL** 成绩 **AS** $总成绩$, 成绩 **FROM** "S" **WHERE** 成绩 %>% 0`);
  const vars = new Map(r.globals ?? undefined);
  const row = r.rows[0]; // 甲：成绩 100
  const total = evaluateExpr({ kind: "variable", name: "总成绩" }, row, null, undefined, undefined, vars);
  const field = evaluateExpr({ kind: "field", path: "成绩" }, row, null);
  assert.equal(total, 300);
  assert.equal(field, 100);
});

test("TOTAL 调试信息：AGG 消息与非数值跳过警告", () => {
  const r = executeQuery(
    parseQuery(`**SELECT** **TOTAL** 成绩 **AS** $总成绩$ **FROM** "S"`),
    students,
    null,
    { debug: true },
  );
  assert.ok(r.debug!.aggregates.some((m) => m.includes("总成绩 = 300")));
  assert.ok(r.debug!.warnings.some((w) => /跳过 .* 个非数值/.test(w)));
});

console.log(`\n数学示例测试：全部 ${passed} 个通过`);
