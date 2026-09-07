import { App, TAbstractFile, TFile, debounce } from "obsidian";
import { findDuplicateKeys } from "./frontmatter";
import { buildRow } from "./row-builder";
import type { DataStore } from "./store";

/**
 * 扫描器：启动时全量扫描 metadataCache，之后监听增量事件维护 store。
 * 批量事件经 debounce 合并，一次 flush 内重算一次反向链接。
 */
export class VaultScanner {
  private pending = new Set<string>();
  private flushDebounced = debounce(() => this.flush(), 300, true);

  /**
   * resolved 事件：启动后及此后每次批量修改解析完成都会触发。
   * 仅首次触发做全量重建，之后交给增量路径（changed 的 flush 已重算反向链接）。
   */
  private onResolved = (): void => {
    if (this.resolvedOnce) return;
    this.resolvedOnce = true;
    this.fullRebuild();
  };
  private resolvedOnce = false;

  private onCacheChanged = (file: TFile): void => {
    if (file.extension !== "md") return;
    this.pending.add(file.path);
    this.flushDebounced();
  };

  private onDeleted = (file: TAbstractFile): void => {
    this.store.remove(file.path);
  };

  private onRenamed = (file: TAbstractFile, oldPath: string): void => {
    this.store.remove(oldPath);
    if (file instanceof TFile && file.extension === "md") {
      this.pending.add(file.path);
      this.flushDebounced();
    }
  };

  constructor(
    private app: App,
    private store: DataStore,
  ) {}

  /** 注册事件并做首扫。register 由插件提供（保证卸载时清理）。 */
  start(register: (ref: unknown) => void): void {
    register(this.app.metadataCache.on("resolved", this.onResolved));
    register(this.app.metadataCache.on("changed", this.onCacheChanged));
    register(this.app.vault.on("delete", this.onDeleted));
    register(this.app.vault.on("rename", this.onRenamed));
    this.fullRebuild();
  }

  /** 全量重建（首扫 / resolved 回落）。 */
  fullRebuild(): void {
    const reverse = reverseLinks(this.app.metadataCache.resolvedLinks);
    const files = this.app.vault.getMarkdownFiles();
    this.store.upsertMany(
      files.map((file) =>
        buildRow(
          file,
          this.app.metadataCache.getFileCache(file)?.frontmatter,
          Object.keys(this.app.metadataCache.resolvedLinks[file.path] ?? {}),
          reverse[file.path] ?? [],
        ),
      ),
    );
    for (const file of files) void this.checkDuplicateKeys(file);
  }

  private flush(): void {
    if (this.pending.size === 0) return;
    const reverse = reverseLinks(this.app.metadataCache.resolvedLinks);
    for (const path of this.pending) {
      const file = this.app.vault.getFileByPath(path);
      if (!(file instanceof TFile)) continue;
      this.store.upsert(
        buildRow(
          file,
          this.app.metadataCache.getFileCache(file)?.frontmatter,
          Object.keys(this.app.metadataCache.resolvedLinks[path] ?? {}),
          reverse[path] ?? [],
        ),
      );
      void this.checkDuplicateKeys(file);
    }
    this.pending.clear();
  }

  /**
   * DSQL 1.5 摄取容错：重复键检测（异步，cachedRead 读原文顶层键）。
   * 命中 → 该文件从结果集中剔除，计入 duplicateKey 摄取警告（原始键值对归档），查询继续。
   */
  private async checkDuplicateKeys(file: TFile): Promise<void> {
    const findings = findDuplicateKeys(await this.app.vault.cachedRead(file));
    if (findings.length === 0) {
      this.store.setIngestWarnings(file.path, []);
      return;
    }
    this.store.remove(file.path);
    this.store.setIngestWarnings(
      file.path,
      findings.map((f) => ({
        type: "duplicateKey",
        file: file.path,
        field: f.field,
        message: `文件 "${file.path}" frontmatter 存在重复键 "${f.field}"，已从结果集中剔除`,
        rawLines: f.rawLines,
      })),
    );
  }
}

/** resolvedLinks 的反向索引：目标路径 → 入链来源列表。 */
function reverseLinks(
  resolved: Record<string, Record<string, number>>,
): Record<string, string[]> {
  const reverse: Record<string, string[]> = {};
  for (const [source, targets] of Object.entries(resolved)) {
    for (const target of Object.keys(targets)) {
      (reverse[target] ??= []).push(source);
    }
  }
  return reverse;
}
