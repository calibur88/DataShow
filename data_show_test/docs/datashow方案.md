# datashow 插件方案（v0.2 草案）

> **定位**：通用 Obsidian 社区插件，是 **Dataview / Datacore（元数据索引 + 查询 + 视图渲染）** 与
> **Virtual Content（Property 匹配规则注入）** 的整合与迭代替代。
> 不绑定任何领域内容（不预设 type 体系、目录规范或字段集合），数据与语义完全由用户的 vault 决定。
>
> **一句话**：Markdown 即数据，datashow 负责索引、查询、渲染与规则注入。

---

## 1. 设计原则

| 原则 | 含义 |
|---|---|
| 数据中立 | 插件不拥有、不解释任何业务字段；`type`、`up`、`status` 等对插件只是普通列 |
| Markdown First | 数据只存于 frontmatter 与正文，插件不建私有数据库；卸载插件数据仍在 |
| 核心零依赖 | 查询引擎、索引层不依赖第三方运行时库（自研 SQL，无 alasql/sql.js/React） |
| 注册表扩展 | 视图类型、函数库、规则匹配器、注入位置均为注册表模式，可扩展 |
| 渐进兼容 | 旧生态数据（Dataview 内联字段、Breadcrumbs 关系字段）可读、不改写 |

---

## 2. 总体架构（已确定）

五层单向依赖，每层只依赖下层暴露的接口：

```
┌──────────────────────────────────────────────────────────┐
│  L5 入口层  main.ts：注册代码块/编辑器扩展/命令/设置页        │
├──────────────────────────────────────────────────────────┤
│  L4 表现层  render/（视图渲染）   rules/（规则注入）         │
│             —— 两者互不依赖，都只调用 L2/L3 的接口           │
├──────────────────────────────────────────────────────────┤
│  L3 语言层  query/：SQL 方言 lexer → parser(AST) → executor │
│             纯函数、无 Obsidian 依赖、可独立单测              │
├──────────────────────────────────────────────────────────┤
│  L2 数据层  index/：scanner（事件）→ row-builder（行构造）→  │
│             store（行仓库 + 订阅）                           │
├──────────────────────────────────────────────────────────┤
│  L1 平台层  Obsidian API：vault / metadataCache / CM6      │
└──────────────────────────────────────────────────────────┘
        ↘ api.ts：对外公开 API（其他插件 / 自定义面板）
```

**数据流**：

```
vault 文件事件 → scanner（debounce）→ 行构造 → store 更新
                                     ↓ subscribe
        代码块处理器 / 规则引擎 → SQL 执行 → 视图渲染 → DOM
```

### 架构决策记录（ADR）

| # | 决策 | 理由 | 放弃的备选 |
|---|---|---|---|
| A1 | 自研 SQL 方言 | 语法/函数/语义完全可控，可加中文标识符、领域扩展点 | alasql、sql.js（SQLite WASM） |
| A2 | 无 UI 框架，原生 DOM + Obsidian 组件 | 包体小、移动端友好、避免 Datacore 式 React 重渲染复杂度 | React（Datacore）、Svelte（Breadcrumbs V4） |
| A3 | 增量索引走 metadataCache | 官方缓存已解析 frontmatter/链接，自己只做行构造 | 自行全文件重扫 |
| A4 | 行仓库（笔记=行，属性=列）+ 订阅 | 与 SQL 模型同构，规则引擎和视图共用一个数据源 | 文档型存储、图查询 |
| A5 | 视图类型注册表 | TABLE/LIST 内置，新视图（卡片/日历/图）按注册接入，不改核心 | 硬编码 switch-case |
| A6 | 规则引擎独立于渲染层 | 规则本质是"匹配→注入内容"，内容里嵌什么视图由注册表决定 | 规则与视图耦合 |
| A7 | Breadcrumbs 仅元数据兼容 | 导航视图不重复造轮子，字段原样保留即兼容 | 自实现面包屑/树/图 |
| A8 | 内联字段自研解析（P6+） | Dataview 的 `Key:: Value` 语法简单，可读旧数据 | 依赖 Dataview |

---

## 3. 目录结构

```
E:\datashow\datashow\
├── manifest.json
├── package.json / tsconfig.json
├── esbuild.config.mjs           # 构建 + test-vault 热更新
├── src/
│   ├── main.ts                  # L5 入口：装配各层、注册处理器
│   ├── types.ts                 # 全部公共接口与数据类型（唯一类型出口）
│   ├── index/                   # L2 数据层
│   │   ├── scanner.ts           #   全量首扫 + metadataCache 增量事件（debounce）
│   │   ├── row-builder.ts       #   metadataCache 结果 → DataRow（含 file.* 虚拟列）
│   │   └── store.ts             #   行仓库 + 订阅（subscribe / version）
│   ├── query/                   # L3 语言层（零 Obsidian 依赖）
│   │   ├── lexer.ts             #   分词（支持中文/任意 Unicode 标识符）
│   │   ├── ast.ts               #   AST 类型定义
│   │   ├── parser.ts            #   递归下降解析 → AST
│   │   ├── executor.ts          #   AST + this 上下文 → 行集
│   │   └── functions.ts         #   内置函数注册表（contains 等，可扩展）
│   ├── render/                  # L4 表现层
│   │   ├── codeblock.ts         #   ```datashow 代码块处理器（解析→执行→视图→刷新）
│   │   ├── view-registry.ts     #   视图类型注册表
│   │   └── views/               #   内置视图：table.ts、list.ts
│   ├── rules/                   # L4 规则引擎（Virtual Content 重写）
│   │   ├── engine.ts            #   规则求值：匹配器 → 命中 → 取注入内容
│   │   ├── note-rule.ts         #   笔记内声明规则的解析
│   │   ├── matcher-registry.ts  #   匹配器注册表（is / contains / in / regex …）
│   │   └── injector.ts          #   注入点定位（Footer/Header）+ 内容渲染（复用 render）
│   ├── settings.ts              # 设置页（内联前缀、性能开关、预留全局规则等）
│   └── api.ts                   # 对外 API（getRows / execute / registerView / registerFunction）
├── tests/                       # lexer / parser / executor / row-builder 单测（node 环境）
└── test-vault/                  # 手工验收库：通用示例笔记（无领域绑定）
```

---

## 4. 核心接口（架构确定的具体化）

```ts
// ---- L2：行与仓库 ----
interface DataRow {
  path: string;                        // 主键
  file: FileMeta;                      // path/name/folder/links/outlinks/inlinks/size/ctime/mtime
  fields: Record<string, FieldValue>;  // frontmatter 全部键值，数组保持数组，链接为 LinkValue
}
type FieldValue = string | number | boolean | FieldValue[]
  | LinkValue | null;                  // LinkValue = { target, display?, resolved }

interface Store {
  rows(): Iterable<DataRow>;
  row(path: string): DataRow | undefined;
  version(): number;                   // 全局版本号，视图据此判断是否重渲染
  subscribe(scope: string, cb: () => void): Unsubscribe;  // scope 可为路径/文件夹，定向刷新
}

// ---- L3：查询 ----
interface QueryEngine {
  parse(source: string): Query;                  // 语法错误带行列号
  execute(q: Query, ctx: DataRow): ResultSet;    // ctx 即 this
}

// ---- L4：视图注册表 ----
interface ViewRegistry {
  register(name: string, view: ViewFactory): void;   // "table" | "list" | 自定义
}

// ---- L4：规则引擎 ----
interface RuleEngine {
  rulesFor(path: string): InjectedRule[];        // 返回命中该笔记的规则
}
```

---

## 5. SQL 方言（v1 语法草案，示例为通用内容）

```
查询   := VIEW [WITHOUT ID] 列清单 FROM 源 [WHERE 表达式] [SORT 字段 ASC|DESC] [LIMIT n]
VIEW   := TABLE | LIST                       （注册表可扩展）
源     := 路径 | 标签 | 源 OR 源 | 源 AND 源 | ( 源 )
表达式 := 比较 / 函数调用 / AND OR NOT / 括号
比较   := 操作数 (= | != | > | < | >= | <=) 操作数
操作数 := 字段路径（this.name / file.name / 涉及人物）| 字面量 | 函数调用
```

通用示例（对应旧生态的典型用法，无领域绑定）：

```sql
-- 通用表：某文件夹下按属性过滤
TABLE status AS 状态, owner AS 负责人
FROM "Projects"
WHERE status = "active"
SORT file.name ASC

-- 反查链接引用（Virtual Content 规则最常用的语义）
LIST
FROM "Notes" OR "Inbox"
WHERE contains(file.outlinks, this.file.link)

-- 标签数据源 + 数组字段 contains
TABLE rating AS 评分
FROM #book
WHERE contains(tags, "favorite")
```

要点：
- `this` = 代码块/规则所在笔记的行，`this.file.name`、`this.<任意字段>` 均可用；
- `contains(a, b)` 对数组/字符串统一语义；
- 中文及任意 Unicode 标识符一等公民；
- 语法错误带行列号，代码块内直接显示错误而非静默空白；
- EBNF 全文与错误用例在 P3 开工前作为独立文档交付确认。

---

## 6. 渲染层与规则引擎

### 渲染层
- ` ```datashow ` 代码块：解析 → 执行 → 视图渲染；store 版本变化时只刷新受影响实例；
- 内置视图 TABLE（`AS` 别名表头、`WITHOUT ID` 隐藏首列）与 LIST；
- 视图注册表公开，未来卡片/日历/看板等以新视图形式接入，不动核心。

### 规则引擎（Virtual Content 重写）
- **匹配**：任意 Property 匹配（`is` / `contains` / `in` / `regex`，注册表可扩展），不绑定 `type` 字段本身；
- **声明**：v1 为笔记内 frontmatter 声明（数据随笔记走，天然可版本控制）；全局规则文件作为预留能力；
- **注入**：Footer / Header（注册表可扩展 Section 等）；
- **渲染**：注入内容中的 ` ```datashow ` 代码块复用渲染管线；Reading 与 Live Preview 双模式；
- **防递归**：注入内容不再触发规则匹配，避免套娃。

---

## 7. 兼容性策略

| 旧生态 | datashow 策略 |
|---|---|
| Dataview frontmatter 数据 | 直接可用（同一数据源） |
| Dataview `Key:: Value` 内联字段 | P6+ 自研解析，可读旧笔记，不要求用户改数据 |
| ` ```dataview ` 旧代码块 | 不自动接管（避免语义差异事故）；评估提供 `datashow-compat` 别名渐进迁移 |
| Breadcrumbs 关系字段（up/down/next…） | 原样保留进 fields，Breadcrumbs 继续工作 |
| Virtual Content 规则 | 规则语义对齐（Property 匹配 + Footer 注入），声明方式迁移到笔记内 frontmatter |

---

## 8. 分阶段交付

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| P1 脚手架 | 插件模板 + esbuild + test-vault 热更新 | Obsidian 可加载、改动自动重载 |
| P2 数据层 | 全量首扫、增量更新、store + 订阅 | 通用示例笔记可被索引，事件增量正确 |
| P3 语言层 | EBNF 草案 → 确认 → lexer/parser/executor + 单测 | §5 全部示例可解析执行，错误信息带行列号 |
| P4 渲染层 | 代码块处理器 + TABLE/LIST + 定向刷新 | 索引变更后视图自动更新 |
| P5 规则引擎 | 笔记内声明 + 匹配器注册表 + Footer 注入 | 命中规则自动渲染注入内容，双模式可用 |
| P6 扩展 | api.ts 公开、内联字段解析、内联查询 | 其他面板可消费 store/query |

---

## 9. 风险与决策记录

- **性能**：大库（1 万+ 笔记）首扫依赖 metadataCache（Obsidian 自身异步），行构造为轻量映射，风险低；executor 的 FROM 需按文件夹/标签建倒排，避免全表扫（P3 设计内）。
- **移动端**：无框架 + 无 WASM，天然兼容。
- **语义差异**：与 DQL 的行为差异（字符串比较、空值处理等）在 EBNF 文档中逐条列明，确认后实现，不做隐性兼容。
- **规则递归/循环**：注入内容不触发规则（§6），代码块不做嵌套执行。
- **维护边界**：L3 语言层零依赖纯函数，是长期最稳定资产；Obsidian API 变化只影响 L1/L2 适配面。

---

## 10. 修订记录

### R1（2026-09-07）：看板模型确定 + DSQL 定名

- 查询语言正式命名 **DSQL**（DataShow Query Language），即本方案 §5 的 SQL 方言。
- **看板模型确定**：看板 = `名称 + 类型 + 说明 + DSQL`，模板/规则字段**彻底移除**
  （关系由模板/视图表达、规则由 DSQL 语法本身覆盖，不设独立配置块）。
- **编辑位置确定**：DSQL 在**看板面板**中编辑（防抖自动保存），设置页只维护看板身份信息
  （名称/类型/说明）与增删管理；SQL 统一由 datashow 集中管理，不散落在笔记中。
- **视图类型注册表启动**：第一版实装 `表格 table / 列表 list`（默认跟随 DSQL 的 TABLE/LIST
  关键字，可在面板下拉覆盖）；`看板卡片墙 board / 卡片 card / 日历 calendar / 统计 stats`
  为规划项（下拉灰显）。对应 ADR A5。
- 面板含「刷新」按钮用于手动重跑查询；结果区独立于编辑器刷新，编辑不被打断。

### R2（2026-09-07）：排序规范 + 测试补全 + EBNF 文档

- **SORT 排序规范确定**：采用 **UTF-8 编码字节序**（通用解码方案）——字符串按 UTF-8
  字节逐一比较，公共前缀相等则递归下降比较后续字节，短者在前；数字按数值，null 恒排
  最后（DESC 即最前），排序稳定。跨平台/跨语言结果确定，不再依赖 locale。
  （`docs/DSQL-EBNF.md` §3.5 为权威定义。）
- `=`/`!=` 定义为 UTF-8 字节精确匹配（区分大小写）；`contains()` 保持忽略大小写。
- **测试补全**：`tests/sql.test.ts` 25 例（结构/数据源/表达式/函数/排序语义/错误处理/
  中文标识符）+ `tests/store.test.ts` 4 例（仓库行为），`npm test` 统一入口。
- **EBNF 文档**：`docs/DSQL-EBNF.md`——词法、语法、语义、排序规范、错误清单、
  与 Dataview DQL 差异对照，作为后续演进的权威依据。
- ```datashow 代码块：确认不做（看板统一处理），从计划中移除。

### R3（2026-09-07）：SORT BY 自定义优先级 + DSQL 调试信息

- **SORT BY**：`SORT 字段 [ASC|DESC] BY (字面量列表)`（方向 BY 前后均可）——列表内值按
  位置排序（字节精确匹配），列表外值排后按默认序，null 仍恒最后，DESC 整体反转。
  满足"状态 = 已完成/进行中…"这类人工定义的优先级排序。
- **DSQL 调试信息**：executor 增加 debug 选项，逐操作收集条目
  （FROM 命中 / WHERE 过滤 / SORT 详情 / LIMIT 截断 / FIELD 字段缺失次数+示例）；
  设置开关「显示 DSQL 调试信息」（**默认开**），面板查询结果下方折叠展示，关闭零开销。
- 测试增至 36 例（DSQL 32 + store 4）；EBNF 升 v1.1。

### R4（2026-09-08）：DSQL v1.2 —— 标记语法字面化 + 表达式完备（重大版本）

依据用户提供的 v1.2 规范全量重写查询语言（lexer/parser/executor/测试/文档），**不兼容 v1.1**（用户决策：严格新语法，不做兼容层）：

- **标记语法字面化**：关键词与函数用 `**WORD**` 包裹（关键词大写、函数小写）、运算符用 `%op%`
  包裹（%==% %!=% %>% %<% %>=% %<=% %||% %+% %-% %*% %/% %%% %^%）、字符串单引号、路径双引号；
  未知 `**WORD**` 词法层直接报错。
- **SELECT 成为必须子句**：视图 TABLE/LIST 缺省 TABLE；`*` 全字段；投影为任意表达式 + `**AS**` 别名
  （无别名：字段用路径名，表达式为 列N）；执行顺序 FROM → WHERE → SORT → LIMIT → 投影。
- **表达式完备**：完整优先级（比较 < 连接 %||% < 加减 < 乘除取模 < 乘方右结合 < 一元 < NOT/AND/OR）；
  裸操作数真值判断保留（规范示例所需）。
- **函数**：新增 sqrt / cbrt / root(x,n)；运行期非致命语义（类型不匹配/除零/缺字段 → null）。
- **排序**：多级排序（键级方向优先）；BY 优先级作用于首键；null 恒沉底（不再随 DESC 翻转）；
  文件夹/标签匹配大小写不敏感。
- **调试对象**：{ from, where, sort, limit, fieldMisses[], executionTimeMs }，面板折叠展示，开关默认开。
- 测试重写为 v1.2 全覆盖 25 例（+store 4）；EBNF 文档升 v1.2（含与原规范的实现偏差标注）。

### R5（2026-09-08）：v1.2 修订 2 —— 用户规范的修正版落地

- **数据源 AND 优先于 OR**：源文法改两级（or_source / and_source），括号可覆盖。
- **SORT BY 逐键**：自定义优先级作用于其书写的排序键（方向与 BY 书写顺序不限；写在最后即最后一个键），替代此前"恒作用于首键"。
- **contains 区分大小写**：数组严格 `===` 匹配元素、字符串子串包含；忽略大小写用 `**contains**(**lower**(字段), '值')` 组合。
- **乘方安全**：结果非有限数（负数开偶次方）→ null。
- **null 比较语义明确**：参与比较 → false（%!=% 取反；null == null → true 同一性，即 `%==% null` 检空）。
- **调试对象扩展**：新增 `warnings`（非致命问题+次数）、`sourceStats`（逐叶子源行数）；where 附被剔除示例路径（≤3）；sort 附比较次数；解析错误统一 `[DSQL]` 前缀。
- 测试 33 例（DSQL 29 + store 4）全过；EBNF 文档同步为 v1.2 修订 2。
