# datashow-dev 更新日志（测试版）

测试版（`data_show_test/`，插件 id `datashow-dev`）的开发日志：记录功能演进、
语法变更与测试情况，比正式版详细。迁移到正式版的功能见 `../data_show/CHANGELOG.md`。

> **当前状态**（2026-09）：本目录当前测试版 **1.7.001**（下一轮迁移候选）。

## 1.7.001（清理，待验收迁移）

- 移除未实装视图类型的死代码：`PLANNED_VIEWS`（board/card/calendar/stats）
  及其下拉灰显项——正式版本就未包含，清理后两目录对齐；
  未实现功能的规划统一记录在工作区根目录 `TODO` 文件（当前留空）。

## 1.6.001（插件测试版，已随 1.7.0 迁移至正式版）

- **minAppVersion 1.4.0 → 1.4.4**：属性编辑依赖的 `fileManager.processFrontMatter`
  官方标注 @since 1.4.4，原声明在 1.4.0–1.4.3 上会运行报错；
- **`workspace.revealLeaf` 全部改为 `await`**：该 API 自 1.7.2 返回 Promise，
  官方要求 await 以确保视图完全加载（避免 deferred leaf 未就绪）；
- **`metadataCache.on("resolved")` 仅首次全量重建**：该事件在启动后每次批量修改
  解析完成都会再触发，原先每次都全量扫描；之后统一走增量路径（flush 已重算反向链接）；
- **现代化写法统一**：`vault.getAbstractFileByPath` → `getFileByPath`（带类型返回值）、
  `workspace.getLeaf(true)` → `getLeaf('tab')`（字符串形式为推荐写法）；
- 已知不修：`processFrontMatter` 保存会规范化重写整个 YAML（官方行为，属性弹窗文案提示即可）。

## 工程重构（未升版本，随 1.6.0）

- **测试按示例三大类重组**：`tests/sql.test.ts` 拆分为 `feature.test.ts`（功能示例 22 例）、
  `math.test.ts`（数学示例 9 例）、`dsql-language.test.ts`（DSQL语言示例 12 例），
  共享数据提取到 `helpers.ts`；连同 `store.test.ts` 共 47 例全部通过。
- **演示 vault 各自独立**：本目录 `test-vault/` 与 `../data_show/test-vault/` 内容一致
  （示例数据与预置看板按 功能示例 / 数学示例 / DSQL语言示例 三大类组织），但各自只部署本工程插件
  （曾尝试共用同一 vault，实测报错，已回退为双 vault 结构）。

## 1.4.001（插件测试版，已随 1.6.0 迁移至正式版）

- **frontmatter 属性编辑**（看板数据直接改，保存后索引增量更新、查询结果自动刷新）：
  - 表格视图：双击可编辑单元格（直接 frontmatter 字段）→ 输入框 → 回车保存（Esc 取消、失焦还原）；
    空值 → null，true/false 字面量、数字自动转型，其余存为字符串；数组列不可内联编辑；
  - 列表视图：点击条目打开属性编辑弹窗；表格行悬停出现 ✎ 铅笔，点击同样打开；
  - 属性弹窗：官方 API 全链路——`metadataCache` 读 → `stringifyYaml` 展示 →
    `parseYaml` 校验（失败显示错误不写入）→ `fileManager.processFrontMatter` 原子写回；
    Ctrl/Cmd+Enter 快捷保存；
  - 手动刷新按钮沿用工具条「刷新」。
- 官方 API 核对：`processFrontMatter`（obsidian.d.ts:2954）、`parseYaml`（:4817）、`stringifyYaml`（:6815）。

## DSQL 1.3.001（语言版本测试修订，插件仍为 1.4.0）

- 评审项落地（H1–H3 / M1–M3 / L1–L4）：
  - EBNF 勘误：`OP_ADD` 多余空格；优先级表 `%||%` 管道转义；
    `sort_item` 文法改为 `{ sort_modifier }`（方向与 **BY** 各至多一次、先后不限，与实现一致）；
  - 语义补全：`comparison` 裸操作数真值语义正式写入；键级方向继承子句级方向、均无默认 **ASC**；
    数字不支持科学计数法与负数字面量（词法即如此，补文档）；
  - 行为微调（含实现改动）：空 `**BY** ()` 视为无自定义优先级并计入 warnings；
    SELECT `*` 自动列排序改用 UTF-8 字节序（原为 JS 默认序，增补平原字符集外更严谨）；
  - 调试 `from` 描述明确为「源解析后的命中行数（去重后）」；
- §7 新增示例：键级方向 + 子句级方向 + 多个 custom_order 组合；
- 测试：41 + 4 例通过（新增空 BY 警告、自动列字节序 2 例）。

## 1.4.0（与正式版同步的基线）

- **DSQL 子句解析改为前件关系驱动**（修复面板报「预期 \*\*SELECT\*\*，实际为 \*\*FROM\*\*」）：
  - 书写顺序自由，每条子句至多一次；WHERE / SORT / LIMIT 以 `**FROM**` 为前件；
  - `**SELECT**` 可省略（默认 `*` 全字段自动列），`**FROM**` 成为唯一必填子句；
  - `**WITHOUT** **ID**` 可写在任意子句位置；
  - 前件缺失报「需要 \*\*FROM\*\* 作为前件」，重复子句报「子句重复出现」，均带行列号。
- **测试**：`npm test` 39 + 4 例，新增子句语义 6 例、跨目录多组数据 6 例
  （兄弟目录隔离、多组并/交、跨组多级排序、字段缺失、数值表达式、多源调试统计）。
- **test-vault 扩充**：Projects/Alpha、Projects/Beta、Archive/2025、Inbox 多项目结构；
  任务笔记补互链（outlinks 反查可出结果）与日期/布尔/数组字段；README 验收清单 18 条。
- **看板数据**：data.json 预置 12 个看板（任务 2、演示 6、跨项目 4），即点即看。
- **调试信息**：SELECT 投影期字段缺失由面板收集并入 FIELD 条目（与执行期合并去重）。
- **设置**：新增「小数显示位数」（非负整数，默认 4；超出浮点精度重置默认；仅显示层）。
- **docs**：DSQL-EBNF v1.2 修订 3（前件文法、省略 SELECT、示例与错误表同步）。

## 1.2.001 及以前（开发期 0.1.0 → 1.0.1，2026-09-06 ~ 09-08）

### 0.1.0（2026-09-06）插件骨架

- 前期调研 Dataview / Datacore / Breadcrumbs 源码与维护现状，产出架构方案
  （五层单向依赖 + ADR 决策记录，方案文档已废弃删除）。
- P1 脚手架：manifest / esbuild / tsconfig / test-vault 热更新；
- 插件设置页（常规项）；侧栏树（`DataShow` 目录下 .md 即面板，子目录即分组，事件自动刷新）；
  主区面板视图（board 视图骨架 + 正文 Markdown 渲染）；ribbon 图标与命令。

### 0.2.0（2026-09-06）看板模型引入

- 看板改为在**插件设置**中定义（名称/类型/作用描述），首次安装自带空白「默认看板」；
- 侧栏改为展示设置中的看板（按类型分组），点击在主工作区打开；看板数据目录 `DataShow` 仅作约定；
- 明确边界：看板定义在设置、侧栏显示看板名、面板展示看板概览。

### 0.3.0（2026-09-07）索引层 + DSQL 前身打通

- 看板组成收敛为**数据 / 模板 / 规则**（关系由模板表达），数据部分存放自定义 SQL，
  SQL 从散落各笔记改为插件集中管理；
- 索引层：metadataCache 全量首扫 + `changed/deleted/renamed` 增量监听（300ms debounce），
  行仓库（笔记=行，frontmatter=列，file.* 虚拟列含出/入链），订阅通知；
- 自研 SQL v1 子集：`TABLE|LIST ... FROM 路径/#标签 [OR|AND] WHERE 表达式 SORT LIMIT`，
  内置 contains/length/lower/upper/empty，中文（Unicode）标识符，错误带行列号；
- 面板新增「查询结果」区：表格/列表渲染、文件名点击跳转、索引变化自动重跑；
- 测试 10 例（DSQL）+ 4 例（store）；DSQL 语法参考写入 test-vault README。

### 0.4.0（2026-09-07）面板编辑化（DSQL 定名）

- 看板模型精简为 `名称 + 类型 + 说明 + SQL`，模板/规则**彻底移除**；
- 查询语言正式定名 **DSQL**（DataShow Query Language）；
- DSQL 编辑器移入看板面板（等宽输入、防抖 500ms 自动保存），设置页只留名称/类型/说明；
- 工具条：刷新按钮（手动重跑）；视图类型下拉（表格/列表实装，可覆盖语句类型并持久化；
  看板卡片墙/卡片/日历/统计标规划中）；结果区独立刷新不打断编辑。

### 0.5.0（2026-09-07）排序规范化 + 测试补全 + EBNF

- **SORT 改 UTF-8 字节序确定性排序**：逐字节比较、公共前缀递归下降、短者在前；
  数字按数值、null 恒排末尾；`=`/`!=` 定义为字节精确匹配（区分大小写）；
- 测试扩至 DSQL 25 例 + store 4 例（期间修正解析器多余子句静默忽略的 bug，补 EOF 校验）；
- 新增 `docs/DSQL-EBNF.md` v1：词法/语法 EBNF、语义、排序规范、错误清单、与 Dataview DQL 差异。

### 0.6.0（2026-09-07）SORT BY 优先级 + 调试信息

- `**SORT** 字段 **BY** ('值1','值2',...)` 自定义优先级（此版本作用于首键）；
- 执行期调试收集（FROM 命中 / WHERE 过滤 / SORT 详情 / LIMIT 截断 / FIELD 字段缺失），
  设置新增「显示 DSQL 调试信息」开关（默认开），面板折叠展示；
- 测试 32 + 4 例；EBNF 升 v1.1。

### 0.7.0（2026-09-07）DSQL v1.2 大版本（标记语法字面化）

- 关键词/函数 `**WORD**` 包裹、运算符 `%op%` 包裹、字符串单引号、路径双引号；
  未知 `**WORD**` 词法报错；**不兼容 v1.1 旧写法**；
- `**SELECT**` 成为必须子句，视图 TABLE/LIST 缺省 TABLE，`*` 全字段，
  投影支持任意表达式 + `**AS**` 别名（无别名：字段用路径名，表达式为 列N）；
- 完整表达式：乘方右结合、取模、连接 `%||%`、比较族、一元正负；非致命语义（类型不匹配/除零/缺字段 → null）；
- 内置函数新增 sqrt / cbrt / root(x, n)；多级排序（键级方向）；调试对象
  `{ from, where, sort, limit, fieldMisses, executionTimeMs }`；
- 测试重写 25 + 4 例。

### 0.8.0（2026-09-08）v1.2 修订 2

- 数据源 **AND 优先于 OR**（两级文法，括号可覆盖）；
- `**BY**` 优先级改为**作用于其书写的排序键**（方向与 BY 书写顺序不限）；
- `**contains**` 改为**区分大小写**（数组严格 `===`，字符串子串），
  忽略大小写用 `**contains**(**lower**(字段), '值')`；
- 乘方结果非有限数（负数开偶次方）→ null；null 比较语义明确（参与 → false，%!=% 取反，null == null → true）；
- 调试扩展：`warnings`（非致命问题+次数）、`sourceStats`（逐叶子源行数）、where 剔除示例（≤3）、
  sort 比较次数；解析错误统一 `[DSQL]` 前缀；
- 测试 29 + 4 例。

### 1.0.0（2026-09-08）正式版发布 + 目录重组

- 工作区拆分为 `data_show/`（正式版，插件 id `data-show`，v1.0.0）与
  `data_show_test/`（本草稿目录，插件 id `datashow-dev`），二者可在同一 vault 共存；
- 正式版清理开发痕迹：统一文件头、移除测试/方案/test-vault 等开发产物，仅保留必要注释；
- 正式版附 `versions.json`、干净的用户 README 与 DSQL-EBNF 规范文档。

### 1.0.1（2026-09-08）移除旧版兼容

- 删除 `migrateBoard`（sections.data → sql 的开发期数据迁移），替换为纯字段校形 `normalizeBoard`；
  v1.1 时代遗留数据不再做任何回退转换。
