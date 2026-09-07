/* viewSync 工具函数测试：detectTypeFromSql / normalizeSqlView / applyViewType。
   零 Obsidian 依赖，可直接 node 执行（esbuild 打包）。 */
import assert from "node:assert/strict";
import { makeBoardId } from "../src/types";
import { applyViewType, detectTypeFromSql, normalizeSqlView } from "../src/utils/viewSync";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/* ---------- detectTypeFromSql（R1：返回 ViewType | null）---------- */

test("detectTypeFromSql：开头三种 VIEW 关键词各自识别", () => {
  assert.equal(detectTypeFromSql("**TABLE_VIEW** **SELECT** a **FROM** \"x\""), "TABLE_VIEW");
  assert.equal(detectTypeFromSql("**LIST_VIEW** **SELECT** a **FROM** \"x\""), "LIST_VIEW");
  assert.equal(detectTypeFromSql("**CARD_VIEW** **SELECT** a **FROM** \"x\""), "CARD_VIEW");
});

test("detectTypeFromSql：跳过前导空白", () => {
  assert.equal(detectTypeFromSql("\n  **LIST_VIEW** **SELECT** a **FROM** \"x\""), "LIST_VIEW");
  assert.equal(detectTypeFromSql("\t\t**CARD_VIEW** **SELECT** a **FROM** \"x\""), "CARD_VIEW");
});

test("detectTypeFromSql：跳过 -- 注释行", () => {
  assert.equal(
    detectTypeFromSql("-- 这是注释\n-- 另一行\n**CARD_VIEW** **SELECT** a **FROM** \"x\""),
    "CARD_VIEW",
  );
});

test("detectTypeFromSql：无关键词 / 空 / 纯空白 / 纯注释 → null（R1）", () => {
  assert.equal(detectTypeFromSql(""), null);
  assert.equal(detectTypeFromSql("   \n\t  "), null);
  assert.equal(detectTypeFromSql("-- 纯注释\n-- 仍然纯注释"), null);
  assert.equal(detectTypeFromSql("**SELECT** a **FROM** \"x\""), null);
  assert.equal(detectTypeFromSql("**FROM** \"x\""), null);
});

test("detectTypeFromSql：旧 **TABLE** / **LIST** 视为 null（不做兼容，由 parser 报错）", () => {
  assert.equal(detectTypeFromSql("**TABLE** **SELECT** a **FROM** \"x\""), null);
  assert.equal(detectTypeFromSql("**LIST** **SELECT** a **FROM** \"x\""), null);
});

test("detectTypeFromSql：字符串字面量 '**TABLE_VIEW**' 不被误识别", () => {
  assert.equal(detectTypeFromSql("**SELECT** '**TABLE_VIEW**' **AS** x **FROM** \"y\""), null);
});

/* ---------- normalizeSqlView（纯函数，不改原串）---------- */

test("normalizeSqlView：已有合法 VIEW 关键词 → 替换", () => {
  const out = normalizeSqlView("**TABLE_VIEW** **SELECT** a **FROM** \"x\"", "LIST_VIEW");
  assert.equal(out, "**LIST_VIEW** **SELECT** a **FROM** \"x\"");
  const out2 = normalizeSqlView("**LIST_VIEW** ...", "CARD_VIEW");
  assert.equal(out2, "**CARD_VIEW** ...");
});

test("normalizeSqlView：旧 **TABLE** / **LIST** → 一并替换为新词", () => {
  assert.equal(normalizeSqlView("**TABLE** **SELECT** a **FROM** \"x\"", "TABLE_VIEW"), "**TABLE_VIEW** **SELECT** a **FROM** \"x\"");
  assert.equal(normalizeSqlView("**LIST** **SELECT** a **FROM** \"x\"", "CARD_VIEW"), "**CARD_VIEW** **SELECT** a **FROM** \"x\"");
});

test("normalizeSqlView：无关键词 SQL → 在前导空白/注释后注入", () => {
  assert.equal(normalizeSqlView("**SELECT** a **FROM** \"x\"", "TABLE_VIEW"), "**TABLE_VIEW** **SELECT** a **FROM** \"x\"");
  assert.equal(
    normalizeSqlView("-- 注释\n**SELECT** a **FROM** \"x\"", "LIST_VIEW"),
    "-- 注释\n**LIST_VIEW** **SELECT** a **FROM** \"x\"",
  );
});

test("normalizeSqlView：纯函数——不改原串", () => {
  const original = "**TABLE** **SELECT** a **FROM** \"x\"";
  const before = original;
  normalizeSqlView(original, "LIST_VIEW");
  assert.equal(original, before);
});

test("normalizeSqlView：空 SQL → 注入 \"**TYPE**\\n\"", () => {
  assert.equal(normalizeSqlView("", "TABLE_VIEW"), "**TABLE_VIEW**\n");
  assert.equal(normalizeSqlView("", "CARD_VIEW"), "**CARD_VIEW**\n");
});

test("normalizeSqlView：非字符串输入兜底为空串", () => {
  // @ts-expect-error 测试非字符串入参
  assert.equal(normalizeSqlView(undefined, "TABLE_VIEW"), "**TABLE_VIEW**\n");
  // @ts-expect-error 测试非字符串入参
  assert.equal(normalizeSqlView(null, "LIST_VIEW"), "**LIST_VIEW**\n");
});

/* ---------- applyViewType（就地在 board 上同步）---------- */

test("applyViewType：替换 SQL 关键词 + 设置 board.viewType", () => {
  const board = { id: makeBoardId(), name: "t", type: "", description: "", sql: "**TABLE_VIEW** ...", viewType: "" as const };
  applyViewType(board, "LIST_VIEW");
  assert.equal(board.sql, "**LIST_VIEW** ...");
  assert.equal(board.viewType, "LIST_VIEW");
});

test("applyViewType：旧 **TABLE** 也能被一并替换", () => {
  const board = { id: makeBoardId(), name: "t", type: "", description: "", sql: "**TABLE** **SELECT** a **FROM** \"x\"", viewType: "" as const };
  applyViewType(board, "CARD_VIEW");
  assert.equal(board.sql, "**CARD_VIEW** **SELECT** a **FROM** \"x\"");
  assert.equal(board.viewType, "CARD_VIEW");
});

test("applyViewType：无关键词 SQL → 注入", () => {
  const board = { id: makeBoardId(), name: "t", type: "", description: "", sql: "**SELECT** a **FROM** \"x\"", viewType: "" as const };
  applyViewType(board, "LIST_VIEW");
  assert.equal(board.sql, "**LIST_VIEW** **SELECT** a **FROM** \"x\"");
  assert.equal(board.viewType, "LIST_VIEW");
});

console.log(`\nviewSync 测试：全部 ${passed} 个通过`);
