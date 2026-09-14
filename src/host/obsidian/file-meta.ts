/**
 * @module host/obsidian/file-meta
 * @description TFile → 宿主中立文件元数据的共享映射（vault-host 与 ext-source-host 共用）
 */

import type { TFile } from "obsidian";
import type { IFileMeta } from "../types";

/** TFile → 宿主中立的文件元数据 */
export function toMeta(file: TFile): IFileMeta {
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
