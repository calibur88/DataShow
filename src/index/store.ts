/**
 * @module index/store
 * @description 行仓库：内存中的「笔记 = 行」数据库，查询层与表现层的唯一数据源
 */

import type { DataRow } from "@dsql/types";

/** 摄取期容错警告（DSQL 1.5）：如重复键剔除。按文件路径归档，随查询调试信息一并输出。 */
export interface IngestWarning {
  type: string;
  file: string;
  field?: string;
  message: string;
  /** 原始键值对档案（重复键场景保留原文行，供排查） */
  rawLines?: string[];
}

/**
 * 行仓库：内存中的“笔记 = 行”数据库，L3 查询层与 L4 表现层的唯一数据源。
 * 每次变更递增版本号并通知订阅者（视图据此刷新）。
 */
export class DataStore {
  private rows = new Map<string, DataRow>();
  private ingest = new Map<string, IngestWarning[]>();
  private rev = 0;
  private subs = new Set<() => void>();

  /**
   * @returns 数据版本号（每次变更递增）
   */
  version(): number {
    return this.rev;
  }

  /**
   * 按路径取单行。
   *
   * @param path - vault 内笔记路径
   * @returns 对应行；不存在时为 undefined
   */
  row(path: string): DataRow | undefined {
    return this.rows.get(path);
  }

  /**
   * @returns 全部行（按路径排序的快照数组）
   */
  all(): DataRow[] {
    return [...this.rows.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * @returns 当前行数
   */
  count(): number {
    return this.rows.size;
  }

  /**
   * 写入或覆盖一行，并通知订阅者。
   *
   * @param row - 行（以 path 为主键）
   */
  upsert(row: DataRow): void {
    this.rows.set(row.path, row);
    this.bump();
  }

  /**
   * 批量写入，只触发一次通知。
   *
   * @param rows - 行列表（空数组不触发通知）
   */
  upsertMany(rows: DataRow[]): void {
    for (const row of rows) this.rows.set(row.path, row);
    if (rows.length > 0) this.bump();
  }

  /**
   * 删除一行。
   *
   * @param path - 笔记路径（不存在时不触发通知）
   */
  remove(path: string): void {
    if (this.rows.delete(path)) this.bump();
  }

  /**
   * 归档某文件的摄取警告（空数组 = 清除）。
   *
   * @param path - 笔记路径
   * @param warnings - 警告列表
   */
  setIngestWarnings(path: string, warnings: IngestWarning[]): void {
    if (warnings.length === 0) this.ingest.delete(path);
    else this.ingest.set(path, warnings);
    this.bump();
  }

  /**
   * 全库摄取警告（DSQL 1.5：随查询调试信息输出）。
   *
   * @returns 跨文件扁平化的警告列表
   */
  ingestWarnings(): IngestWarning[] {
    return [...this.ingest.values()].flat();
  }

  /**
   * 订阅数据变更。
   *
   * @param cb - 变更回调（无参）
   * @returns 取消订阅函数
   */
  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private bump(): void {
    this.rev++;
    for (const cb of this.subs) cb();
  }
}
