/* 摄取层测试：frontmatter 重复键剔除、摄取归一（"" / [] → null，未赋值 → EMPTY 值）、摄取警告输出。 */
import assert from "node:assert/strict";
import { findDuplicateKeys } from "../src/index/frontmatter";
import { buildRow } from "../src/index/row-builder";
import { DataStore, type IngestWarning } from "../src/index/store";
import { executeQuery } from "../src/query/executor";
import { parseQuery } from "../src/query/parser";
import { EMPTY, type DataRow } from "../src/types";
import { makeRow } from "./helpers";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const fakeFile = (path: string): never =>
  ({
    path,
    basename: path.split("/").pop()!.replace(/\.md$/, ""),
    extension: "md",
    parent: { path: path.split("/").slice(0, -1).join("/") || "/" },
    stat: { size: 1, ctime: 1, mtime: 1 },
  }) as never;

/* ---------- 重复键检测（纯函数） ---------- */

test("findDuplicateKeys：同顶层键出现两次 → 剔除并保留原始键值对", () => {
  const findings = findDuplicateKeys("---\nage: 20\nname: 甲\nage: 22\n---\n正文");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].field, "age");
  assert.deepEqual(findings[0].rawLines, ["age: 20", "age: 22"]);
});

test("findDuplicateKeys：缩进嵌套键 / 非顶层行不计入；无 frontmatter → 空数组", () => {
  assert.deepEqual(findDuplicateKeys("---\nmeta:\n  age: 1\n  age: 2\n---\n"), []);
  assert.deepEqual(findDuplicateKeys("正文没有 frontmatter"), []);
  assert.deepEqual(findDuplicateKeys("---\nname: 甲\n---\n"), []);
});

/* ---------- 摄取归一（DSQL 1.5 三值语义入口） ---------- */

test("buildRow 摄取归一：未赋值 → EMPTY 值，\"\" / [] → null", () => {
  const row = buildRow(fakeFile("M/x.md"), { a: null, b: "", c: [], d: "值", e: 1 }, [], []);
  assert.equal(row.fields.a, EMPTY); // 键存在但未赋值（受限近似含 字段: null / ~）
  assert.equal(row.fields.b, null);  // 空容器 → null
  assert.equal(row.fields.c, null);  // 空容器 → null
  assert.equal(row.fields.d, "值");
  assert.equal(row.fields.e, 1);
});

/* ---------- 重复键剔除联动（store + executor 摄取警告） ---------- */

test("重复键文件从结果集剔除，duplicateKey 计入 warnings，查询继续", () => {
  const store = new DataStore();
  const ok: DataRow = makeRow("M/正常.md", "M", { age: 30 });
  store.upsert(ok);
  const warning: IngestWarning = {
    type: "duplicateKey",
    file: "M/重复键.md",
    field: "age",
    message: '文件 "M/重复键.md" frontmatter 存在重复键 "age"，已从结果集中剔除',
    rawLines: ["age: 20", "age: 22"],
  };
  store.remove("M/重复键.md"); // 扫描器检测到重复键后的剔除动作
  store.setIngestWarnings("M/重复键.md", [warning]);

  const r = executeQuery(parseQuery(`**SELECT** age **FROM** "M"`), store.all(), null, {
    debug: true,
    ingestWarnings: store.ingestWarnings(),
  });
  assert.equal(r.rows.length, 1); // 查询继续，仅剩正常文件
  const w = r.debug!.warnings.find((w) => w.type === "duplicateKey");
  assert.ok(w);
  assert.match(w.message, /重复键 "age"/);
});

console.log(`\n摄取层测试：全部 ${passed} 个通过`);
