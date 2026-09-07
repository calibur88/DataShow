/* 测试共享工具：行构造 + 基础数据集（node 环境，无 Obsidian 依赖）。 */
import path from "node:path";
import { executeQuery } from "../src/query/executor";
import { parseQuery } from "../src/query/parser";
import type { DataRow } from "../src/types";

/** 测试库根目录：固定指向本地测试库 test-vault-local（干净提交库 test-vault 不参与测试）。 */
export const TEST_VAULT_ROOT: string = path.resolve(process.cwd(), "test-vault-local");

export function makeRow(path: string, folder: string, fields: DataRow["fields"], inlinks: string[] = []): DataRow {
  const name = path.split("/").pop()!.replace(/\.md$/, "");
  return {
    path,
    file: { path, name, folder, ext: "md", size: 100, ctime: 1, mtime: 1, outlinks: [], inlinks },
    fields,
  };
}

export const rows: DataRow[] = [
  makeRow("Notes/任务A.md", "Notes", { status: "进行中", owner: "张三", priority: 2, tags: ["task"], done: false }),
  makeRow("Notes/任务B.md", "Notes", { status: "已完成", owner: "李四", priority: 1, tags: ["task"], done: true }),
  makeRow("Notes/子/任务C.md", "Notes/子", { status: "进行中", owner: "张三", priority: 3, tags: ["task", "urgent"], done: false }),
  makeRow("Inbox/想法.md", "Inbox", { done: false, tags: ["idea"] }),
];

export function exec(sql: string, ctx: DataRow | null = null) {
  return executeQuery(parseQuery(sql), rows, ctx);
}
