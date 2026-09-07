/**
 * @module tests/math
 * @description 数学示例套件：算术、比较、连接、内置函数与 TOTAL 聚合
 */

import assert from "node:assert/strict";
import { compareUtf8, evaluateExpr, executeQuery } from "@dsql/executor";
import { EMPTY, type FieldValue } from "@dsql/types";
import { makeRow, exec } from "./helpers";
import { parseQuery } from "@dsql/parser";

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
  // DSQL 1.5：empty() 仅认 empty 值（未赋值）；缺失字段求值 null → false
  assert.equal(evalOn({ 已赋空: EMPTY })(`**empty**(已赋空)`), true);
  assert.equal(evalOne(`**empty**(缺失)`), false);
  assert.equal(evalOn({ s: "", arr: [] as FieldValue[], n: 0, b: false })(`**empty**(s)`), false);
  assert.equal(evalOn({ s: "", arr: [] as FieldValue[] })(`**empty**(arr)`), false);
  assert.equal(evalOn({ n: 0 })(`**empty**(n)`), false);
  assert.equal(evalOn({ b: false })(`**empty**(b)`), false);
  assert.equal(evalOne(`**empty**(null)`), false);
});

/* ---------- 三值语义：0 / null / empty 值分家（DSQL 1.5） ---------- */

test("裸真值判断：0、false、空串、空数组、null、empty 值均为假", () => {
  const data = [makeRow("M/x.md", "M", { n: 0, b: false, s: "", arr: [] as FieldValue[], e: EMPTY })];
  const run = (where: string) =>
    executeQuery(parseQuery(`**SELECT** a **FROM** "M" **WHERE** ${where}`), data, null).rows.length;
  assert.equal(run(`n`), 0);          // 0 → 假（v1.5 由真改假）
  assert.equal(run(`b`), 0);          // false → 假
  assert.equal(run(`s`), 0);          // 空串 → 假
  assert.equal(run(`arr`), 0);        // 空数组 → 假
  assert.equal(run(`e`), 0);          // empty 值 → 假
  assert.equal(run(`缺失`), 0);        // 缺失字段 → null → 假
  assert.equal(run(`**NOT** 缺失`), 1);
  assert.equal(run(`n %==% 0`), 1);   // 0 作为正常值参与比较一切照常
});

test("0 是正常值：运算照常（0 %+% 1 = 1）", () => {
  const evalOne = evalOn({ n: 0 });
  assert.equal(evalOne(`n %+% 1`), 1);
  assert.equal(evalOne(`n %*% 5`), 0);
});

test("empty 值传播：除 empty() 外一切运算按 null 传播", () => {
  const e = evalOn({ e: EMPTY });
  assert.equal(e(`e %+% 1`), null);        // 算术 → null
  assert.equal(e(`e %||% 'x'`), null);     // 连接 → null
  assert.equal(e(`e %==% 1`), false);      // 比较 → false
  assert.equal(e(`e %>=% 1`), false);
  assert.equal(e(`e %==% null`), true);    // 与 null 同口径：== null 同一性
  assert.equal(e(`e %!=% null`), false);   // %!=% 为其取反
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
  assert.ok(r.debug!.warnings.some((w) => /跳过 .* 个非数值/.test(w.message)));
});

/* ---------- 字符串连接 %||% 补充 ---------- */

test("连接的 null 传播：任一侧 null → null", () => {
  const evalOne = evalOn({ 名: "甲" });
  assert.equal(evalOne(`'a' %||% null`), null);
  assert.equal(evalOne(`null %||% 'b'`), null);
  assert.equal(evalOne(`名 %||% null %||% '后缀'`), null); // 链中任意一环 null 整体为 null
});

test("连接的非字符串操作数自动转字符串（数字/布尔）", () => {
  const evalOne = evalOn({ 名: "甲", 分: 95, 过: true });
  assert.equal(evalOne(`1 %||% 2`), "12");
  assert.equal(evalOne(`分 %||% '分'`), "95分");
  assert.equal(evalOne(`过 %||% '-' %||% 名`), "true-甲");
});

test("连接与算术混排：%+% 优先于 %||%", () => {
  const evalOne = evalOn({ 名: "v" });
  assert.equal(evalOne(`1 %+% 1 %||% '分'`), "2分");      // 先算 1+1
  assert.equal(evalOne(`名 %||% 1 %+% 1`), "v2");          // 右侧先算 1+1
  assert.equal(evalOne(`(名 %||% 1) %+% 1`), null);        // 括号改变：'v1' %+% 1 类型不匹配 → null
});

test("连接结果参与函数与比较", () => {
  const evalOne = evalOn({ 名: "AbC" });
  assert.equal(evalOne(`**contains**(**lower**(名 %||% 'd'), 'bcd')`), true);
  assert.equal(evalOne(`名 %||% 'D' %==% 'AbCD'`), true);  // == 按字节精确
});

/* ---------- 复合表达式（多表达式组合） ---------- */

test("算术优先级与括号：乘加、括号改变、左结合、乘方右结合", () => {
  const evalOne = evalOn({ a: 2, b: 3 });
  assert.equal(evalOne(`2 %+% 3 %*% 4`), 14);              // * 先于 +
  assert.equal(evalOne(`(2 %+% 3) %*% 4`), 20);
  assert.equal(evalOne(`10 %-% 2 %-% 3`), 5);              // 减法左结合
  assert.equal(evalOne(`2 %*% b %^% 2`), 18);              // ^ 右结合且高于 *
  assert.equal(evalOne(`(a %+% b) %*% (b %-% a)`), 5);     // 复合括号
});

test("复合逻辑：比较 + AND/OR/NOT + 算术混合（AND 优先于 OR）", () => {
  const evalOne = evalOn({ a: 5, b: 1 });
  assert.equal(evalOne(`a %>% 1 **AND** b %<% 2`), true);
  assert.equal(evalOne(`**NOT** (a %>% 1 **AND** b %>% 2) **OR** a %==% 5`), true); // NOT 组内为假 → OR 右侧真
  assert.equal(evalOne(`a %-% 3 %>% 1 **OR** b %*% 2 %==% 2 **AND** a %<% b`), true); // (a-3>1) 或 ((b*2==2) AND (a<b))=false → true
  assert.equal(evalOne(`a %>% 1 **AND** **NOT** b %>% 0`), false);
});

test("复合表达式：函数嵌套比较与字符串运算组合", () => {
  const evalOne = evalOn({ 名: "AbC", 分: 95 });
  assert.equal(
    evalOne(`**length**(名) %*% 2 %+% 1 %>=% 7 **AND** **upper**(名 %||% 'd') %==% 'ABCD'`), true,
  );
});

test("sqrt(0) 与除零链式求值", () => {
  const evalOne = evalOn({ 分: 95 });
  assert.equal(evalOne(`**sqrt**(分 %-% 95)`), 0);
  assert.equal(evalOne(`分 %/% (分 %-% 95)`), null); // 除零 → null（非致命）
});

console.log(`\n数学示例测试：全部 ${passed} 个通过`);
