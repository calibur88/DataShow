# 开发与更新规范（CONTRIBUTING）

> 本文是 DataShow 项目的**开发、更新、文档编写与 git 提交的统一规范**，
> 与根目录 [README.md](README.md)（总说明）、[ARCHITECTURE.md](ARCHITECTURE.md)（架构）配合阅读。
> 任何一次功能迭代 / DSQL 语法变更 / 版本升级，都应遵守本文约定。

## 1. 文档地图

| 文档 | 位置 | 职责 |
|---|---|---|
| 总说明 | `README.md` | 双目录结构、版本规则、快速开始 |
| 架构 | `ARCHITECTURE.md` | 整体架构、代码分层、数据流、构建测试 |
| 规范（本文） | `CONTRIBUTING.md` | 开发 / 更新 / 编写 / 提交规范 |
| API 参考 | `API.md` | Obsidian 官方 API + 插件 API |
| DSQL 规范 | `data_show/docs/DSQL-EBNF.md` | DSQL 语言权威语法（EBNF + 语义） |
| 正式版日志 | `data_show/CHANGELOG.md` | 从简，只写功能更新 |
| 测试版日志 | `data_show_test/CHANGELOG.md` | 详细，含测试情况 |
| 规划 | `TODO` | 待办 / 规划项（仅在有规划时非空） |

## 2. 双目录结构

| 目录 | 定位 | 插件 id | 说明 |
|---|---|---|---|
| `data_show/` | **正式版** | `data-show` | 清理后的插件工程，只含源码、构建配置与用户文档 |
| `data_show_test/` | **草稿开发目录** | `datashow-dev` | 新功能、DSQL 语法演进、测试与规范文档都在这里进行 |

- 两目录 src **保持同步**，唯一差异是 `main.ts` 头部约 8 行插件入口注释（正式版保留，测试版无）。
- 测试基础设施（`scripts/test.mjs`、`tests/`）**只在测试版**，迁移时不包含。
- 两者 id 不同，可在同一 vault 共存，各自配套独立演示 vault（`test-vault/`）。

## 3. 版本号规则

### 3.1 插件版本（三段式 `x.y.zzz`）

| 目录 | 规则 | 示例 |
|---|---|---|
| 正式版 | 末段为 `0`，无测试后缀 | `2.0.0` |
| 测试版 | `package.json` 版本号与正式版**对齐**（不随测试递增） | `2.0.0` |
| 测试版 CHANGELOG 条目 | 末段递增编号 | `2.0.001`、`2.0.002` |

- 正式版版本号体现在三处，**必须同步**：`manifest.json`、`package.json`、`versions.json`。
- `versions.json` 结构：`{ "插件版本": "minAppVersion" }`，升级时追加一条，如 `"2.0.0": "1.4.4"`。
- **只在用户明确允许后**才迁移到正式目录并把版本号定为 `x.y.0`；未经允许正式目录版本号不动。

### 3.2 DSQL 语言版本（与插件版本独立）

- DSQL 语言版本记于 `docs/DSQL-EBNF.md`，独立演进（如插件 `1.8.0` 曾实现 DSQL `1.5`）。
- 语言版本与插件版本**不绑定**，只是当前 DSQL v2.0 恰好由插件 2.0.0 实现。
- 破坏性语法变更（废除关键词 / 改语义）必须升大版本，并在 CHANGELOG 与 EBNF 中显著标注「不兼容」。

## 4. 开发流程（测试版先行）

1. 在 `data_show_test/` 开发，CHANGELOG 条目版本号末段递增（如 `2.0.001`）。
2. `npm test` + `npm run build` 通过后，在本工程 `test-vault/` 用 Obsidian 实际验收。
3. 经**用户明确允许**后迁移到 `data_show/`，版本号定为 `x.y.0`。
4. 两边 CHANGELOG 分别记录：正式版从简、测试版详细。

> 验证看板 SQL 不能直接用 `node` 跑 TS：`src/query/parser.ts` 用了参数属性，
> 必须经 esbuild 打包（见 `scripts/test.mjs`）。

## 5. 迁移流程（测试版 → 正式版）

1. **恢复 data.json**：测试时面板操作会污染 `viewType`（把空值写成显式值），
   迁移前用 `data.json.back` 覆盖 `data.json`（见 §11）。
2. **复制源码**：复制测试版的 `src/`（**不覆盖正式版 `main.ts`**）与 `styles.css`。
3. **同步演示数据**：复制标准 `data.json` 到正式版 vault 插件目录。
4. **更新版本号**：`manifest.json` / `package.json` → `x.y.0`，`versions.json` 追加一条。
5. **同步文档**：按 §6 清单更新 CHANGELOG / README / DSQL-EBNF / test-vault README。
6. **构建验证**：`cd data_show && npm run build`，确认产物已部署到正式版 test-vault。
7. **回归**：`cd data_show_test && npm test` 全绿，两目录 `diff -rq src` 仅 `main.ts` 差异。

## 6. 文档更新规范（更新时必须同步的清单）

任何功能 / 语法 / 版本变更，逐项核对并同步以下文件，**禁止只改源码不改文档**：

| 文件 | 需更新的内容 |
|---|---|
| 根 `README.md` | 版本号、DSQL 版本、视图类型说明、核心功能描述 |
| 根 `ARCHITECTURE.md` | 版本头、架构图、代码分层、测试套件数量、现状与规划 |
| 根 `API.md` | BoardDef 结构、导出签名、版本号、渲染入口 |
| `data_show/CHANGELOG.md` | 正式版条目（从简） |
| `data_show_test/CHANGELOG.md` | 测试版条目（详细） |
| `docs/DSQL-EBNF.md`（两目录） | 语法产生式、关键词表、语义规则、版本号 |
| `test-vault/README.md` | 看板清单、可复制示例、操作说明 |
| `manifest.json` / `versions.json` / `package.json` | 版本号 |
| `TODO` | 落地后清空对应条目；未完成项保留 |

## 7. CHANGELOG 编写规范

- **正式版**（`data_show/CHANGELOG.md`）：只写功能更新、从简，迁移了什么就写什么；
  标题 `## x.y.0（当前）`，旧条目下沉。
- **测试版**（`data_show_test/CHANGELOG.md`）：记录功能演进与测试细节，比正式版详细；
  顶部维护「当前状态」段说明版本对齐与已迁移项。
- 破坏性变更必须显式标注「破坏性大版本」与「不兼容」说明（如关键词废除、字段迁移）。
- 日期统一 `YYYY-MM-DD`（本地时区，勿跨日写错）。

## 8. 代码编写规范

- **类型出口唯一**：共享类型与常量统一定义在 `src/types.ts`，禁止各文件散落重复定义。
- **query/ 层零 Obsidian 依赖**：`src/query/` 不 import `obsidian`，保证可在 Node 独立测试。
- **视图组件为纯 TS 工厂函数**：`src/views/*-view.ts` 导出 `renderXxxView(...): HTMLElement`，
  不引入前端框架（无 Svelte/React）；新视图类型在 `panel.ts` 的 `renderResultByView` 分派。
- **注释与文档用中文**；代码语法字符（引号、路径、键名）用 ASCII 直引号。
- **归一/校形**：看板字段校形在 `normalizeBoard`（types.ts）完成；视图双向同步工具在
  `src/utils/viewSync.ts`（纯函数，可独立测试）。

## 9. 测试规范

- 测试套件位于 `data_show_test/tests/`，新套件必须**手动注册到 `tests/all.ts`**
  （项目用自定义 `scripts/test.mjs` + 显式 import，非 vitest/jest 自动扫描）。
- 套件按领域组织：功能示例 / 数学示例 / DSQL 语言 / store / 摄取层 / viewSync / normalizeBoard 等。
- 语法/语义变更必须同步新增或修改 `dsql-language.test.ts` 用例（含错误路径与边界）。
- 提交前 `npm test` 全绿；改动测试数量（如「80 → 106」）同步到 ARCHITECTURE 与 README。

## 10. git 提交规范

- **提交信息用中文**，标题一句概括（如「DSQL v2.0：视图三关键词 + 卡片看板视图」），
  正文以要点列出关键变更。
- 构建产物（`main.js` / `manifest.json` / `styles.css` 部署副本）由 `.gitignore` 排除，**不入库**；
  看板定义 `data.json` 与迁移快照 `data.json.back` 需入库（核心资产）。
- 推送到 `origin/master`；若 push 卡在凭据弹窗，用 `GIT_TERMINAL_PROMPT=0 git push` 走缓存凭据。

## 11. data.json.back 迁移快照机制

- 测试版 test-vault 下保留 `data.json.back` 作为**迁移标准快照**，与 `data.json` 同目录。
- Obsidian 只认 `data.json`，带其它扩展名的 `.back` 对它透明，不会被加载或改写。
- **用途**：每次测试（切换视图 / 编辑 SQL）会把 `viewType` 空值反向同步成显式值，
  污染看板定义。迁移前用 `.back` 覆盖 `data.json` 即恢复干净状态。
- 流程：测试完 → `cp data.json.back data.json` → 说「迁移」→ 直接推进迁移与提交。
