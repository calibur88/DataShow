# DataShow 更新日志

## 2.1.0（当前，2026-09-07）—— 项目架构重构（单目录工程化）

- **工程结构优化**：工程由「正式版 + 开发版」双目录合并为**单目录工程**，
  源码、测试、脚本、文档与演示库统一放在根目录，插件 ID 统一为 `data-show`；
- **构建流程统一**：`esbuild.config.mjs` 以 `src/main.ts` 为入口、产出 `dist/main.js`，
  构建完成后自动把 `main.js` / `manifest.json` / `styles.css` 同步到
  `test-vault-local/`（本地测试库）与 `test-vault/`（干净提交库）；
  watch 模式额外监听 `manifest.json` 与 `styles.css` 的变化并自动重建同步；
- **测试流程统一**：`scripts/test.mjs` 修正为以项目根目录为基准，动态加载
  `tests/all.ts` 并执行全部单测；`tests/helpers.ts` 的测试库路径常量固定指向
  `test-vault-local`；`tsconfig.json` 的 `outDir` / `rootDir` 分别指向 `dist` / `src`；
- **演示库拆分**：本地验收用 `test-vault-local/`（不入库，测试改动不影响提交版本），
  提交用干净版本 `test-vault/`；两者 `.gitignore` 均排除构建产物、保留 `data.json` 与示例笔记；
- **代码清理**：删除编译期可证明未使用的导入；统一共享类型出口为 `src/types.ts`；
  清理测试库中残留的旧开发插件目录（`datashow-dev`），社区插件清单与看板 `viewType`
  统一到 `data-show` / DSQL v2.0 取值；
- **文档统一**：按单目录工程重写 `README.md` / `ARCHITECTURE.md` / `CONTRIBUTING.md` /
  `API.md`，DSQL 规范整理为 `docs/DSQL-语言规范.md`；
- **版本与兼容性**：`manifest.json`、`package.json`、`versions.json` 三处版本号统一为 `2.1.0`；
  **本版本功能逻辑与 2.0.x 完全兼容，不涉及 DSQL 语法变更，也不涉及看板视图与界面交互变更**，
  已有 `data.json` 看板定义可直接沿用；
- 测试：106 例（七套件）全部通过；`npm run build` 通过。

---

## 插件版本历史

### 2.0.0（DSQL v2.0 + 卡片视图 + 字段迁移，2026-09-07）

> **破坏性大版本**：DSQL 关键词 `TABLE` / `LIST` 直接报语法错误；看板定义 `viewOverride` 字段
> 在加载时迁移到 `viewType`（重命名，语义更明确）。演示库看板已全部同步更新。

- **DSQL 语言升级 v2.0**（规范见 `docs/DSQL-语言规范.md`）：
  - 视图关键词 `TABLE` / `LIST` 废除，新增 `TABLE_VIEW` / `LIST_VIEW` / `CARD_VIEW`
    （缺省 `TABLE_VIEW`）；旧 `**TABLE**` / `**LIST**` 直接抛 `LexError`「未知关键词」，不做兼容；
  - 三个 `*_VIEW` 关键词全部允许写进 SQL 并持久化到看板定义；
  - 执行层：三个视图走完全相同的数据管道，仅渲染不同；
  - 字符串字面量 `'**TABLE_VIEW**'` 等不参与视图识别（词法器天然隔离）。
- **新增卡片视图（CARD_VIEW）**：Kanban 看板布局——按首个可分组字段（如「状态」）拆列，
  列头显示彩色圆点 + 分组值 + 数量，列内堆卡片；卡片以文件名作标题（点击打开笔记），
  **单击字段值直接编辑 frontmatter**（回车保存 / Esc 取消 / 失焦还原）；派生列
  （TOTAL / 表达式 / 变量 / `file.*` / `this.*`）只读；保存走
  `app.fileManager.processFrontMatter` 原子写回，索引增量更新自动重跑结果。
- **表格 / 列表视图改为只读**：表格移除原双击单元格内联编辑，改为行级 click 打开笔记；
  列表改为点击文件名 / 行打开笔记，派生列作为缩进子信息（参考 Obsidian Bases 风格）。
- **视图切换与 SQL 双向同步**（`src/utils/viewSync.ts`）：
  - `applyViewType(board, newType)`：替换 / 注入 SQL 开头视图关键词 + 设置 `board.viewType`；
  - `detectTypeFromSql(sql)`：跳过前导空白与 `--` 注释行识别开头 VIEW 关键词（未命中返回 `null`）；
  - `normalizeSqlView(sql, type)`：纯函数，强制 SQL 开头关键词与 type 对齐（旧 `**TABLE**` / `**LIST**` 一并替换）；
  - 面板下拉切换 → 调 `applyViewType` → 保存 → 重渲染；SQL 编辑器防抖保存 → 调
    `detectTypeFromSql` 反向同步下拉选中态（空 SQL / 纯空白不切换，保持当前状态）。
- **字段迁移**：`Board.viewOverride` → **`Board.viewType`**（类型 `ViewType | ""`，空 = 跟随语句）；
  加载时按优先级迁移（`viewType` 合法值优先，非法 / 空时 `viewOverride` 兜底）并写回一次；
  `Board.type` 保持 `string` 不变——仍是用户自由填写的看板分类（侧栏分组依据）。
- **设置页**：新增「视图模式」下拉（跟随语句 / 表格 / 列表 / 卡片），与「看板分类」自由输入并存；
  「看板类型」标签改为「看板分类」。
- **演示库同步**：看板 18 → 20（新增「任务卡片」「数学卡片」两个 CARD_VIEW 示例），
  全部看板 SQL 已同步到 DSQL v2.0，`viewOverride` 字段已迁移为 `viewType`。
- 测试：106 例（七套件）；新增 `tests/viewSync.test.ts`（15 例）与 `tests/normalizeBoard.test.ts`（10 例），
  `tests/dsql-language.test.ts` 更新 view 字面量并新增旧关键词报错与字符串字面量边界用例。

### 1.8.0

- **DSQL 语言升级 v1.5：三值语义分家 / 别名唯一性 / 摄取容错**（插件版本不变，仅语言版本升级）：
  - 三种「无」正交定义：`0` / `false` 为**正常值**（仅裸真值判断为假，运算照常）；
    `null` 为**空容器**（`字段: ""` / `字段: []` 摄取为 null）；**empty 值**为**未赋值**
    （`字段:` 冒号后无内容），除 `**empty**()` 外一切运算按 null 传播；
  - 裸真值判断：`0` 由真改假（empty / null / 0 / false / 空串 / 空数组均为假）；
  - `**empty**(x)` 语义收窄为「仅当 x 未赋值时为真」，`""` / `[]` / `0` / `false` / null 均假；
  - NUMBER 词法收窄：`1.` 与 `.5` 为词法错误；
  - SELECT 别名唯一性：所有 `**AS**` 别名互不相同，且不得与行字段名冲突（致命错误，
    不限是否含 TOTAL 项）；已有看板若用 `价格 **AS** 价格` 这类同名别名需改别名；
  - frontmatter 重复键：该文件从结果集剔除并计入 `duplicateKey` 警告，查询继续；
  - warnings 结构化 `{ type, message }`，调试页按 `[type] message` 渲染。
- **DSQL 语言升级 v1.4：TOTAL 全表聚合 + $变量$ 派生体系**：
  - 两遍执行模型：聚合遍扫描 FROM 全量命中行（恒忽略 WHERE）计算 `**TOTAL**`；
    投影遍 WHERE / SORT / LIMIT / SELECT，`$变量$` 查变量表、裸标识符查行字段；
  - 语法：`**TOTAL** (字段|数字) **AS** 别名`（别名强制）；`$变量$` 仅 SELECT 内可引用；
    不可反向引用、TOTAL 内禁止引用变量；别名与行字段同名 → 致命报错；
  - 语义：数值求和（null / 缺失跳过、非数值跳过计入 warnings、空表 → null）；`TOTAL 1` = 总行数；
    仅含 TOTAL 项 → 单行「汇总」结果；派生列只读（列表视图以辅助信息行展示）；
  - 调试新增 AGG 行。
- **演示库同步**：新增 `示例/三值示例/`（正常零值 / 空容器 / 未赋值 三篇），
  预置看板 16 → 18（新增「三值示例」分组：三值展示、empty 谓词与三值传播）；
  看板定义 `data.json` 已纳入版本控制。
- 测试：80 例（五套件：功能 22 / 数学 29 / DSQL语言 21 / store 4 / 摄取层 4）。

### 1.7.0

- **最低版本要求提升为 Obsidian 1.4.4**：属性编辑依赖的 `fileManager.processFrontMatter`
  官方标注 @since 1.4.4，原 1.4.0 声明在 1.4.0–1.4.3 上会运行报错；
- 稳定性修缮：
  - `workspace.revealLeaf` 全部改为 `await`（该 API 自 1.7.2 返回 Promise，
    确保视图完全加载、避免 deferred leaf 未就绪）；
  - `metadataCache.on("resolved")` 改为仅首次全量重建，之后走增量路径
    （该事件在启动后每次批量修改解析完成都会触发，原先每次都全量扫描）；
- 写法现代化：`vault.getAbstractFileByPath` → `getFileByPath`、
  `workspace.getLeaf(true)` → `getLeaf('tab')`（均为官方推荐形式）；
- **结果区改为标签页**：「查询结果 / 调试信息」两个标签切换——原 `<details>` 折叠面板
  在移动端跟随正文长列表无法单独滚动，现调试列表限高 45vh 独立滚动；
- **「显示 DSQL 调试信息」默认改为关闭**（已保存过设置的用户不受影响）。

### 1.6.0

- frontmatter 属性编辑：表格视图双击单元格直接改属性（回车保存，自动转型）；
  列表视图点击条目或行内 ✎ 打开 YAML 属性编辑弹窗（官方 processFrontMatter 写回）；
  保存后索引增量更新、查询结果自动刷新；
- DSQL 语言规范升级 v1.3：空 `**BY** ()` 视为无自定义优先级并计入警告；
  SELECT `*` 自动列按 UTF-8 字节序排序；排序方向语义文档勘误（末尾方向属于最后一个键）。

### 1.4.0

- DSQL 子句改为按前件关系解析：书写顺序自由，`**SELECT**` 可省略（默认全字段）；
- `**WITHOUT** **ID**` 可写在任意子句位置，子句重复出现时报错（带行列号）；
- 查询结果调试信息并入 SELECT 投影期字段缺失提示；
- 设置新增「小数显示位数」；
- 视图下拉仅保留已实装的表格 / 列表；
- 新增效果验收 vault（`test-vault/`，构建自动同步插件产物）。

### 1.2.0

- 看板数据统一存插件 data.json，移除未使用的 DataShow 目录约定。

### 1.1.0

- 查询支持省略 SELECT 的列表视图与全字段自动列；
- 测试数据与示例看板完善。

### 1.0.0

- 首个正式版本：看板（名称 / 类型 / 说明 / DSQL）、看板侧栏与面板、
  metadataCache 增量索引、表格 / 列表视图、DSQL v1.2 标记语法；
- 正式版附 `versions.json`、干净的用户 README 与 DSQL 规范文档。

---

## 开发条目（原开发版日志）

### 1.8.001（DSQL 1.5：三值语义分家 / 别名唯一 / 摄取容错）

- **规范升 v1.5**，三处「无」的语义正交分家：`0` / `false` 为正常值（仅裸真值为假，
  `0 %+% 1 = 1` 照常）；`null` 为空容器值（摄取归一 `字段: ""` / `字段: []` → null；
  算术 → null + warning，比较 → false）；**empty 值**为未赋值（`字段:` 冒号后无内容；
  除 `empty()` 外一切运算按 null 传播）；
- **裸真值判断**：empty 值、null、0、false、空串、空数组均为假（**0 由真改假**）；
- **`empty()` 语义收窄**：当且仅当 x 为 empty 值时 true；`""` / `[]` / `0` / `false` / null / 缺失字段均 false
  （实现：`EMPTY` 哨兵 + 求值层 empty → null 传播，empty() 是唯一能看见 empty 值的运算）；
- **NUMBER 词法收窄**：小数点后必须至少一位数字，`1.` / `.5` 词法报错；
- **别名唯一性**（致命错误，聚合遍开始前）：SELECT 内所有 AS 别名互不相同（解析期校验），
  且不得与 FROM 全量命中行字段名并集重复（非 TOTAL 场景同样生效）；
- **frontmatter 摄取容错**：重复键（自扫描原文顶层键，Obsidian metadataCache 已折叠无此信息）
  → 文件从结果集剔除 + 结构化 warnings `duplicateKey`（含文件名与字段名，原始键值对归档），
  查询继续；受限标注：`字段:` 与 `字段: null` 在缓存层不可区分，
  实现按「键存在但值为 null → empty 值」近似（`字段: null` / `~` 亦映射为 empty）；
- **warnings 结构化**：`{ type, message }`（除零 / 类型不匹配 / 未知函数 / TOTAL / SORT / duplicateKey 等），
  调试页渲染为 `[type] message`；
- 测试：新增 `ingest.test.ts`（重复键 / 摄取归一 4 例）与三值语义、别名唯一性、词法等新例，
  warnings 断言适配结构化，共 **80 例通过**。

### 1.7.003（插件开发版，已随 1.8.0 迁移）

- **两遍执行模型**：第一遍聚合遍扫描 FROM 全量命中行（恒忽略 WHERE）计算 `**TOTAL**`；
  第二遍投影遍 WHERE / SORT / LIMIT / SELECT，`$变量$` 查变量表、裸标识符查行字段；
- **语法**：`**TOTAL** (字段|数字) **AS** 别名`（别名强制；AS 右侧接受 `$var$` 或裸名，归一化存裸名）；
  `$变量$` 仅 SELECT 内可引用（WHERE / SORT 报错）；TOTAL 操作数内禁止引用变量；不可反向引用；
- **变量表与行字段命名空间隔离**；AS 别名与行字段同名 → 执行期致命报错；
- **语义**：数值求和（null / 缺失跳过、非数值跳过计入 warnings、全无数值 / 空表 → null）；
  `TOTAL 1` = 总行数（COUNT 等价）；SELECT 仅含 TOTAL 项 → 单行合成结果（文件名「汇总」）；
- **只读**：派生变量列不可内联编辑；列表视图以辅助信息行展示；
- **调试**：debug 新增 `aggregates`（调试页 AGG 行）；lexer 新增 `$var$` variable token 与 TOTAL 关键词；
- 测试：47 + 15 例（dsql-language 6 例校验、math 9 例数值语义），共 62 例通过。

### 1.7.002（移动端调试信息改标签页）

- **结果区改为标签页**：「查询结果 / 调试信息」两个标签切换——原 `<details>` 折叠面板
  在移动端跟随正文长列表无法单独滚动，现调试列表限高 45vh 独立滚动；
- **`showDebug` 默认值改为关闭**：已保存过设置的用户不受影响。

### 1.7.001（清理）

- 移除未实装视图类型的死代码：`PLANNED_VIEWS`（board / card / calendar / stats）
  及其下拉灰显项；未实现功能的规划统一记录在工作区根目录 `TODO` 文件（当前留空）。

### 1.6.001（插件开发版，已随 1.7.0 迁移）

- **minAppVersion 1.4.0 → 1.4.4**：属性编辑依赖的 `fileManager.processFrontMatter`
  官方标注 @since 1.4.4，原声明在 1.4.0–1.4.3 上会运行报错；
- **`workspace.revealLeaf` 全部改为 `await`**：该 API 自 1.7.2 返回 Promise，
  官方要求 await 以确保视图完全加载（避免 deferred leaf 未就绪）；
- **`metadataCache.on("resolved")` 仅首次全量重建**：该事件在启动后每次批量修改
  解析完成都会再触发，原先每次都全量扫描；之后统一走增量路径（flush 已重算反向链接）；
- **现代化写法统一**：`vault.getAbstractFileByPath` → `getFileByPath`（带类型返回值）、
  `workspace.getLeaf(true)` → `getLeaf('tab')`（字符串形式为推荐写法）；
- 已知不修：`processFrontMatter` 保存会规范化重写整个 YAML（官方行为，属性弹窗文案提示即可）。

### 工程调整（未升版本，随 1.6.0）

- **测试按示例三大类重组**：`tests/sql.test.ts` 拆分为 `feature.test.ts`（功能示例 22 例）、
  `math.test.ts`（数学示例 9 例）、`dsql-language.test.ts`（DSQL语言示例 12 例），
  共享数据提取到 `helpers.ts`；连同 `store.test.ts` 共 47 例全部通过；
- **演示库各自独立**：两个测试库内容一致（示例数据与预置看板按 功能示例 / 数学示例 /
  DSQL语言示例 三大类组织），但各自只部署本工程插件（曾尝试共用同一 vault，实测报错，已回退）。

### 1.4.001（插件开发版，已随 1.6.0 迁移）

- **frontmatter 属性编辑**（看板数据直接改，保存后索引增量更新、查询结果自动刷新）：
  - 表格视图：双击可编辑单元格（直接 frontmatter 字段）→ 输入框 → 回车保存（Esc 取消、失焦还原）；
    空值 → null，true / false 字面量、数字自动转型，其余存为字符串；数组列不可内联编辑；
  - 列表视图：点击条目打开属性编辑弹窗；表格行悬停出现 ✎ 铅笔，点击同样打开；
  - 属性弹窗：官方 API 全链路——`metadataCache` 读 → `stringifyYaml` 展示 →
    `parseYaml` 校验（失败显示错误不写入）→ `fileManager.processFrontMatter` 原子写回；
    Ctrl / Cmd + Enter 快捷保存；
  - 官方 API 核对：`processFrontMatter`（obsidian.d.ts:2954）、`parseYaml`（:4817）、`stringifyYaml`（:6815）。

### DSQL 1.3.001（语言版本修订，插件仍为 1.4.0）

- 评审项落地（H1–H3 / M1–M3 / L1–L4）：
  - EBNF 勘误：`OP_ADD` 多余空格；优先级表 `%||%` 管道转义；
    `sort_item` 文法改为 `{ sort_modifier }`（方向与 **BY** 各至多一次、先后不限，与实现一致）；
  - 语义补全：`comparison` 裸操作数真值语义正式写入；键级方向继承子句级方向、均无默认 **ASC**；
    数字不支持科学计数法与负数字面量（词法即如此，补文档）；
  - 行为微调（含实现改动）：空 `**BY** ()` 视为无自定义优先级并计入 warnings；
    SELECT `*` 自动列排序改用 UTF-8 字节序（原为 JS 默认序，增补平原字符集外更严谨）；
  - 调试 `from` 描述明确为「源解析后的命中行数（去重后）」；
- 测试：41 + 4 例通过（新增空 BY 警告、自动列字节序 2 例）。

### 1.2.001 及以前（开发期 0.1.0 → 1.0.1，2026-09-06 ~ 09-08）

- **0.1.0（2026-09-06）插件骨架**：前期调研 Dataview / Datacore / Breadcrumbs 源码与维护现状，
  产出架构方案；P1 脚手架（manifest / esbuild / tsconfig / test-vault 热更新）；
  插件设置页（常规项）；侧栏树与主区面板视图骨架；ribbon 图标与命令。
- **0.2.0（2026-09-06）看板模型引入**：看板改为在**插件设置**中定义（名称 / 类型 / 作用描述），
  首次安装自带空白「默认看板」；侧栏展示设置中的看板（按类型分组）。
- **0.3.0（2026-09-07）索引层 + DSQL 前身打通**：索引层 metadataCache 全量首扫 +
  `changed/deleted/renamed` 增量监听（300ms debounce），行仓库（笔记 = 行，frontmatter = 列，
  `file.*` 虚拟列含出 / 入链），订阅通知；自研 SQL v1 子集；面板新增「查询结果」区；测试 14 例。
- **0.4.0（2026-09-07）面板编辑化（DSQL 定名）**：看板模型精简为 `名称 + 类型 + 说明 + SQL`，
  模板 / 规则彻底移除；查询语言正式定名 **DSQL**；DSQL 编辑器移入看板面板（等宽输入、
  防抖 500ms 自动保存）。
- **0.5.0（2026-09-07）排序规范化 + 测试补全 + EBNF**：`**SORT**` 改 UTF-8 字节序确定性排序
  （逐字节比较、公共前缀递归下降、短者在前；数字按数值、null 恒排末尾）；
  测试扩至 DSQL 25 例 + store 4 例；新增 DSQL 规范文档 v1。
- **0.6.0（2026-09-07）SORT BY 优先级 + 调试信息**：`**SORT** 字段 **BY** ('值1','值2',...)`
  自定义优先级；执行期调试收集（FROM 命中 / WHERE 过滤 / SORT 详情 / LIMIT 截断 / FIELD 字段缺失），
  设置新增「显示 DSQL 调试信息」开关；测试 32 + 4 例。
- **0.7.0（2026-09-07）DSQL v1.2 大版本（标记语法字面化）**：关键词 / 函数 `**WORD**` 包裹、
  运算符 `%op%` 包裹、字符串单引号、路径双引号；未知 `**WORD**` 词法报错；
  `**SELECT**` 成为必须子句；完整表达式（乘方右结合、取模、连接 `%||%`、比较族、一元正负）；
  内置函数新增 sqrt / cbrt / root(x, n)；多级排序（键级方向）；测试重写 25 + 4 例。
- **0.8.0（2026-09-07）v1.2 修订 2**：数据源 **AND 优先于 OR**（两级文法，括号可覆盖）；
  `**BY**` 优先级改为作用于其书写的排序键；`**contains**` 改为**区分大小写**；
  乘方结果非有限数 → null；null 比较语义明确；调试扩展 `warnings` 与 `sourceStats`；测试 29 + 4 例。
- **1.0.1（2026-09-07）移除旧版兼容**：删除 `migrateBoard`（sections.data → sql 的开发期数据迁移），
  替换为纯字段校形 `normalizeBoard`；v1.1 时代遗留数据不再做任何回退转换。

---

## DSQL 语言版本记录

> DSQL 语言版本与插件发布版本各自独立；权威语法与语义见 [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md)。

- **v2.0（2026-09-07，当前）**：视图关键词统一 `*_VIEW` 后缀，废除旧 `TABLE` / `LIST`：
  - 视图产生式：`(**TABLE_VIEW** | **LIST_VIEW** | **CARD_VIEW**)?`，缺省 `TABLE_VIEW`；
  - 旧 `**TABLE**` / `**LIST**` 直接报 `LexError`「未知关键词」（不做兼容）；
  - 新增 `**CARD_VIEW**`：执行层走同一数据管道，仅渲染不同；
  - 视图模式持久化字段 `Board.viewType`（重命名自 `viewOverride`），类型 `ViewType | ""`，`""` 表示跟随 SQL；
  - 字符串字面量 `'**TABLE_VIEW**'` 等不参与视图识别。
- **v1.5（2026-09-07）**：三值语义分家、别名唯一性、frontmatter 摄取容错。
- **v1.4（2026-09-07）**：TOTAL 全表聚合 + `$变量$` 派生体系。
- **v1.3（2026-09-07）**：子句前件关系、SELECT 可省略、WITHOUT ID 任意位置、自动列字节序。
- **v1.2（2026-09-07）**：标记语法字面化（`**关键词**` / `%运算符%`）、表达式完备、sqrt / cbrt / root、多级排序。
- **v1.1（2026-09-07）**：SORT BY 自定义优先级 + 调试信息规范。
