import type { DataRow } from "../types";

/**
 * 行仓库：内存中的“笔记 = 行”数据库，L3 查询层与 L4 表现层的唯一数据源。
 * 每次变更递增版本号并通知订阅者（视图据此刷新）。
 */
export class DataStore {
  private rows = new Map<string, DataRow>();
  private rev = 0;
  private subs = new Set<() => void>();

  version(): number {
    return this.rev;
  }

  row(path: string): DataRow | undefined {
    return this.rows.get(path);
  }

  all(): DataRow[] {
    return [...this.rows.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  count(): number {
    return this.rows.size;
  }

  upsert(row: DataRow): void {
    this.rows.set(row.path, row);
    this.bump();
  }

  upsertMany(rows: DataRow[]): void {
    for (const row of rows) this.rows.set(row.path, row);
    if (rows.length > 0) this.bump();
  }

  remove(path: string): void {
    if (this.rows.delete(path)) this.bump();
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private bump(): void {
    this.rev++;
    for (const cb of this.subs) cb();
  }
}
