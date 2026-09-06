# DataShow 工作区

面向 Obsidian 的元数据看板插件 **DataShow**（id: `data-show`）的开发工作区。

| 目录 | 定位 | 插件 id |
|---|---|---|
| [`data_show/`](data_show/) | **正式版**（当前 1.6.0）：清理后的插件工程，只含源码、构建配置与用户文档 | `data-show` |
| [`data_show_test/`](data_show_test/) | **草稿开发目录**：新功能、DSQL 语法演进、测试、规范与方案文档都在这里进行 | `datashow-dev` |

两者 id 不同，可在同一 vault 中共存。**版本规则**：

- 版本号三段式 `x.y.zzz`：正式版末段为 `0`（如 `1.4.0`），无测试后缀；
- **测试版**在 `data_show_test/` 中开发，末段递增表示测试改进版本（如 `1.4.001`）；
- 测试目录验证通过后，**仅在用户明确允许下**才迁移至正式目录，并把版本号定为 `x.y.0`；
- 未经迁移允许，正式目录版本号不动。

**更新日志**：正式版更新日志见 [`data_show/CHANGELOG.md`](data_show/CHANGELOG.md)，
**只写功能更新、从简**（迁移了什么就写什么）；测试版更新日志见
[`data_show_test/CHANGELOG.md`](data_show_test/CHANGELOG.md)，记录功能演进与测试细节。

**API 文档**：见 [`API.md`](API.md)，区分**官方 API**（Obsidian：frontmatter 读写、索引监听、工作区 UI）
与**插件 API**（DSQL 查询层、行仓库、插件实例、BoardDef 结构）。

**其他文档**：

- [`ARCHITECTURE.md`](ARCHITECTURE.md) —— 整体架构、双目录工作流与开发/测试说明（先读这份）；
- [`data_show/docs/DSQL-EBNF.md`](data_show/docs/DSQL-EBNF.md) —— DSQL v1.3 权威语法规范；
- [`data_show_test/docs/datashow方案.md`](data_show_test/docs/datashow方案.md) —— 早期方案设计（历史文档）；
- [`.zcode/plans/history.md`](.zcode/plans/history.md) —— AI 会话计划归档（均已随 1.6.0 落地）。

## 正式版核心

- **看板**：`名称 + 类型 + 说明 + DSQL`，在设置中管理、在看板面板中编辑（自动保存）；
- **数据可编辑**：表格双击单元格、列表点击条目直接改 frontmatter，保存后结果自动刷新；
- **DSQL v1.3**：标记语法（`**SELECT**` / `%==%`），子句按前件关系书写（SELECT 可省略），
  完整表达式、多级排序与自定义优先级，规范见 [`data_show/docs/DSQL-EBNF.md`](data_show/docs/DSQL-EBNF.md)；
- **索引**：Obsidian metadataCache 增量索引，frontmatter 原样入行（不解释、不改写业务字段）；
- **视图**：表格 / 列表（看板卡片墙、日历、统计为规划项）。

## 快速开始

```bash
cd data_show        # 或 data_show_test
npm install
npm run build       # 产出 main.js
```

安装：把 `main.js`、`manifest.json`、`styles.css` 放入 `仓库/.obsidian/plugins/data-show/` 并启用。
