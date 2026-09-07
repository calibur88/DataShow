/**
 * @module ui/views/frontmatter-modal
 * @description frontmatter 编辑弹窗：官方 API 流水线，索引随之增量更新
 *
 * 官方 API（metadataCache 读 → stringifyYaml 展示 →
 * parseYaml 解析 → fileManager.processFrontMatter 原子写回）。
 * 保存后索引自动增量更新，看板查询结果随之刷新。
 */

import { App, Modal, TFile, parseYaml, stringifyYaml } from "obsidian";

/**
 * frontmatter 编辑弹窗：官方 API（metadataCache 读 → stringifyYaml 展示 →
 * parseYaml 解析 → fileManager.processFrontMatter 原子写回）。
 * 保存后索引自动增量更新，看板查询结果随之刷新。
 */
export class FrontmatterEditModal extends Modal {
  private readonly fm: Record<string, unknown>;

  constructor(
    app: App,
    private file: TFile,
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
    textarea.value = stringifyYaml(this.fm);
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
      parsed = parseYaml(raw);
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
