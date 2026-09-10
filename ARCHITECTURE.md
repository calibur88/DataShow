# DataShow 整体架构

> 本文是工程的权威架构说明。当前版本：插件 **2.1.4** · 语言 **DSQL 2.0** · minAppVersion **1.4.4**。

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
├── src/                 插件源码（唯一入口 src/main.ts；按 host / core / controller /
│                        render / views / settings / utils 分层，详见 §3）
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
main.ts                 装配：new 宿主适配器 → new 索引器 → registerView → 命令/ribbon
 ├─ host/
 │   ├─ types.ts        唯一类型出口：宿主接口与依赖契约（IFileMeta / IVaultHost / IOpener /
 │   │                  IFrontmatterHost / IFrontmatterEditor / IYamlCodec / IStorageHost /
 │   │                  IUiHost / IRowSource / PanelDeps / SidebarDeps / SettingsTabDeps）
 │   └─ obsidian/       宿主适配器（import "obsidian" 的合法位置之一）
 │       ├─ vault-host.ts        metadataCache + vault → IVaultHost（反向链接按事件失效、惰性重算）
 │       ├─ opener.ts            workspace.openLinkText → IOpener
 │       ├─ frontmatter-host.ts  processFrontMatter → IFrontmatterHost（数据侧）
 │       ├─ frontmatter-modal.ts Modal → IFrontmatterEditor（UI 侧：属性编辑弹窗）
 │       ├─ yaml-codec.ts        parseYaml / stringifyYaml → IYamlCodec
 │       ├─ storage-host.ts      loadData / saveData → IStorageHost（key 槽位）
 │       └─ ui-host.ts           Notice + 控制台 → IUiHost
 ├─ core/                可移植核心（零宿主依赖）
 │   ├─ dsql/            DSQL 语言层（别名 @dsql/*；独立 tsconfig，可独立发版）
 │   │   ├─ types.ts     语言层类型出口：DataRow / FileMeta / FieldValue / EMPTY / ViewType
 │   │   └─ lexer.ts / parser.ts / ast.ts / functions.ts / executor.ts
 │   └─ index/
 │       ├─ store.ts     行仓库：缓存 + 变更通知 + 摄取警告归档
 │       ├─ row-builder.ts   IFileMeta + frontmatter → DataRow（摄取归一）
 │       └─ frontmatter.ts   原文扫描：frontmatter 顶层重复键检测
 ├─ controller/
 │   └─ indexer.ts       索引器：订阅 IVaultHost → 构造行 → 写 DataStore（300ms 防抖）
 ├─ render/              纯 UI（只吃 Deps，零 obsidian import）
 │   ├─ panel-view.ts    面板：DSQL 编辑器 + 工具条 + 结果区分派
 │   ├─ sidebar-view.ts  侧栏：看板分组清单与折叠持久化
 │   └─ table-view.ts / list-view.ts / card-view.ts    三视图渲染
 ├─ views/               Obsidian 视图壳（import "obsidian" 的合法位置之一）
 │   ├─ panel.ts / sidebar.ts   ItemView 生命周期 + 依赖注入
 │   ├─ settings-tab.ts  PluginSettingTab 设置页
 │   └─ view-types.ts    视图类型常量与面板状态
 ├─ settings/            设置与看板内容（零宿主依赖）
 │   ├─ schema.ts        形状：DatashowSettings / BoardDef / SETTINGS_KEY / CONTENT_SCHEMA_VERSION
 │   ├─ defaults.ts      默认值与看板构造
 │   └─ normalize.ts     校形与版本迁移（normalizeBoard / normalizeSettings）
 └─ utils/
     └─ viewSync.ts      视图与 SQL 双向同步
```

**分层依赖**（单向，不得反向依赖）：

```
main ──► views ──► render ──► controller ──► core ──► host/types
  │                                                      ▲
  └──────────► host/obsidian ───────────────────────────┘

旁支：settings / utils 被 render / views / controller / core 引用，自身不依赖业务层；
      dsql 内部互引一律相对路径，外部经 @dsql/* 引用
```

| 层 | 约束 |
|---|---|
| `host/types` | 纯类型文件，禁止运行时值；跨层共享接口与契约的唯一声明位置 |
| `host/obsidian` | 仅依赖 `host/types` 与 `obsidian`；未文档化的运行时 API 需加守卫 |
| `core` | 禁止 `import "obsidian"`，禁止直接访问 DOM；函数在 Node 下可单测 |
| `controller` | 只依赖 `IVaultHost` 与 `DataStore`，不感知视图 |
| `render` | 只吃 Deps 与容器元素，不 import `obsidian`、不反向依赖 `main` |
| `views` | 只做生命周期与依赖注入；订阅在 `onClose` 成对注销 |
| `main` | 只做装配，业务逻辑一律下沉 |

- **可移植性**：换宿主只需重写 `main.ts` + `views/` + `host/obsidian/`（另需宿主提供 `createDiv` / `createEl` /
  `createSpan` / `addClass` / `toggleClass` / `isShown` 等 HTMLElement 原型扩展，或改用等价 DOM 工具），
  `core/` `controller/` `render/` `settings/` `utils/` 逐字不动；
- **类型出口**：宿主接口集中在 `host/types.ts`，语言层类型集中在 `core/dsql/types.ts`，两者不重复声明；
- **路径别名**：`@dsql/*` → `src/core/dsql/*`、`@index/*` → `src/core/index/*`，另有
  `@host` / `@controller` / `@render` / `@views` / `@settings` / `@utils`，
  在 `tsconfig.json` / `esbuild.config.mjs` / `scripts/test.mjs` 三处同构配置。

### 数据流

```
笔记变更 / 属性写回
  → IVaultHost 事件（resolved / changed / deleted / renamed）
  → VaultIndexer 防抖合并 → buildRow → DataStore 变更广播
  → panel 控制器订阅重跑 DSQL → executor 出结果 → render/三视图渲染
```

看板定义（名称/分类/说明/DSQL/视图类型 `viewType`）只存插件 `data.json` 的 `settings` 槽位；
面板 DSQL 防抖自动保存后触发侧栏刷新，外部变更经 `onExternalChange` 同步。
读写约定：读路径返回 `T | null` 由调用方降级，写路径 `reject(Error)` 且 message 可直接展示。

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

  > 验证看板 SQL 不能直接用 `node` 跑 TS：`src/core/dsql/parser.ts` 用了参数属性
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

**已实现**（2.1.4 / DSQL 2.0）：DSQL 查询（表达式 / 函数 / 多级排序 / 自定义优先级 / 调试信息）、
TOTAL 全表聚合与 `$变量$` 派生体系、三种「无」语义分家（正常值 / 空容器 / 未赋值）、
别名唯一性校验、frontmatter 重复键容错、表格 / 列表 / 卡片三视图、卡片视图内联编辑、
视图切换与 SQL 双向同步、索引增量更新、host 依赖模式分层（宿主能力收敛于 `host/obsidian`，
核心层零 Obsidian 依赖）。

**规划**：统一记录在根目录 [`TODO`](TODO)（v2.0 已落地，当前已清空）。
