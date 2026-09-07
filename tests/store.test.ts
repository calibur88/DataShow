/* DataStore 冒烟测试（纯 TS，无 Obsidian 依赖）。 */
import assert from "node:assert/strict";
import { DataStore } from "@index/store";
import type { DataRow } from "@dsql/types";

function row(path: string): DataRow {
  return {
    path,
    file: {
      path,
      name: path,
      folder: "",
      ext: "md",
      size: 1,
      ctime: 0,
      mtime: 0,
      outlinks: [],
      inlinks: [],
    },
    fields: {},
  };
}

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test("upsert / all 按路径排序", () => {
  const store = new DataStore();
  store.upsert(row("b.md"));
  store.upsert(row("a.md"));
  assert.deepEqual(store.all().map((r) => r.path), ["a.md", "b.md"]);
});

test("remove / count / version", () => {
  const store = new DataStore();
  const v0 = store.version();
  store.upsert(row("a.md"));
  assert.ok(store.version() > v0);
  store.remove("a.md");
  store.remove("不存在.md");
  assert.equal(store.count(), 0);
});

test("subscribe 通知与退订", () => {
  const store = new DataStore();
  let hits = 0;
  const unsub = store.subscribe(() => hits++);
  store.upsert(row("a.md"));
  store.upsert(row("b.md"));
  assert.equal(hits, 2);
  unsub();
  store.upsert(row("c.md"));
  assert.equal(hits, 2);
});

test("upsertMany 批量只触发一次通知", () => {
  const store = new DataStore();
  let hits = 0;
  store.subscribe(() => hits++);
  store.upsertMany([row("a.md"), row("b.md"), row("c.md")]);
  assert.equal(hits, 1);
  assert.equal(store.count(), 3);
});

console.log(`\nstore 测试：全部 ${passed} 个通过`);
