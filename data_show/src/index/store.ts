import type { DataRow } from "../types";

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

  /** 归档某文件的摄取警告（空数组 = 清除）。 */
  setIngestWarnings(path: string, warnings: IngestWarning[]): void {
    if (warnings.length === 0) this.ingest.delete(path);
    else this.ingest.set(path, warnings);
    this.bump();
  }

  /** 全库摄取警告（DSQL 1.5：随查询调试信息输出）。 */
  ingestWarnings(): IngestWarning[] {
    return [...this.ingest.values()].flat();
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
