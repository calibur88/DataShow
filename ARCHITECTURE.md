# DataShow 整体架构

> 本文是工作区的权威架构说明，先读这份再看各目录内的专题文档。
> 当前版本：插件 **1.8.0** · 语言 **DSQL 1.4**（2026-09 核对）。

## 1. 项目定位

DataShow 是面向 Obsidian 的元数据看板插件：

1. **索引**：把 vault 内笔记的 frontmatter（属性）原样索引成行仓库，不预设字段体系、不建私有数据库；
2. **查询**：用自研查询语言 **DSQL**（标记语法：关键词 `**SELECT**`、运算符 `%==%`、字符串 `'值'`、路径 `"文件夹"`）对行仓库查询；
3. **渲染**：在看板面板中渲染为表格 / 列表视图，并支持直接在结果中编辑回 frontmatter。

核心设计原则：数据中立（任何 vault 的 Properties 都能查）、Markdown First（数据只存于笔记本身）、确定性排序（UTF-8 字节序）。

## 2. 双目录工作流

工作区刻意采用「正式 / 草稿」双工程结构，两个插件 id 不同（`data-show` / `datashow-dev`），
各自配套独立的演示 vault（`data_show/test-vault/`、`data_show_test/test-vault/`，内容一致、
只部署各自的插件），预置看板按 功能示例 / 数学示例 / DSQL语言示例 三大类组织，示例数据在 `示例/` 下。

| 目录 | 定位 | 插件 id | 版本号 |
|---|---|---|---|
| `data_show/` | 正式版：清理后的插件工程，只含源码、构建配置与用户文档 | `data-show` | `x.y.0` |
| `data_show_test/` | 草稿开发目录：新功能、DSQL 语法演进、测试与规范文档 | `datashow-dev` | `x.y.001+`（当前与正式版同步于 1.8.0） |

**开发循环**（版本规则见根 [README.md](README.md)）：

1. 在 `data_show_test/` 开发，版本号末段递增（如 `1.6.001`）；
2. `npm test`（单测按 功能示例 / 数学示例 / DSQL语言示例 三大类组织，共 47+ 用例）
   与 `npm run build` 通过后，在本工程的 `test-vault/` 中用 Obsidian 实际验收；
3. 经用户明确允许后迁移到 `data_show/`，版本号定为 `x.y.0`，两目录的 src 保持同步
   （当前仅有 `main.ts` 头部注释、`types.ts`、`views/panel.ts` 的少量 id/文案差异）；
4. 两边 CHANGELOG 分别记录：正式版从简、测试版详细。

测试基础设施（`scripts/test.mjs`、`tests/`）只在 `data_show_test/`，正式目录迁移时不包含；
测试用例按示例面板三大类组织：`feature.test.ts`（功能示例）、`math.test.ts`（数学示例）、
`dsql-language.test.ts`（DSQL语言示例），另有 `store.test.ts`（索引层）与 `helpers.ts`（共享数据）。

## 3. 代码架构（src/）

```
main.ts ── 装配与注册
  │
  ├─ settings.ts        设置页：看板定义管理（名称/类型/说明 + 增删/恢复默认）
  │
  ├─ index/  （数据层）
  │    scanner.ts       基于 metadataCache 的全量首扫 + 增量监听（debounce）
  │    row-builder.ts   frontmatter → 行（原样入行，不改写业务字段；无属性笔记以文件信息入行）
  │    store.ts         行仓库：缓存 + 变更通知（订阅者自动重跑）
  │
  ├─ query/  （DSQL 语言层，零 Obsidian 依赖，可独立测试）
  │    lexer.ts         词法：**关键词** / %运算符% / '字符串' / "路径" / 裸标识符
  │    parser.ts        语法：前件关系驱动（书写顺序自由、每条至多一次；
  │                     SELECT 可省略默认 *，FROM 为唯一必填，WHERE/SORT/LIMIT 以 FROM 为前件）
  │    ast.ts           语法树定义
  │    functions.ts     内置函数：sqrt/cbrt/root/contains/length/lower/upper/empty
  │    executor.ts      执行：FROM→WHERE→SORT→LIMIT→SELECT 管线，非致命语义（错误 → null + 警告）
  │
  └─ views/  （表现层）
       sidebar.ts       看板侧栏：按类型分组展示设置中的看板
       panel.ts         看板面板：头部 → DSQL 编辑器（防抖自动保存）→ 工具条（刷新/视图切换）→ 结果区
       frontmatter-modal.ts  属性编辑弹窗：读 metadataCache → stringifyYaml → parseYaml 校验
                             → processFrontMatter 原子写回
```

### 数据流

```
笔记变更（含结果区内联编辑写回 frontmatter）
  → scanner 增量监听（debounce）→ row-builder 构造行 → store 更新并广播
  → panel 订阅重跑 DSQL → executor 出结果 → 表格/列表渲染
```

看板定义（名称/类型/说明/DSQL/视图覆盖）只存插件 `data.json`；面板 DSQL 防抖自动保存后触发侧栏刷新，外部变更经 `onExternalChange` 同步。没有 `DataShow/` 目录之类的私有存储约定。

### 数据可编辑（1.6.0 起）

表格双击单元格内联改 frontmatter（true/false、数字自动转型，数组列不可编辑）；列表点击条目或行 ✎ 打开属性弹窗。保存后索引增量更新、结果自动刷新。

## 4. 构建与测试

```bash
cd data_show        # 或 data_show_test
npm install
npm run dev         # watch 模式，产物自动同步到本工程 test-vault/.obsidian/plugins/<id>/
npm run build       # tsc 类型检查 + esbuild 生产构建
npm test            # 仅 data_show_test：单测三大类（功能/数学/DSQL语言）+ store（零 Obsidian 依赖）
```

验收方式：用 Obsidian 打开对应工程的 `test-vault/`（各自只部署本工程插件），按其
`test-vault/README.md` 的说明操作。构建产物（main.js / manifest.json / styles.css）由
esbuild 配置自动同步进各自 vault，无需手工拷贝。

## 5. 相关文档索引

| 文档 | 位置 | 说明 |
|---|---|---|
| 工作区总说明 | [README.md](README.md) | 双目录结构、版本规则、快速开始 |
| API 参考 | [API.md](API.md) | Obsidian 官方 API + 插件 API（基于 1.8.0，minAppVersion 1.4.4） |
| DSQL 规范 | [`data_show/docs/DSQL-EBNF.md`](data_show/docs/DSQL-EBNF.md) | DSQL v1.4 权威语法规范（EBNF + 语义） |
| 正式版日志 | [`data_show/CHANGELOG.md`](data_show/CHANGELOG.md) | 从简 |
| 测试版日志 | [`data_show_test/CHANGELOG.md`](data_show_test/CHANGELOG.md) | 详细 |
| 计划归档 | [`.zcode/plans/history.md`](.zcode/plans/history.md) | 已落地的会话计划 |

## 6. 现状与规划

**已实现**（1.8.0 / DSQL 1.4）：DSQL 查询（表达式/函数/多级排序/自定义优先级/调试信息）、TOTAL 全表聚合与 $变量$ 派生体系、表格与列表视图、属性内联编辑、索引增量更新、双目录迁移流。

**规划中**：统一记录在工作区根目录 [`TODO`](TODO)（当前留空）。
