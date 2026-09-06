/* 数学示例测试：算术运算、乘方、比较、字符串连接、内置函数、非致命语义、UTF-8 字节序。 */
import assert from "node:assert/strict";
import { compareUtf8, evaluateExpr, executeQuery } from "../src/query/executor";
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

console.log(`\n数学示例测试：全部 ${passed} 个通过`);
