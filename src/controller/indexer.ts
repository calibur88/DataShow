/**
 * @module controller/indexer
 * @description 索引器：宿主数据源的全量扫描与增量事件维护，产出唯一的行仓库
 */

import type { IUiHost, IVaultHost } from "@host/types";
import { findDuplicateKeys } from "@index/frontmatter";
import { buildRow } from "@index/row-builder";
import type { DataStore } from "@index/store";

/** 增量事件合并窗口：连续改动只重算一次 */
const FLUSH_DEBOUNCE_MS = 300;

/**
 * 索引器：订阅宿主变更 → 构造行 → 写入 DataStore。
 * 数据链路单向：`IVaultHost.subscribe → VaultIndexer → DataStore → UI 订阅`，
 * 宿主事件不直接触达 UI
 */
export class VaultIndexer {
  private pending = new Set<string>();
  private flushTimer: number | null = null;
  private resolvedOnce = false;
  private disposer: (() => void) | null = null;

  /**
   * @param vault - 宿主数据源
   * @param store - 行仓库（唯一输出）
   * @param ui - 反馈出口（索引异常只记日志，不打断查询）
   */
  constructor(
    private vault: IVaultHost,
    private store: DataStore,
    private ui: IUiHost,
  ) {}

  /** 注册宿主事件并做首扫。卸载前必须调用 dispose。 */
  start(): void {
    this.disposer = this.vault.subscribe({
      onResolved: () => {
        // resolved 在每次批量解析后都会触发，仅首次做全量重建，之后交给增量路径
        if (this.resolvedOnce) return;
        this.resolvedOnce = true;
        void this.fullRebuild();
      },
      onChanged: (path) => {
        this.pending.add(path);
        this.scheduleFlush();
      },
      onDeleted: (path) => {
        this.store.remove(path);
      },
      onRenamed: (oldPath, newPath) => {
        this.store.remove(oldPath);
        if (newPath.toLowerCase().endsWith(".md")) {
          this.pending.add(newPath);
          this.scheduleFlush();
        }
      },
    });
    void this.fullRebuild();
  }

  /** 注销宿主事件并取消待执行的增量刷新。 */
  dispose(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.disposer?.();
    this.disposer = null;
  }

  /** 全量重建（首扫 / resolved 回落）。 */
  async fullRebuild(): Promise<void> {
    const files = await this.vault.listMarkdownFiles();
    const rows = [];
    for (const file of files) {
      const [frontmatter, outlinks, inlinks] = await Promise.all([
        this.vault.readFrontmatter(file.path),
        this.vault.getOutlinks(file.path),
        this.vault.getInlinks(file.path),
      ]);
      rows.push(buildRow(file, frontmatter, outlinks, inlinks));
    }
    this.store.upsertMany(rows);
    await Promise.all(files.map((file) => this.checkDuplicateKeys(file.path)));
  }

  /** 防抖窗口结束：把挂起的路径逐个重算。 */
  private scheduleFlush(): void {
    if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const paths = [...this.pending];
    this.pending.clear();
    const all = await this.vault.listMarkdownFiles();
    for (const path of paths) {
      const file = all.find((f) => f.path === path);
      if (!file) continue;
      const [frontmatter, outlinks, inlinks] = await Promise.all([
        this.vault.readFrontmatter(path),
        this.vault.getOutlinks(path),
        this.vault.getInlinks(path),
      ]);
      this.store.upsert(buildRow(file, frontmatter, outlinks, inlinks));
      await this.checkDuplicateKeys(path);
    }
  }

  /**
   * DSQL 1.5 摄取容错：重复键检测（读原文顶层键）。
   * 命中 → 该文件从结果集中剔除，计入 duplicateKey 摄取警告（原始键值对归档），查询继续。
   */
  private async checkDuplicateKeys(path: string): Promise<void> {
    const text = await this.vault.readText(path);
    const findings = text === null ? [] : findDuplicateKeys(text);
    if (findings.length === 0) {
      this.store.setIngestWarnings(path, []);
      return;
    }
    this.store.remove(path);
    this.store.setIngestWarnings(
      path,
      findings.map((f) => ({
        type: "duplicateKey",
        file: path,
        field: f.field,
        message: `文件 "${path}" frontmatter 存在重复键 "${f.field}"，已从结果集中剔除`,
        rawLines: f.rawLines,
      })),
    );
  }
}
