/**
 * @module dsql/source
 * @description FROM 数据源判定与 [ext] 读取范围收集（无状态纯函数，供执行器 / 域扩展 / 索引层共用）
 */

import type { Expr, Source } from "./ast";
import type { DataRow } from "./types";

/**
 * [ext] 读取范围哨兵：WHERE 中至少出现一个 `[]` → 读 FROM 目录下全部文件。
 * 三态严格区分：null（没写 [ext]，零触发）≠ EXT_ALL（[]，全量）≠ Set（指定后缀并集）。
 */
export const EXT_ALL = Symbol("DSQL:extAll");

export type ExtFilterState = null | typeof EXT_ALL | Set<string>;

/**
 * 遍历 WHERE AST 收集所有 ExtFilterNode 的读取范围（规范 §6.9）：
 * - 没写任何 [ext] → null（不触发文件级分派，只用行仓库 md 行）；
 * - 至少一个 []   → EXT_ALL（读 FROM 目录下全部文件；与 [txt] 同现时归 ALL）；
 * - 其余          → Set（所有 [ext] 内容的并集，仅用于读取范围；
 *                    行级求值仍用各节点自己的 exts，见 evaluateExpr）。
 *
 * @param where - WHERE 表达式（无则 null）
 * @returns 三态读取范围
 */
export function collectExtFilters(where: Expr | null): ExtFilterState {
  if (!where) return null;
  let state: ExtFilterState = null;
  const visit = (expr: Expr): void => {
    switch (expr.kind) {
      case "extFilter":
        if (expr.exts.length === 0) {
          state = EXT_ALL;
          return;
        }
        if (state === EXT_ALL) return; // ALL 优先级最高，不降级为并集
        if (!(state instanceof Set)) state = new Set<string>();
        for (const ext of expr.exts) (state as Set<string>).add(ext);
        return;
      case "binary":
        visit(expr.left);
        visit(expr.right);
        return;
      case "unary":
        visit(expr.expr);
        return;
      case "call":
        for (const arg of expr.args) visit(arg);
        return;
      default:
        return;
    }
  };
  visit(where);
  return state;
}

/**
 * 收集 FROM 中全部叶子目录路径（含子目录语义由 listFiles 实现侧保证）；
 * 标签叶子不参与（标签源不触发文件级非 md 读取）。无任何目录叶子时返回空数组。
 * AND / OR 的目录组合语义不在本函数展开——文件级过滤统一用 matchFolder。
 *
 * @param source - FROM 数据源
 * @returns 叶子目录路径数组
 */
export function collectSourceFolders(source: Source): string[] {
  switch (source.kind) {
    case "folder":
      return [source.path];
    case "tag":
      return [];
    case "op":
      return [...collectSourceFolders(source.left), ...collectSourceFolders(source.right)];
  }
}

/**
 * FROM 目录语义在文件级（folder）的判定：与 matchSource 的 folder 分支一致；标签叶子视为无约束。
 *
 * @param source - FROM 数据源
 * @param folder - 文件所属目录
 * @returns 是否落在读取范围内
 */
export function matchFolder(source: Source, folder: string): boolean {
  switch (source.kind) {
    case "folder": {
      const p = source.path.toLowerCase();
      const f = folder.toLowerCase();
      return f === p || f.startsWith(`${p}/`) || p === "";
    }
    case "tag":
      return true;
    case "op":
      return source.op === "and"
        ? matchFolder(source.left, folder) && matchFolder(source.right, folder)
        : matchFolder(source.left, folder) || matchFolder(source.right, folder);
  }
}

/**
 * FROM 匹配判定（导出供调用方在 SEARCH body 预读时圈定 FROM 命中范围）。
 *
 * @param source - FROM 数据源
 * @param row - 候选行
 * @returns 是否命中数据源
 */
export function matchSource(source: Source, row: DataRow): boolean {
  switch (source.kind) {
    case "folder": {
      const p = source.path.toLowerCase();
      const f = row.file.folder.toLowerCase();
      return f === p || f.startsWith(`${p}/`) || p === "";
    }
    case "tag": {
      const tags = row.fields.tags;
      if (!Array.isArray(tags)) return false;
      const want = source.tag.replace(/^#/, "").toLowerCase();
      return tags.some((t) => String(t).replace(/^#/, "").toLowerCase() === want);
    }
    case "op":
      return source.op === "and"
        ? matchSource(source.left, row) && matchSource(source.right, row)
        : matchSource(source.left, row) || matchSource(source.right, row);
  }
}
