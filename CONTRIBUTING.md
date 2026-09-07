# 开发与更新规范（CONTRIBUTING）

> 本文是 DataShow 项目的**开发、版本、文档与 git 提交的统一规范**，
> 与 [README.md](README.md)（总说明）、[ARCHITECTURE.md](ARCHITECTURE.md)（架构）配合阅读。

## 1. 文档地图

| 文档 | 职责 |
|---|---|
| [README.md](README.md) | 项目总览、单目录结构、快速开始、核心功能 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架构分层、数据流、构建与测试流程 |
| 本文（[CONTRIBUTING.md](CONTRIBUTING.md)） | 开发 / 版本 / 文档 / 提交规范 |
| [API.md](API.md) | Obsidian 官方 API + 插件 API |
| [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md) | DSQL 语言权威语法与语义 |
| [CHANGELOG.md](CHANGELOG.md) | 更新日志 |
| [test-vault/README.md](test-vault/README.md) | 演示库看板清单与验收步骤 |
| `TODO` | 待办 / 规划项（仅在有规划时非空） |

## 2. 工程结构约定

- 工程为**单一插件工程**：源码、测试、脚本、文档、演示库都在根目录，插件 ID 统一为 `data-show`；
- `test-vault-local/` 用于**本地验收**，不入库；`test-vault/` 是**干净提交库**，不用于日常测试；
- 构建产物（`dist/main.js` 与同步进两个测试库的部署副本）不入库；
  看板定义 `data.json` 是核心资产，**必须入库**。

## 3. 版本号规则

### 3.1 插件版本（三段式 `x.y.z`）

- 版本号体现在三处，**必须同步**：`manifest.json`、`package.json`、`versions.json`；
- `versions.json` 结构：`{ "插件版本": "minAppVersion" }`，每次发版追加一条；
- `manifest.json` 的 `id` 恒为 `data-show`，`author` / `repo` 等元信息不得改动；
  同理 `package.json` 的 `author` / `repository` / `license` 与 `LICENSE` 全文不得改动。

### 3.2 DSQL 语言版本（与插件版本独立）

- DSQL 语言版本记于 [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md)，独立演进
  （如插件 `1.8.0` 曾实现 DSQL `1.5`）；
- 破坏性语法变更（废除关键词 / 改语义）必须升大版本，并在 CHANGELOG 与语言规范中显著标注「不兼容」。

## 4. 开发流程

```bash
npm install
npm run dev     # watch 模式，产物自动同步到两个测试库
npm test        # 单测七套件全绿
npm run build   # 类型检查 + 生产构建
```

1. 在根目录 `src/` 中开发，涉及语法或语义的改动同步更新 `tests/` 对应用例；
2. `npm test` + `npm run build` 通过后，用 Obsidian 打开 `test-vault-local/` 实际验收；
3. 验收通过后更新 CHANGELOG 与相关文档，再提交 git。

> 验证看板 SQL 不能直接用 `node` 跑 TS：`src/query/parser.ts` 用了参数属性，
> 必须经 esbuild 打包（见 `scripts/test.mjs`）。

## 5. 文档更新规范（变更时必须同步的清单）

任何功能 / 语法 / 版本变更，逐项核对并同步以下文件，**禁止只改源码不改文档**：

| 文件 | 需更新的内容 |
|---|---|
| `README.md` | 版本号、DSQL 版本、视图类型说明、核心功能描述 |
| `ARCHITECTURE.md` | 版本头、架构图、分层说明、测试套件与例数 |
| `API.md` | BoardDef 结构、导出签名、版本号、渲染入口 |
| `CHANGELOG.md` | 新增条目 |
| `docs/DSQL-语言规范.md` | 语法产生式、关键词表、语义规则、版本号 |
| `test-vault/README.md` | 看板清单、可复制示例、操作说明 |
| `manifest.json` / `versions.json` / `package.json` | 版本号 |
| `TODO` | 落地后清空对应条目；未完成项保留 |

## 6. CHANGELOG 编写规范

- 标题 `## x.y.z（当前）`，旧条目下沉；日期统一 `YYYY-MM-DD`（本地时区，勿跨日写错）；
- 只写事实：改了什么、影响范围、测试情况；破坏性变更必须显式标注「破坏性大版本」与「不兼容」说明；
- 不确定是否重复的条目**一律保留**，禁止编造或删除历史条目。

## 7. 代码编写规范

- **类型出口唯一**：共享类型与常量统一定义在 `src/types.ts`，禁止各文件散落重复定义；
- **`src/query/` 零 Obsidian 依赖**：不 import `obsidian`，保证可在 Node 独立测试；
  该目录的词法 / 语法 / 执行逻辑改动必须同步 [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md) 与测试；
- **视图组件为纯 TS 工厂函数**：`src/views/*-view.ts` 导出 `renderXxxView(...): HTMLElement`，
  不引入前端框架（无 Svelte / React）；新视图类型在 `panel.ts` 的 `renderResultByView` 分派；
- **归一 / 校形**：看板字段校形在 `normalizeBoard`（`src/types.ts`）完成；
  视图双向同步工具在 `src/utils/viewSync.ts`（纯函数，可独立测试）；
- **非致命语义**：类型不匹配、除零、字段缺失等运行期问题一律求值为 null 并计入 `warnings`，
  不中断查询；只有词法 / 语法错误才是致命错误；
- **注释与文档用中文**；代码语法字符（引号、路径、键名）用 ASCII 直引号；
  注释保持技术说明风格（用途、参数、边界条件），不写过程性叙事。

## 8. 测试规范

- 测试套件位于 `tests/`，新套件必须**手动注册到 `tests/all.ts`**
  （项目用自定义 `scripts/test.mjs` + 显式 import，非 vitest / jest 自动扫描）；
- 套件按领域组织：功能示例 / 数学示例 / DSQL 语言 / store / 摄取层 / viewSync / normalizeBoard；
- 语法 / 语义变更必须同步新增或修改 `dsql-language.test.ts` 用例（含错误路径与边界）；
- 提交前 `npm test` 全绿；测试例数变化（如「80 → 106」）同步到 README 与 ARCHITECTURE。

## 9. git 提交规范

- **提交信息用中文**，标题一句概括（如「DSQL v2.0：视图三关键词 + 卡片看板视图」），
  正文以要点列出关键变更；
- 构建产物（`dist/`、`main.js` / `manifest.json` / `styles.css` 的部署副本）由 `.gitignore` 排除，
  **不入库**；看板定义 `data.json` 需入库（核心资产）；
- 本地测试库 `test-vault-local/` 已由 `.gitignore` 排除，不得入库；
- 推送到 `origin/master`；若 push 卡在凭据弹窗，用 `GIT_TERMINAL_PROMPT=0 git push` 走缓存凭据。

## 10. 本地测试与恢复

- 测试时面板操作（切换视图 / 编辑 SQL）会把 `viewType` 的空值反向同步成显式值，
  这是预期行为，会污染 `test-vault-local/.obsidian/plugins/data-show/data.json`；
- 需要恢复干净状态时，用 `test-vault/.obsidian/plugins/data-show/data.json`
  覆盖 `test-vault-local/` 下的同名文件；
- 提交前确认 `test-vault/` 下的 `data.json` 未被本地测试改动。
