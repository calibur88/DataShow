/**
 * @module tests/helpers
 * @description 测试共享工具：行构造、基础数据集与查询执行捷径
 */

import path from "node:path";
import { executeQuery } from "@dsql/executor";
import { parseQuery } from "@dsql/parser";
import type { DataRow } from "@dsql/types";

/** 测试库根目录：固定指向本地测试库 test-vault-local（干净提交库 test-vault 不参与测试）。 */
export const TEST_VAULT_ROOT: string = path.resolve(process.cwd(), "test-vault-local");

/**
 * 构造测试行。
 *
 * @param path - 笔记路径（主键；文件名取末段去扩展名）
 * @param folder - 所属文件夹
 * @param fields - frontmatter 字段
 * @param inlinks - 入链来源路径（缺省空）
 * @returns 测试行
 */
export function makeRow(path: string, folder: string, fields: DataRow["fields"], inlinks: string[] = []): DataRow {
  const name = path.split("/").pop()!.replace(/\.md$/, "");
  return {
    path,
    file: { path, name, folder, ext: "md", size: 100, ctime: 1, mtime: 1, outlinks: [], inlinks },
    fields,
  };
}

/** 基础数据集（4 行：任务A/B/C + 想法）。 */
export const rows: DataRow[] = [
  makeRow("Notes/任务A.md", "Notes", { status: "进行中", owner: "张三", priority: 2, tags: ["task"], done: false }),
  makeRow("Notes/任务B.md", "Notes", { status: "已完成", owner: "李四", priority: 1, tags: ["task"], done: true }),
  makeRow("Notes/子/任务C.md", "Notes/子", { status: "进行中", owner: "张三", priority: 3, tags: ["task", "urgent"], done: false }),
  makeRow("Inbox/想法.md", "Inbox", { done: false, tags: ["idea"] }),
];

/**
 * 对基础数据集执行 SQL 的捷径。
 *
 * @param sql - DSQL 语句
 * @param ctx - 可选 this 上下文行
 * @returns 查询结果集
 */
export function exec(sql: string, ctx: DataRow | null = null) {
  return executeQuery(parseQuery(sql), rows, ctx);
}
