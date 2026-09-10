/**
 * @module host/obsidian/vault-host
 * @description Obsidian 数据源适配器：metadataCache 取元数据与链路，vault 取正文与变更事件
 */

import { App, TFile, type EventRef } from "obsidian";
import type { IFileMeta, IVaultHost, VaultEventHandlers } from "../types";

/** TFile → 宿主中立的文件元数据 */
function toMeta(file: TFile): IFileMeta {
  const folder = file.parent?.path ?? "";
  return {
    path: file.path,
    basename: file.basename,
    folder: folder === "/" ? "" : folder,
    ext: file.extension,
    size: file.stat.size,
    ctime: file.stat.ctime,
    mtime: file.stat.mtime,
  };
}

/**
 * 数据源适配器。
 * 反向链接表按事件失效并惰性重算：一次批量刷新内多次 getInlinks 只算一次
 */
export class ObsidianVaultHost implements IVaultHost {
  private reverseCache: Record<string, string[]> | null = null;

  constructor(private app: App) {}

  async listMarkdownFiles(): Promise<IFileMeta[]> {
    return this.app.vault.getMarkdownFiles().map(toMeta);
  }

  async readFrontmatter(path: string): Promise<Record<string, unknown> | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    return this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
  }

  async getOutlinks(path: string): Promise<string[]> {
    return Object.keys(this.app.metadataCache.resolvedLinks[path] ?? {});
  }

  async getInlinks(path: string): Promise<string[]> {
    return (this.reverse()[path] ?? []).slice();
  }

  async readText(path: string): Promise<string | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    return this.app.vault.cachedRead(file);
  }

  /**
   * 订阅 vault 与 metadataCache 事件，统一翻译成宿主中立的四种回调。
   * 事件到达时先失效反向链接缓存，再转发给订阅方
   *
   * @param handlers - 事件回调集合（未提供某项则不注册对应事件）
   * @returns 注销函数：解绑本订阅注册的全部事件
   */
  subscribe(handlers: VaultEventHandlers): () => void {
    const refs: EventRef[] = [];
    const invalidate = (): void => {
      this.reverseCache = null;
    };

    if (handlers.onResolved) {
      refs.push(
        this.app.metadataCache.on("resolved", () => {
          invalidate();
          handlers.onResolved?.();
        }),
      );
    }
    if (handlers.onChanged) {
      refs.push(
        this.app.metadataCache.on("changed", (file) => {
          invalidate();
          if (file instanceof TFile && file.extension === "md") handlers.onChanged?.(file.path);
        }),
      );
    }
    if (handlers.onDeleted) {
      refs.push(
        this.app.vault.on("delete", (file) => {
          invalidate();
          handlers.onDeleted?.(file.path);
        }),
      );
    }
    if (handlers.onRenamed) {
      refs.push(
        this.app.vault.on("rename", (file, oldPath) => {
          invalidate();
          handlers.onRenamed?.(oldPath, file.path);
        }),
      );
    }

    return () => {
      for (const ref of refs) {
        this.app.metadataCache.offref(ref);
        this.app.vault.offref(ref);
      }
      refs.length = 0;
    };
  }

  /** resolvedLinks 的反向索引：目标路径 → 入链来源列表。 */
  private reverse(): Record<string, string[]> {
    if (this.reverseCache) return this.reverseCache;
    const reverse: Record<string, string[]> = {};
    for (const [source, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      for (const target of Object.keys(targets)) {
        (reverse[target] ??= []).push(source);
      }
    }
    this.reverseCache = reverse;
    return reverse;
  }
}
