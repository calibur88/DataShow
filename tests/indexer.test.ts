/**
 * @module tests/indexer
 * @description 索引器套件（DSQL 2.3.1 审查修复回归）：全量重建预检重复键、
 * 文件删除清除摄取警告、resolved 不双跑。零 Obsidian 依赖（window 以 Node 计时器垫片）。
 */

import assert from "node:assert/strict";
import type { IFileMeta, IUiHost, IVaultHost, VaultEventHandlers } from "@host/types";
import { DataStore } from "@index/store";
import { VaultIndexer } from "@controller/indexer";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>): void {
  const result = fn();
  if (result instanceof Promise) {
    queue = queue.then(async () => {
      await result;
      passed++;
      console.log(`  ✓ ${name}`);
    });
  } else {
    passed++;
    console.log(`  ✓ ${name}`);
  }
}
let queue: Promise<void> = Promise.resolve();

// indexer 用 window.setTimeout 做去抖；Node 下以全局计时器垫片
(globalThis as { window?: object }).window ??= {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};

/* ---------- mock 宿主 ---------- */

const file = (path: string): IFileMeta => ({
  path,
  basename: path.split("/").pop()!.replace(/\.md$/, ""),
  folder: path.split("/").slice(0, -1).join("/"),
  ext: "md",
  size: 1,
  ctime: 1,
  mtime: 1,
});

interface MockFile {
  meta: IFileMeta;
  frontmatter: Record<string, unknown>;
  text: string;
  exists: boolean;
}

/** 构造受控 vault：subscribe 暴露 handlers 供用例直接派发事件。 */
function makeVault(files: Record<string, MockFile>): { vault: IVaultHost; fire: (h: VaultEventHandlers) => void } {
  let handlers: VaultEventHandlers = {};
  return {
    vault: {
      listMarkdownFiles: async () => Object.values(files).filter((f) => f.exists).map((f) => f.meta),
      readFrontmatter: async (p) => files[p]?.frontmatter ?? null,
      getOutlinks: async () => [],
      getInlinks: async () => [],
      readText: async (p) => (files[p]?.exists ? files[p].text : null),
      subscribe: (h) => {
        handlers = h;
        return () => {};
      },
    },
    fire: (h) => handlers = { ...handlers, ...h },
  };
}

const ui: IUiHost = { notify() {}, warn() {}, error() {} };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const DUP_TEXT = "---\nage: 20\nage: 22\n---\n";

/* ---------- 全量重建：重复键文件预检剔除（5.7） ---------- */

test("fullRebuild：重复键文件命中即跳过 upsert（无先入后删窗口）", async () => {
  const { vault } = makeVault({
    "M/正常.md": { meta: file("M/正常.md"), frontmatter: { age: 30 }, text: "---\nage: 30\n---\n", exists: true },
    "M/重复.md": { meta: file("M/重复.md"), frontmatter: { age: 22 }, text: DUP_TEXT, exists: true },
  });
  const store = new DataStore();
  const indexer = new VaultIndexer(vault, store, ui);
  indexer.start();
  await sleep(20);
  indexer.dispose();

  assert.deepEqual(store.all().map((r) => r.file.name), ["正常"]); // 重复键文件从未入仓库
  const warns = store.ingestWarnings();
  assert.equal(warns.length, 1);
  assert.equal(warns[0].type, "duplicateKey");
  assert.equal(warns[0].file, "M/重复.md");
});

/* ---------- 文件删除：行与摄取警告同步清除（4.6） ---------- */

test("onDeleted：行移除且 duplicateKey 摄取警告同步清除", async () => {
  let handlers: VaultEventHandlers = {};
  const files: Record<string, MockFile> = {
    "M/重复.md": { meta: file("M/重复.md"), frontmatter: { age: 22 }, text: DUP_TEXT, exists: true },
  };
  const vault: IVaultHost = {
    listMarkdownFiles: async () => Object.values(files).filter((f) => f.exists).map((f) => f.meta),
    readFrontmatter: async (p) => files[p]?.frontmatter ?? null,
    getOutlinks: async () => [],
    getInlinks: async () => [],
    readText: async (p) => (files[p]?.exists ? files[p].text : null),
    subscribe: (h) => { handlers = h; return () => {}; },
  };
  const store = new DataStore();
  const indexer = new VaultIndexer(vault, store, ui);
  indexer.start();
  await sleep(20);
  assert.equal(store.ingestWarnings().length, 1); // 剔除 + 警告就位

  files["M/重复.md"].exists = false;
  handlers.onDeleted?.("M/重复.md");
  await sleep(20);
  indexer.dispose();

  assert.equal(store.ingestWarnings().length, 0); // 幽灵警告已清除
  assert.equal(store.count(), 0);
});

/* ---------- resolved 不双跑（4.7，含同步到达竞态） ---------- */

test("onResolved：start() 已重建时不双跑（resolved 同步到达也只跑一次）", async () => {
  let handlers: VaultEventHandlers = {};
  let rebuilds = 0;
  const vault: IVaultHost = {
    listMarkdownFiles: async () => {
      rebuilds++;
      return [file("M/a.md")];
    },
    readFrontmatter: async () => ({ a: 1 }),
    getOutlinks: async () => [],
    getInlinks: async () => [],
    readText: async () => "---\na: 1\n---\n",
    subscribe: (h) => { handlers = h; return () => {}; },
  };
  const store = new DataStore();
  const indexer = new VaultIndexer(vault, store, ui);
  indexer.start();
  handlers.onResolved?.(); // 竞态模拟：首个 rebuild 仍在途时 resolved 到达
  await sleep(20);
  indexer.dispose();

  assert.equal(rebuilds, 1); // listMarkdownFiles 仅被首扫调用一次
  assert.equal(store.count(), 1);
});

test("onRename：旧路径的摄取警告一并清除（4.6 同口径）", async () => {
  let handlers: VaultEventHandlers = {};
  const files: Record<string, MockFile> = {
    "M/旧.md": { meta: file("M/旧.md"), frontmatter: {}, text: DUP_TEXT, exists: false },
    "M/新.md": { meta: file("M/新.md"), frontmatter: { a: 1 }, text: "---\na: 1\n---\n", exists: true },
  };
  const vault: IVaultHost = {
    listMarkdownFiles: async () => Object.values(files).filter((f) => f.exists).map((f) => f.meta),
    readFrontmatter: async (p) => files[p]?.frontmatter ?? null,
    getOutlinks: async () => [],
    getInlinks: async () => [],
    readText: async (p) => (files[p]?.exists ? files[p].text : null),
    subscribe: (h) => { handlers = h; return () => {}; },
  };
  const store = new DataStore();
  const indexer = new VaultIndexer(vault, store, ui);
  // 预置旧路径警告（上一轮扫描遗留）
  store.setIngestWarnings("M/旧.md", [{ type: "duplicateKey", file: "M/旧.md", message: "x" }]);
  indexer.start();
  await sleep(20);
  handlers.onRenamed?.("M/旧.md", "M/新.md");
  await sleep(60); // 越过 300ms 去抖窗口
  indexer.dispose();

  assert.equal(store.ingestWarnings().some((w) => w.file === "M/旧.md"), false); // 旧警告清除
  assert.equal(store.row("M/新.md")?.file.name, "新"); // 新路径已入仓库
});

queue.then(() => {
  console.log(`\n索引器测试：全部 ${passed} 个通过`);
});
