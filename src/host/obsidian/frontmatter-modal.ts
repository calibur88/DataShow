/**
 * @module host/obsidian/frontmatter-modal
 * @description 属性编辑弹窗：IFrontmatterEditor 的 Obsidian Modal 实现（官方 API 流水线）
 */

import { App, Modal, TFile } from "obsidian";
import type { IFrontmatterEditor, IYamlCodec } from "../types";

/**
 * 属性编辑弹窗适配器：metadataCache 读 → stringify 展示 → parse 校验 → 原子写回。
 * 保存后索引由 metadataCache 事件增量更新，看板查询结果随之刷新
 */
export class ObsidianFrontmatterEditor implements IFrontmatterEditor {
  constructor(
    private app: App,
    private codec: IYamlCodec,
  ) {}

  /**
   * 打开弹窗。文件不存在或不是 Markdown 文件时静默返回。
   *
   * @param path - 笔记路径
   * @param onSaved - 保存成功回调
   */
  openEditor(path: string, onSaved: () => void): void {
    const file = this.app.vault.getFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") return;
    new FrontmatterEditModal(this.app, file, this.codec, onSaved).open();
  }
}

/** 属性编辑弹窗本体：模块私有，对外只经 ObsidianFrontmatterEditor 暴露。 */
class FrontmatterEditModal extends Modal {
  private readonly fm: Record<string, unknown>;

  constructor(
    app: App,
    private file: TFile,
    private codec: IYamlCodec,
    private onSaved: () => void,
  ) {
    super(app);
    this.fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  }

  onOpen(): void {
    this.titleEl.setText(`编辑属性：${this.file.basename}`);
    const { contentEl } = this;
    contentEl.addClass("datashow-fm-modal");

    const textarea = contentEl.createEl("textarea", { cls: "datashow-fm-modal__input" });
    textarea.value = this.codec.stringify(this.fm);
    textarea.spellcheck = false;
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.save(textarea.value, err);
      }
    });

    const err = contentEl.createDiv({ cls: "datashow-fm-modal__error" });
    err.hide();

    const btns = contentEl.createDiv({ cls: "datashow-fm-modal__btns" });
    btns.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    btns
      .createEl("button", { text: "保存", cls: "mod-cta" })
      .addEventListener("click", () => void this.save(textarea.value, err));
  }

  private async save(raw: string, err: HTMLElement): Promise<void> {
    let parsed: unknown;
    try {
      parsed = this.codec.parse(raw);
    } catch (e) {
      err.setText(`YAML 解析失败：${(e as Error).message}`);
      err.show();
      return;
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      err.setText("frontmatter 应为「键: 值」形式的 YAML 映射。");
      err.show();
      return;
    }
    await this.app.fileManager.processFrontMatter(this.file, (fm) => {
      for (const k of Object.keys(fm)) delete fm[k];
      Object.assign(fm, parsed as Record<string, unknown>);
    });
    this.onSaved();
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
