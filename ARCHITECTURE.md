# DataShow 整体架构

> 本文是工程的权威架构说明。当前版本：插件 **2.3.1** · 语言 **DSQL 2.6** · minAppVersion **1.4.4**。

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
├── tests/               单元测试（十四套件）
├── scripts/test.mjs     测试运行器
├── docs/                DSQL 语言规范
├── dist/                构建产物（不入库）
├── test-vault/          干净演示库（入库，仅提交用）
├── test-vault-local/    本地测试库（不入库，日常验收用）
├── manifest.json  package.json  tsconfig.json  versions.json
├── esbuild.config.mjs   styles.css
└── README.md  ARCHITECTURE.md  CONTRIBUTING.md  API.md  CHANGELOG.md + changelog-<起始>-<最后>.log（归档）
```

**两个演示库的分工**：

| 目录 | 用途 | 是否入库 |
|---|---|---|
| `test-vault-local/` | 日常在 Obsidian 中实际验收（看板加载、查询、视图切换、卡片编辑）。测试产生的改动都留在这里 | ❌（`.gitignore` 排除） |
| `test-vault/` | 干净版本，仅用于版本提交，不用于日常测试 | ✅ |

两者预置看板一致（67 个），按 功能示例 / 数学示例 / DSQL语言示例 / 三值示例 / 跨文件示例 /
跨文件夹示例 / ext示例 / search示例 / WHILE示例 / 审查修复示例 / 多变量抽取示例 十一大类组织，
示例数据在 `示例/` 下。
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
 │   │                  IFrontmatterHost / IYamlCodec / IStorageHost / IExportHost /
 │   │                  IUiHost / IExtSourceHost / IRowSource / PanelDeps / SidebarDeps /
 │   │                  SettingsTabDeps）
 │   └─ obsidian/       宿主适配器（import "obsidian" 的合法位置之一）
 │       ├─ vault-host.ts        metadataCache + vault → IVaultHost（反向链接按事件失效、惰性重算）
 │       ├─ ext-source-host.ts   vault 全文件列表 + metadataCache + cachedRead → IExtSourceHost
 │       ├─ file-meta.ts         TFile → IFileMeta 共享映射（vault-host / ext-source-host 共用）
 │       ├─ opener.ts            workspace.openLinkText → IOpener
 │       ├─ frontmatter-host.ts  processFrontMatter → IFrontmatterHost（数据侧）
 │       ├─ yaml-codec.ts        parseYaml / stringifyYaml → IYamlCodec
 │       ├─ storage-host.ts      loadData / saveData → IStorageHost（key 槽位）
 │       └─ ui-host.ts           Notice + 控制台 → IUiHost
 ├─ core/                可移植核心（零宿主依赖）
 │   ├─ dsql/            DSQL 语言层（别名 @dsql/*；独立 tsconfig，可独立发版）
 │   │   ├─ types.ts     语言层类型出口：DataRow / FileMeta / FieldValue / FieldObject / EMPTY / ViewType
 │   │   │               + DomainSlotValue（域扩展槽位值的显示层标记，语言层不读）
 │   │   ├─ coerce.ts    §6.3 值语义单一事实源：隐式数值转换 / 比较 / 真值 / UTF-8 字节序 / empty 传播
 │   │   ├─ expr.ts      表达式求值：evaluateExpr / resolveField（面板渲染与执行器共用）
 │   │   ├─ source.ts    FROM 判定与 [ext] 读取范围收集（matchSource / collectExtFilters / EXT_ALL）
 │   │   ├─ domains.ts   域扩展执行器（DSQL 2.6）：子域绑定求值 → YIELD 展开 → 行展开 → 顶层投影（输出列标签在此定稿）
 │   │   └─ lexer.ts / parser.ts / ast.ts / functions.ts / executor.ts
 │   └─ index/
 │       ├─ store.ts     行仓库：缓存 + 变更通知 + 摄取警告归档
 │       ├─ row-builder.ts   IFileMeta + frontmatter → DataRow（摄取归一）
 │       ├─ frontmatter.ts   原文扫描：frontmatter 顶层重复键检测
 │       ├─ yaml-fallback.ts 自研 YAML 子集解析器（零依赖纯函数，只服务非 md 路径）
 │       ├─ body.ts          正文抽取纯函数（SEARCH 用）：md 剥 frontmatter、非 md 剥围栏块
 │       └─ ext-source.ts    [ext] 文件级读取 + body 预读：FROM 目录收集 → 按后缀分派两条解析路径
 ├─ controller/
 │   └─ indexer.ts       索引器：订阅 IVaultHost → 构造行（先检重复键）→ 写 DataStore（300ms 防抖）
 ├─ render/              纯 UI（只吃 Deps，零 obsidian import）
 │   ├─ panel-view.ts    面板：DSQL 编辑器 + 工具条 + 结果区分派
 │   ├─ sidebar-view.ts  侧栏：看板分组清单与折叠持久化
 │   └─ table-view.ts / list-view.ts / card-view.ts    三视图渲染
 │       （list-view 的投影列两分 splitListColumns：内容列进主行、辅助列进缩进子行，列不丢弃）
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
npm test        # 单测十四套件（零 Obsidian 依赖）
```

- **构建流程**：`esbuild.config.mjs` 以 `src/main.ts` 为入口，产出 `dist/main.js`；
  构建完成后把 `main.js` / `manifest.json` / `styles.css` 复制到
  `test-vault-local/.obsidian/plugins/data-show/` 与 `test-vault/.obsidian/plugins/data-show/`
  （目录不存在则创建）。watch 模式下额外监听 `manifest.json` 与 `styles.css`。
- **测试流程**：`scripts/test.mjs` 用 esbuild 把 `tests/all.ts` 打包成临时 CJS 文件，
  交给 node 执行后删除临时文件。新套件必须**手动注册到 `tests/all.ts`**（非自动扫描）。

  > 验证看板 SQL 不能直接用 `node` 跑 TS：`src/core/dsql/parser.ts` 用了参数属性
  > （`constructor(private tokens: Token[])`），node 的 strip-only 模式不支持，必须经 esbuild 打包。

- **测试套件**（共 348 例）：

| 套件 | 领域 | 例数 |
|---|---|---|
| `tests/feature.test.ts` | 功能示例（子句、排序、链接、布尔与日期、自动列） | 22 |
| `tests/math.test.ts` | 数学示例（四则、乘方取模、函数、比较逻辑、TOTAL） | 32 |
| `tests/dsql-language.test.ts` | DSQL 语言示例（词法、语法、错误路径、前件约束、两池隔离） | 31 |
| `tests/store.test.ts` | 行仓库（增删改、订阅通知） | 4 |
| `tests/ingest.test.ts` | 摄取层（重复键、摄取归一、摄取警告） | 5 |
| `tests/indexer.test.ts` | 索引器（全量重建去重、删除 / 重命名清警告、resolved 不双跑） | 4 |
| `tests/ext-source.test.ts` | [ext] 后缀过滤（语法、三态、分派、范围、求值、自研解析器） | 64 |
| `tests/search.test.ts` | SEARCH 正文抽取（语法、STRING 词法、正则、求值、冲突、body 来源、§6.3 补丁） | 40 |
| `tests/while.test.ts` | WHILE 循环驱动（语法、词法隔离、迭代语义、边界 parse 期校验、SEARCH 耦合、TOTAL/COUNT 口径） | 20 |
| `tests/count.test.ts` | COUNT 分类计数（语法、槽位模型、口径、惯用法、错误路径） | 23 |
| `tests/domains.test.ts` | 域扩展（词法硬约束、块与 YIELD 语法、作用域宽松/严格、不可传递性、IN/DIFF 展开、行展开基数、输出显示口径、§7 十项验收） | 48 |
| `tests/viewSync.test.ts` | 视图与 SQL 双向同步 | 15 |
| `tests/normalizeBoard.test.ts` | 看板字段校形 | 10 |
| `tests/export.test.ts` | 结果导出（路径解析、列结构、行搜索文本、过滤、JSON 类型保留、CSV 转义与 CRLF、搜索命中行导出、empty 值四面口径）+ 列表视图列分组（内容列 / 辅助列） | 30 |

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
| [CHANGELOG.md](CHANGELOG.md) | 更新日志（近期版本 + 归档导航；划分规范见 CONTRIBUTING §6.3） |
| [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md) | DSQL 语法与语义权威规范 |
| [test-vault/README.md](test-vault/README.md) | 演示库看板清单与验收步骤 |

## 6. 现状

**已实现**（插件 2.3.1 / DSQL 2.6）：DSQL 查询（表达式 / 函数 / 多级排序 / 自定义优先级 / 调试信息）、
TOTAL 全表聚合与 `$变量$` 派生体系、三种「无」语义分家（正常值 / 空容器 / 未赋值）、
别名唯一性校验、frontmatter 重复键容错、`[ext]` 后缀过滤与非 md 数据源（自研 YAML 解析）、
SEARCH 正文抽取子句（DSQL 2.4 起由 WHILE 驱动）、WHILE 循环驱动子句、
COUNT 分类计数与槽位模型、域扩展（块 `{ }` 子域声明 + `**YIELD**` 的 `**IN**` / `**DIFF**` 跨域逐行关系，
DSQL 2.6）、表格 / 列表 / 卡片三视图、卡片视图内联编辑、
视图切换与 SQL 双向同步、索引增量更新、host 依赖模式分层（宿主能力收敛于 `host/obsidian`，
核心层零 Obsidian 依赖）、侧栏搜索栏（分类 / 看板名过滤、保留折叠、隐藏空组）、
三视图通用搜索（`.datashow-row` 统一行标记 + DOM 后置过滤，切视图保留搜索词）、
结果导出（JSON / CSV，`src/render/export.ts` 纯函数 + `IExportHost` 新增宿主接口，越界 / 绝对路径 / `.xlsx` 拒绝）。

**规划**：统一记录在根目录 [`TODO`](TODO)（v2.0 已落地，当前已清空）。
