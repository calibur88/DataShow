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
  看板定义 `data.json` 是核心资产，**必须入库**；
- `src/` 按 host 依赖模式分层，新增代码必须落在下列目录之一：

| 目录 | 职责 | 可 `import "obsidian"` |
|---|---|---|
| `src/host/types.ts` | 宿主接口与依赖契约的唯一出口（纯类型） | ❌ |
| `src/host/obsidian/` | 宿主适配器（vault / opener / frontmatter / yaml / storage / ui） | ✅ |
| `src/core/dsql/` | DSQL 语言层（别名 `@dsql`；独立 tsconfig，可独立发版） | ❌ |
| `src/core/index/` | 行仓库、行构造、frontmatter 扫描（别名 `@index`） | ❌ |
| `src/controller/` | 索引器：宿主事件 → 行仓库 | ❌ |
| `src/render/` | 纯 UI：面板、侧栏、三视图 | ❌ |
| `src/views/` | Obsidian 视图壳与设置页、视图类型常量 | ✅ |
| `src/settings/` | 设置与看板内容的形状、默认值、校形迁移 | ❌ |
| `src/utils/` | 与业务无关的纯工具 | ❌ |
| `src/main.ts` | 只做装配（new 适配器 → 注入 → 注册） | ✅ |

- 跨层引用一律走路径别名：`@dsql` / `@index` / `@host` / `@controller` / `@render` /
  `@views` / `@settings` / `@utils`，三处同构配置（`tsconfig.json`、`esbuild.config.mjs`、
  `scripts/test.mjs`），新增别名必须三处同步。

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

> 验证看板 SQL 不能直接用 `node` 跑 TS：`src/core/dsql/parser.ts` 用了参数属性，
> 必须经 esbuild 打包（见 `scripts/test.mjs`）。

## 5. 文档更新规范（变更时必须同步的清单）

任何功能 / 语法 / 版本变更，逐项核对并同步以下文件，**禁止只改源码不改文档**：

| 文件 | 需更新的内容 |
|---|---|
| `README.md` | 版本号、DSQL 版本、视图类型说明、核心功能描述 |
| `ARCHITECTURE.md` | 版本头、架构图、分层说明、测试套件与例数 |
| `API.md` | BoardDef 结构、导出签名、版本号、渲染入口 |
| `CHANGELOG.md` | 新增条目（按「插件更新 / DSQL 更新」两类组织，格式见 §6） |
| `docs/DSQL-语言规范.md` | 语法产生式、关键词表、语义规则、版本号 |
| `test-vault/README.md` | 看板清单、可复制示例、操作说明 |
| `manifest.json` / `versions.json` / `package.json` | 版本号 |
| `TODO` | 落地后清空对应条目；未完成项保留 |

## 6. CHANGELOG 编写规范

更新日志按版本倒序排列，每个版本包含「插件更新」与「DSQL 更新」两个一级分类。

### 6.1 格式模板

````markdown
# 更新日志

## [x.y.z] - YYYY-MM-DD

### 插件更新

**功能/模块名称**：简述该变更的核心价值（一句话）

- 详细展开第一项，说明改了什么地方、为什么改、影响范围；
- 详细展开第二项，如果涉及多个子项，用列表罗列；
- 详细展开第三项，确保每一条都具备可验证性（用户能据此验收）；
- 若该变更属于破坏性变更，须在条目末尾用 `**破坏性**` 标注。

**另一个功能/模块名称**：简述

- 同上，保持条目粒度适中（不宜过粗也不宜过碎）；
- 每个版本内各条目的顺序按重要程度排列。

### DSQL 更新

**语法/语义变更名称**：简述

- 新增 / 修改 / 废除的语法规则说明；
- 对已有查询的影响（兼容/不兼容）；
- 对应的语言规范章节更新情况（如 §6.3 三值语义）。

**内置函数/运算符变更**：简述

- 同上，保持与「插件更新」相同的列表粒度。
````

### 6.2 撰写细则

| 规则 | 说明 |
| :--- | :--- |
| **标题层级** | `## [x.y.z] - YYYY-MM-DD` 作为版本标题；其下 **`### 插件更新`** 与 **`### DSQL 更新`** 固定两级分类。 |
| **版本号** | 插件版本号（三段式），与 `manifest.json` / `package.json` / `versions.json` 保持一致。 |
| **日期格式** | `YYYY-MM-DD`，本地时区，勿跨日写错。 |
| **条目粒度** | 每个变更条目用 `**加粗标题**：简述` 开头，下方用 `-` 列表展开详细说明。若变更简单（如仅版本号递增），可省略列表，直接写简述。 |
| **破坏性变更** | 须在条目末尾用 `**破坏性**` 显式标注，并在正文开头用 `> **破坏性大版本**` 单独警示（如 DSQL v2.0 条目）。 |
| **测试情况** | 每个版本末尾须标注测试通过情况（如“测试：106 例（七套件）全部通过”）。 |
| **版本兼容声明** | 若当前版本与上一版本功能兼容，在版本末尾声明（如“**本版本功能逻辑与 2.0.x 完全兼容**”）。 |
| **禁止编造** | 不确定是否重复的条目一律保留，禁止编造或删除历史条目。 |

## 7. 代码编写规范

- **类型出口两处，互不重复**：宿主接口与依赖契约统一定义在 `src/host/types.ts`；
  语言层类型统一定义在 `src/core/dsql/types.ts`（`DataRow` / `FieldValue` / `EMPTY` / `ViewType`）；
  禁止各文件散落重复定义；
- **零宿主依赖**：`src/core/`（含 `dsql/`）、`src/controller/`、`src/settings/`、`src/utils/`
  一律不 import `obsidian`，保证可在 Node 独立测试；
  DSQL 词法 / 语法 / 执行逻辑改动必须同步 [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md) 与测试；
- **`import "obsidian"` 只有三处合法**：`src/main.ts`、`src/views/`、`src/host/obsidian/`；
  其余目录出现即视为架构违规；
- **依赖注入，不反向依赖**：`render/` 只吃 `PanelDeps` / `SidebarDeps`，`views/` 只吃插件装配好的契约，
  任何层都不得 `import` 插件主类（`main.ts`）；
- **宿主能力走接口**：新增宿主能力（读写文件、打开、提示、持久化等）先在 `host/types.ts` 声明接口，
  再在 `host/obsidian/` 实现，`main.ts` 装配注入，业务层不得直接调用宿主 API；
- **视图组件为纯 TS 工厂函数**：`src/render/*-view.ts` 导出 `renderXxxView(...): HTMLElement`
  或 `createXxxController(...)`，不引入前端框架（无 Svelte / React）；新视图类型在
  `src/render/panel-view.ts` 的 `renderResultByView` 分派；
- **归一 / 校形**：看板字段校形在 `normalizeBoard`（`src/settings/normalize.ts`）完成；
  整块设置校形在 `normalizeSettings`（同上）；
  视图双向同步工具在 `src/utils/viewSync.ts`（纯函数，可独立测试）；
- **非致命语义**：类型不匹配、除零、字段缺失等运行期问题一律求值为 null 并计入 `warnings`，
  不中断查询；只有词法 / 语法错误才是致命错误；
- **注释与文档用中文**；代码语法字符（引号、路径、键名）用 ASCII 直引号；
  注释保持技术说明风格（用途、参数、边界条件），不写过程性叙事。

## 8. 注释规范

注释的目的是解释 **"为什么"** ，而不是"是什么"。好代码本身应自解释其"是什么"和"怎么做"。

### 8.1 注释类型与使用场景

| 注释类型 | 语法 | 使用场景 |
| :--- | :--- | :--- |
| **文件头** | `/** ... */` | 每个 `.ts` 文件顶部，说明模块职责 |
| **函数注释** | `/** ... */` | 所有导出函数、类方法（公开 API） |
| **行内注释** | `//` | 解释复杂逻辑、边界条件、临时方案 |
| **TODO/FIXME** | `// TODO:` / `// FIXME:` | 标记待办事项或已知问题 |
| **警示注释** | `// ⚠️` | 标记容易误用的 API 或危险操作 |

### 8.2 格式规范

**文件头（必须）：**

```typescript
/**
 * @module dsql/executor
 * @description DSQL 执行器，按 FROM → WHERE → SORT → LIMIT → SELECT 管线执行查询
 */
```

**函数注释（导出函数必须）：**

````typescript
/**
 * 对卡片视图应用搜索过滤
 *
 * @param container - 卡片视图的根容器元素
 * @param keyword - 搜索关键词（已 trim，非空）
 * @returns 匹配的卡片数量
 *
 * @example
 * ```ts
 * const matched = applyCardFilter(container, '待办');
 * ```
 */
export function applyCardFilter(container: HTMLElement, keyword: string): number {
  // ...
}
````

**必须包含：** `@param` 描述每个参数，`@returns` 描述返回值
**可选包含：** `@example` 使用示例

**行内注释：**

```typescript
// ✅ 好：解释"为什么"
// empty 值需要特殊处理，因为它是"键存在但未赋值"的状态

// ❌ 坏：重复代码本身
// 将 card 的 display 设为 none
card.style.display = 'none';
```

### 8.3 绝对禁止的注释类型

| 禁止类型 | ❌ 错误示例 |
| :--- | :--- |
| 重构说明 | `// 重构：将 query 目录重命名为 dsql` |
| 优化说明 | `// 优化：拆分双目录为单目录` |
| 迁移说明 | `// 从 data_show_test 迁移而来` |
| 变更日志 | `// 2026-09-07: 新增搜索功能` |
| 个人署名 | `// @author calibur88` |
| 注释掉的代码 | `// if (oldView === 'TABLE') { ... }` |

### 8.4 语言要求

- **注释正文使用中文**
- **代码中的语法字符使用 ASCII 直引号**
- **中文与英文/数字之间不加空格**

## 9. 测试规范

- 测试套件位于 `tests/`，新套件必须**手动注册到 `tests/all.ts`**
  （项目用自定义 `scripts/test.mjs` + 显式 import，非 vitest / jest 自动扫描）；
- 套件按领域组织：功能示例 / 数学示例 / DSQL 语言 / store / 摄取层 / viewSync / normalizeBoard；
- 语法 / 语义变更必须同步新增或修改 `dsql-language.test.ts` 用例（含错误路径与边界）；
- 提交前 `npm test` 全绿；测试例数变化（如「80 → 106」）同步到 README 与 ARCHITECTURE。

## 10. git 提交规范

- **提交信息用中文**，标题一句概括（如「DSQL v2.0：视图三关键词 + 卡片看板视图」），
  正文以要点列出关键变更；
- 构建产物（`dist/`、`main.js` / `manifest.json` / `styles.css` 的部署副本）由 `.gitignore` 排除，
  **不入库**；看板定义 `data.json` 需入库（核心资产）；
- 本地测试库 `test-vault-local/` 已由 `.gitignore` 排除，不得入库；
- 推送到 `origin/master`；若 push 卡在凭据弹窗，用 `GIT_TERMINAL_PROMPT=0 git push` 走缓存凭据。

## 11. Git 同步与提交流程

**核心原则：未经用户明确许可，不得执行任何 `git add`、`git commit` 或 `git push` 操作。**

### 11.1 本地开发阶段

- 所有变更仅保留在工作区，AI 不得主动暂存或提交；
- 构建产物（`dist/`、同步到两个测试库的部署副本）由 `.gitignore` 排除，**不入库**；
- 本地测试库 `test-vault-local/` 已由 `.gitignore` 排除，**不入库**。

### 11.2 验收前置条件

- 代码与文档变更完成后，**必须先在 Obsidian 中打开 `test-vault-local/` 实际验收**：
  - 看板列表正常加载；
  - DSQL 查询结果正确；
  - 视图切换（表格/列表/卡片）正常；
  - 卡片视图内联编辑可保存并刷新；
- 验收通过后，由**用户明确告知「可以推送」**，才允许执行 Git 提交操作。

### 11.3 提交流程

```bash
# 1. 用户确认“可以推送”后，检查当前变更
git status

# 2. 仅提交用户确认的文件（不包括 test-vault-local/、dist/ 等）
git add <确认的文件路径>
git commit -m "<中文标题>：<概要描述>"

# 3. 推送至远程仓库
git push origin master
```

### 11.4 提交信息规范

- **标题**：一句中文概括，如「DSQL v2.0：视图三关键词 + 卡片看板视图」；
- **正文**：以要点列出关键变更，体例与 CHANGELOG 条目一致（`**加粗标题**：简述` 形式）；
- **禁止提交的内容**：`dist/`、`test-vault-local/`、`*.log`、`node_modules/`；
- **必须提交的内容**：`data.json`（看板定义）、`src/` 源码、`tests/` 测试、根目录文档。

### 11.5 推送到 GitHub

若 push 卡在凭据弹窗，执行以下命令走缓存凭据：

```bash
GIT_TERMINAL_PROMPT=0 git push
```

## 12. 本地测试与恢复

- 测试时面板操作（切换视图 / 编辑 SQL）会把 `viewType` 的空值反向同步成显式值，
  这是预期行为，会污染 `test-vault-local/.obsidian/plugins/data-show/data.json`；
- 需要恢复干净状态时，用 `test-vault/.obsidian/plugins/data-show/data.json`
  覆盖 `test-vault-local/` 下的同名文件；
- 提交前确认 `test-vault/` 下的 `data.json` 未被本地测试改动。
