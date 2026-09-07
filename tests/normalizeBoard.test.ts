/* normalizeBoard 字段校形测试：viewType 优先级、viewOverride 兼容、type 自由保留。 */
import assert from "node:assert/strict";
import { isViewType, normalizeBoard } from "@dsql/types";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/* ---------- isViewType 守卫 ---------- */

test("isViewType：三个合法值返回 true", () => {
  assert.ok(isViewType("TABLE_VIEW"));
  assert.ok(isViewType("LIST_VIEW"));
  assert.ok(isViewType("CARD_VIEW"));
});

test("isViewType：旧 'table' / 'list' / 其他非枚举值返回 false", () => {
  assert.equal(isViewType("table"), false);
  assert.equal(isViewType("list"), false);
  assert.equal(isViewType("card"), false);
  assert.equal(isViewType(""), false);
  assert.equal(isViewType(null), false);
  assert.equal(isViewType(undefined), false);
  assert.equal(isViewType(123), false);
  assert.equal(isViewType({}), false);
});

/* ---------- normalizeBoard：viewType 字段校形 ---------- */

test("normalizeBoard：viewType 合法值原样保留", () => {
  for (const v of ["TABLE_VIEW", "LIST_VIEW", "CARD_VIEW"] as const) {
    const b = normalizeBoard({ id: "a", name: "n", type: "t", description: "d", sql: "s", viewType: v });
    assert.equal(b.viewType, v);
  }
});

test("normalizeBoard：viewType 为空串 → 保持空", () => {
  const b = normalizeBoard({ viewType: "" });
  assert.equal(b.viewType, "");
});

test("normalizeBoard：viewType 缺失 / 非字符串 → 保持空（R2 优先级：viewType 主）", () => {
  assert.equal(normalizeBoard({}).viewType, "");
  assert.equal(normalizeBoard({ viewType: null }).viewType, "");
  assert.equal(normalizeBoard({ viewType: 123 }).viewType, "");
  assert.equal(normalizeBoard({ viewType: "table" }).viewType, ""); // 旧字面量非新枚举
  assert.equal(normalizeBoard({ viewType: "card" }).viewType, "");
});

/* ---------- normalizeBoard：viewOverride 字段迁移兼容（R2 fallback）---------- */

test("normalizeBoard：viewOverride 合法值（仅当 viewType 空时）作为 fallback", () => {
  // viewType 不存在 → 读 viewOverride
  const b1 = normalizeBoard({ viewOverride: "LIST_VIEW" });
  assert.equal(b1.viewType, "LIST_VIEW");
  // viewType 存在但不合法 → fallback viewOverride
  const b2 = normalizeBoard({ viewType: "table", viewOverride: "CARD_VIEW" });
  assert.equal(b2.viewType, "CARD_VIEW");
  // viewType 合法 → 优先 viewOverride，viewOverride 被忽略
  const b3 = normalizeBoard({ viewType: "TABLE_VIEW", viewOverride: "LIST_VIEW" });
  assert.equal(b3.viewType, "TABLE_VIEW");
});

test("normalizeBoard：viewOverride 非法值 → 不采用", () => {
  assert.equal(normalizeBoard({ viewOverride: "table" }).viewType, "");
  assert.equal(normalizeBoard({ viewOverride: "" }).viewType, "");
  assert.equal(normalizeBoard({ viewOverride: 123 }).viewType, "");
});

/* ---------- normalizeBoard：type 字段（自由分类）不校验 ---------- */

test("normalizeBoard：type 自由保留（中文/枚举外字符串均原样）", () => {
  assert.equal(normalizeBoard({ type: "功能示例" }).type, "功能示例");
  assert.equal(normalizeBoard({ type: "CARD_VIEW" }).type, "CARD_VIEW"); // 即便等于视图枚举，也不替换
  assert.equal(normalizeBoard({ type: "" }).type, "");
  assert.equal(normalizeBoard({}).type, "");
  assert.equal(normalizeBoard({ type: null }).type, "");
  assert.equal(normalizeBoard({ type: 123 }).type, "");
});

/* ---------- normalizeBoard：其他字段兜底 ---------- */

test("normalizeBoard：name / id / description / sql 缺失/非字符串兜底", () => {
  const b = normalizeBoard({});
  assert.equal(b.id, b.id); // 兜底为 makeBoardId 生成的新 uuid，类型 string
  assert.equal(b.name, "未命名看板");
  assert.equal(b.description, "");
  assert.equal(b.sql, "");
  // 类型断言：id 是 string
  assert.equal(typeof b.id, "string");
});

test("normalizeBoard：合法字段原样保留", () => {
  const b = normalizeBoard({
    id: "fixed-id",
    name: "name",
    type: "自由分类",
    description: "desc",
    sql: "**SELECT** a **FROM** \"x\"",
    viewType: "LIST_VIEW",
  });
  assert.equal(b.id, "fixed-id");
  assert.equal(b.name, "name");
  assert.equal(b.type, "自由分类");
  assert.equal(b.description, "desc");
  assert.equal(b.sql, "**SELECT** a **FROM** \"x\"");
  assert.equal(b.viewType, "LIST_VIEW");
});

console.log(`\nnormalizeBoard 测试：全部 ${passed} 个通过`);
