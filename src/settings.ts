/**
 * @module settings
 * @description 插件设置页：常规设置 + 看板管理（身份信息编辑，DSQL 在面板中编辑）
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type DatashowPlugin from "./main";
import { IMPLEMENTED_VIEWS, VIEW_LABELS, makeBoardId, type BoardDef, type ViewType } from "@dsql/types";

/**
 * 插件设置页：
 * 1. 常规设置（数据目录、打开方式）
 * 2. 看板管理 —— 只维护看板身份信息（名称/类型/说明）；
 *    DSQL 在看板面板中编辑。
 */
export class DatashowSettingTab extends PluginSettingTab {
  private plugin: DatashowPlugin;
  /** 当前展开编辑器的看板 id */
  private expandedId: string | null = null;

  constructor(app: App, plugin: DatashowPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** 渲染设置页（Obsidian 打开设置面板时调用）。 */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderGeneralSettings();
    this.renderBoardManager();
  }

  private renderGeneralSettings(): void {
    const { containerEl } = this;

    new Setting(containerEl).setName("常规").setHeading();

    new Setting(containerEl)
      .setName("在新标签页打开看板")
      .setDesc("开启后点击侧栏看板会在新标签页打开；关闭则复用已打开的看板标签页。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openInNewTab).onChange(async (value) => {
          this.plugin.settings.openInNewTab = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("显示 DSQL 调试信息")
      .setDesc("在看板面板的查询结果下方展示 DSQL 内部执行信息（每个操作的处理行数、字段找不到等）。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showDebug).onChange(async (value) => {
          this.plugin.settings.showDebug = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("小数显示位数")
      .setDesc("查询结果中非整数数值显示的小数位。只影响显示，不影响排序与计算；超出浮点数精度时重置为默认 4。")
      .addText((text) =>
        text
          .setPlaceholder("4")
          .setValue(String(this.plugin.settings.decimalPlaces))
          .onChange(async (value) => {
            const n = parseInt(value.trim(), 10);
            // 不设上限：非负整数即可；超过浮点数精度（toFixed 上限 100 位）重置为默认
            this.plugin.settings.decimalPlaces = Number.isNaN(n) || n < 0 || n > 100 ? 4 : n;
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderBoardManager(): void {
    const { containerEl } = this;

    new Setting(containerEl)
      .setName("看板")
      .setHeading()
      .setDesc("在此管理看板（名称/类型/说明）。DSQL 查询语句在打开看板后的面板中编辑，不在这里配置。");

    new Setting(containerEl)
      .setName("添加看板")
      .setDesc("新建一个空白看板，然后打开面板编辑其 DSQL。")
      .addButton((button) =>
        button.setButtonText("新建看板").onClick(async () => {
          const board: BoardDef = {
            id: makeBoardId(),
            name: `新看板 ${this.plugin.settings.boards.length + 1}`,
            type: "",
            description: "",
            sql: "",
            viewType: "",
          };
          this.plugin.settings.boards.push(board);
          await this.plugin.saveSettings();
          this.expandedId = board.id;
          this.display();
        }),
      );

    const boards = this.plugin.settings.boards;
    if (boards.length === 0) {
      containerEl.createDiv({
        cls: "datashow-settings__empty",
        text: "暂无看板。点击「新建看板」创建，或恢复默认看板。",
      });
      new Setting(containerEl).addButton((button) =>
        button.setButtonText("恢复默认看板").onClick(async () => {
          this.plugin.settings.boards = this.plugin.defaultBoards();
          await this.plugin.saveSettings();
          this.display();
        }),
      );
      return;
    }

    for (const board of boards) {
      this.renderBoardItem(containerEl, board);
    }
  }

  private renderBoardItem(containerEl: HTMLElement, board: BoardDef): void {
    const item = containerEl.createDiv({ cls: "datashow-settings__board" });

    new Setting(item)
      .setName(board.name || "（未命名看板）")
      .setDesc(board.type ? `分类：${board.type}` : "分类：未设置")
      .addExtraButton((btn) =>
        btn
          .setIcon(this.expandedId === board.id ? "chevron-up" : "chevron-down")
          .setTooltip("编辑看板")
          .onClick(async () => {
            this.expandedId = this.expandedId === board.id ? null : board.id;
            this.display();
          }),
      )
      .addExtraButton((btn) =>
        btn.setIcon("trash").setTooltip("删除看板").onClick(async () => {
          this.plugin.settings.boards = this.plugin.settings.boards.filter(
            (b) => b.id !== board.id,
          );
          await this.plugin.saveSettings();
          if (this.expandedId === board.id) this.expandedId = null;
          this.display();
        }),
      );

    if (this.expandedId === board.id) {
      this.renderBoardEditor(item, board);
    }
  }

  private renderBoardEditor(item: HTMLElement, board: BoardDef): void {
    const editor = item.createDiv({ cls: "datashow-settings__editor" });

    const nameSetting = new Setting(editor).setName("看板名称").addText((text) =>
      text.setValue(board.name).onChange(async (value) => {
        board.name = value.trim();
        await this.plugin.saveSettings();
      }),
    );
    nameSetting.setDesc("侧栏显示的名称。");

    new Setting(editor).setName("看板分类").addText((text) =>
      text.setPlaceholder("例如：任务 / 项目 / 自定义").setValue(board.type).onChange(async (value) => {
        board.type = value.trim();
        await this.plugin.saveSettings();
      }),
    );

    // R6：视图模式下拉（与看板分类解耦，独立字段）
    new Setting(editor)
      .setName("视图模式")
      .setDesc("下拉选择；「跟随语句」表示由 SQL 开头关键词决定渲染方式，无关键词则默认表格")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "跟随语句");
        for (const v of IMPLEMENTED_VIEWS) {
          dropdown.addOption(v, VIEW_LABELS[v] ?? v);
        }
        dropdown.setValue(board.viewType);
        dropdown.onChange(async (value) => {
          // 白名单：仅接受 ViewType 或空串
          board.viewType = value === "" || value === "TABLE_VIEW" || value === "LIST_VIEW" || value === "CARD_VIEW"
            ? (value as ViewType | "")
            : "";
          await this.plugin.saveSettings();
        });
      });

    new Setting(editor).setName("作用描述").addTextArea((area) => {
      area.setValue(board.description).onChange(async (value) => {
        board.description = value;
        await this.plugin.saveSettings();
      });
      area.inputEl.rows = 2;
      area.inputEl.addClass("datashow-settings__textarea");
    });

    editor.createDiv({
      cls: "datashow-settings__hint",
      text: "DSQL 查询语句在侧栏打开该看板的面板中编辑。",
    });
  }
}
