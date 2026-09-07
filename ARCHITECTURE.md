# DataShow 整体架构

> 本文是工程的权威架构说明。当前版本：插件 **2.1.1** · 语言 **DSQL 2.0** · minAppVersion **1.4.4**。

## 1. 项目定位

DataShow 是面向 Obsidian 的元数据看板插件：

1. **索引**：把 vault 内笔记的 frontmatter（属性）原样索引成行仓库，不预设字段体系、不建私有数据库；
2. **查询**：用自研查询语言 **DSQL**（标记语法：关键词 `**SELECT**`、运算符 `%==%`、字符串 `'值'`、路径 `"文件夹"`）对行仓库查询；
3. **渲染**：在看板面板中渲染为表格 / 列表 / 卡片视图，并支持在卡片视图中直接编辑回 frontmatter。

核心设计原则：数据中立（任何 vault 的 Properties 都能查）、Markdown First（数据只存于笔记本身）、
确定性排序（UTF-8 字节序）。

## 2. 单目录工程结构

工程为**单一插件工程**：源码、测试、脚本、文档、演示库都在同一个根目录下，
插件 ID 统一为 `data-show`，版本号统一由 `manifest.json` / `package.json` / `versions.json` 三处维护。

```
根目录/
├── src/                 插件源码（唯一入口 src/main.ts）
├── tests/               单元测试（七套件）
├── scripts/test.mjs     测试运行器
├── docs/                DSQL 语言规范
├── dist/                构建产物（不入库）
├── test-vault/          干净演示库（入库，仅提交用）
├── test-vault-local/    本地测试库（不入库，日常验收用）
├── manifest.json  package.json  tsconfig.json  versions.json
├── esbuild.config.mjs   styles.css
└── README.md  ARCHITECTURE.md  CONTRIBUTING.md  API.md  CHANGELOG.md
```

**两个演示库的分工**：

| 目录 | 用途 | 是否入库 |
|---|---|---|
| `test-vault-local/` | 日常在 Obsidian 中实际验收（看板加载、查询、视图切换、卡片编辑）。测试产生的改动都留在这里 | ❌（`.gitignore` 排除） |
| `test-vault/` | 干净版本，仅用于版本提交，不用于日常测试 | ✅ |

两者预置看板一致，按 功能示例 / 数学示例 / DSQL语言示例 / 三值示例 四大类组织，示例数据在 `示例/` 下。
看板定义存于 `.obsidian/plugins/data-show/data.json`（**纳入版本控制**，是含全部 DSQL 的核心资产）；
插件构建产物（`main.js` / `manifest.json` / `styles.css`）由 esbuild 自动同步进库，**不入库**。

恢复机制：本地测试会改写 `data.json` 中的 `viewType`（把空值同步成显式值），
若需恢复干净状态，用 `test-vault/.obsidian/plugins/data-show/data.json` 覆盖
`test-vault-local/` 下的同名文件即可。

## 3. 代码架构（src/）

```
main.ts ── 装配与注册
  │
  ├─ settings.ts        设置页：看板定义管理（名称/分类/说明 + 视图模式下拉 + 增删/恢复默认）
  │
  ├─ dsql/  （DSQL 语言层，零 Obsidian 依赖，可独立测试）
  │    lexer.ts         词法：**关键词**（含视图三关键词 TABLE_VIEW/LIST_VIEW/CARD_VIEW）/
  │                     %运算符% / '字符串' / "路径" / 裸标识符 / $变量$
  │    parser.ts        语法：前件关系驱动（书写顺序自由、每条至多一次；
  │                     SELECT 可省略默认 *，FROM 为唯一必填，WHERE/SORT/LIMIT 以 FROM 为前件）
  │    ast.ts           语法树定义（Query.view: ViewType）
  │    types.ts         唯一类型出口：共享类型 / 常量 / EMPTY 哨兵（见下）
  │    functions.ts     内置函数：sqrt / cbrt / root / contains / length / lower / upper / empty
  │    executor.ts      执行：两遍模型（聚合遍 → 投影遍），非致命语义（错误 → null + warnings）
  │
  ├─ index/  （索引层）
  │    scanner.ts       基于 metadataCache 的全量首扫 + 增量监听（debounce）
  │    row-builder.ts   frontmatter → 行（原样入行，不改写业务字段；摄取归一：
  │                     未赋值 → EMPTY 哨兵，空容器 "" / [] → null）
  │    store.ts         行仓库：缓存 + 变更通知（订阅者自动重跑）+ 摄取警告归档
  │    frontmatter.ts   原文扫描：frontmatter 顶层重复键检测（摄取容错）
  │
  └─ ui/  （表现层）
       panel.ts         看板面板：头部 → DSQL 编辑器（防抖自动保存 + 视图反向同步）→
                        工具条（刷新/视图切换）→ 结果区（按视图类型分派到三个视图组件）
       sidebar.ts       看板侧栏：按分类分组展示设置中的看板
       utils/viewSync.ts     视图双向同步：applyViewType / detectTypeFromSql / normalizeSqlView
       views/table-view.ts   表格视图（只读，行点击跳转原文）
       views/list-view.ts    列表视图（只读，文件名 + 缩进子信息）
       views/card-view.ts    卡片视图（Kanban 看板，独占内联编辑，派生列只读）
       views/frontmatter-modal.ts  属性编辑弹窗：读 metadataCache → stringifyYaml → parseYaml 校验
                             → processFrontMatter 原子写回
```

**分层依赖**（单向，不得反向依赖）：

```
main.ts / settings.ts ──► ui/ ──┐
   │                            ├──► dsql/（types.ts）
   └──────────► index/ ─────────┘
```

- `src/dsql/` **零 Obsidian 依赖**：不 import `obsidian`，保证可在 Node 独立测试；
- `src/dsql/types.ts` 是**唯一类型出口**：共享类型与常量统一在此定义，各文件不重复声明；
- `src/ui/views/*-view.ts` 是**纯 TS 工厂函数**（`renderXxxView(...): HTMLElement`），不引入前端框架；
- `ui/` 不直接依赖 `index/`：行仓库（store）经插件实例由 `main.ts` 装配注入，表现层源码零 `@index/*` 引用；
- 跨层引用一律走路径别名 `@dsql/*` / `@index/*` / `@ui/*`（tsconfig、esbuild、测试运行器三处同构配置）。

### 数据流

```
笔记变更（含卡片视图内联编辑写回 frontmatter）
  → scanner 增量监听（debounce）→ row-builder 构造行 → store 更新并广播
  → panel 订阅重跑 DSQL → executor 出结果 → 表格/列表/卡片渲染
```

看板定义（名称/分类/说明/DSQL/视图类型 `viewType`）只存插件 `data.json`；
面板 DSQL 防抖自动保存后触发侧栏刷新，外部变更经 `onExternalChange` 同步。

## 4. 构建与测试

```bash
npm install
npm run dev     # watch 模式：src / manifest.json / styles.css 变化即重建，并同步到两个测试库
npm run build   # tsc 类型检查 + esbuild 生产构建 → dist/main.js
npm test        # 单测七套件（零 Obsidian 依赖）
```

- **构建流程**：`esbuild.config.mjs` 以 `src/main.ts` 为入口，产出 `dist/main.js`；
  构建完成后把 `main.js` / `manifest.json` / `styles.css` 复制到
  `test-vault-local/.obsidian/plugins/data-show/` 与 `test-vault/.obsidian/plugins/data-show/`
  （目录不存在则创建）。watch 模式下额外监听 `manifest.json` 与 `styles.css`。
- **测试流程**：`scripts/test.mjs` 用 esbuild 把 `tests/all.ts` 打包成临时 CJS 文件，
  交给 node 执行后删除临时文件。新套件必须**手动注册到 `tests/all.ts`**（非自动扫描）。

  > 验证看板 SQL 不能直接用 `node` 跑 TS：`src/dsql/parser.ts` 用了参数属性
  > （`constructor(private tokens: Token[])`），node 的 strip-only 模式不支持，必须经 esbuild 打包。

- **测试套件**（共 106 例）：

| 套件 | 领域 | 例数 |
|---|---|---|
| `tests/feature.test.ts` | 功能示例（子句、排序、链接、布尔与日期、自动列） | 22 |
| `tests/math.test.ts` | 数学示例（四则、乘方取模、函数、比较逻辑、TOTAL） | 29 |
| `tests/dsql-language.test.ts` | DSQL 语言示例（词法、语法、错误路径） | 22 |
| `tests/store.test.ts` | 行仓库（增删改、订阅通知） | 4 |
| `tests/ingest.test.ts` | 摄取层（重复键、摄取归一、摄取警告） | 4 |
| `tests/viewSync.test.ts` | 视图与 SQL 双向同步 | 15 |
| `tests/normalizeBoard.test.ts` | 看板字段校形 | 10 |

### 验收方式

用 Obsidian 打开 `test-vault-local/`（已部署本工程插件 `data-show`），
按 `test-vault-local/README.md` 的说明逐项验收：看板加载、DSQL 查询、视图切换、卡片编辑。
`test-vault/` 为干净提交库，不用于日常测试。

## 5. 文档索引

| 文档 | 说明 |
|---|---|
| [README.md](README.md) | 项目总览、单目录结构、快速开始、核心功能 |
| 本文（[ARCHITECTURE.md](ARCHITECTURE.md)） | 架构分层、数据流、构建与测试流程 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 开发 / 版本 / 文档 / 提交规范 |
| [API.md](API.md) | Obsidian 官方 API + 插件 API |
| [CHANGELOG.md](CHANGELOG.md) | 更新日志 |
| [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md) | DSQL 语法与语义权威规范 |
| [test-vault/README.md](test-vault/README.md) | 演示库看板清单与验收步骤 |

## 6. 现状

**已实现**（2.1.1 / DSQL 2.0）：DSQL 查询（表达式 / 函数 / 多级排序 / 自定义优先级 / 调试信息）、
TOTAL 全表聚合与 `$变量$` 派生体系、三种「无」语义分家（正常值 / 空容器 / 未赋值）、
别名唯一性校验、frontmatter 重复键容错、表格 / 列表 / 卡片三视图、卡片视图内联编辑、
视图切换与 SQL 双向同步、索引增量更新。

**规划**：统一记录在根目录 [`TODO`](TODO)（v2.0 已落地，当前已清空）。
