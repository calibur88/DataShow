# DataShow 更新日志

## 2.0.0（当前）

- **DSQL 语言升级 v2.0（破坏性大版本）**（自测试版迁移，规范见 `docs/DSQL-EBNF.md` v2.0）：
  - 视图关键词 `TABLE` / `LIST` 废除，新增 `TABLE_VIEW` / `LIST_VIEW` / `CARD_VIEW`
    （缺省 `TABLE_VIEW`）；旧 `**TABLE**` / `**LIST**` 直接抛 `LexError`「未知关键词」，不做兼容；
  - 三个视图走相同数据管道，仅渲染不同；字符串字面量（如 `'**TABLE_VIEW**'`）不参与视图识别。
- **新增卡片视图（CARD_VIEW）**：Kanban 看板布局——按首个可分组字段（如「状态」）拆列，列头
  显示彩色圆点 + 分组值 + 数量，列内堆卡片；卡片以文件名作标题（点击打开笔记），
  **单击字段值直接编辑 frontmatter**（回车保存 / Esc 取消 / 失焦还原）；派生列
  （TOTAL / 表达式 / 变量 / `file.*` / `this.*`）只读。
- **表格 / 列表视图改为只读**：移除原内联编辑，行点击 / 文件名点击打开笔记；
  列表视图参考 Obsidian Bases 风格（文件名 + 派生列缩进子信息）。
- **视图切换与 SQL 双向同步**（`src/utils/viewSync.ts`）：下拉切换调 `applyViewType` 同步
  SQL 开头关键词；SQL 编辑器防抖保存调 `detectTypeFromSql` 反向同步下拉选中态。
- **字段迁移**：`Board.viewOverride` → **`Board.viewType`**（类型 `ViewType | ""`，空 = 跟随语句）；
  加载时按优先级迁移（`viewType` 优先、`viewOverride` 兜底）并写回一次；
  `Board.type` 保持 `string` 不变——仍是用户自由填写的看板分类（侧栏分组依据）。
- **设置页**：新增「视图模式」下拉（跟随语句 / 表格 / 列表 / 卡片），与「看板分类」自由输入并存。
- **演示 vault 同步**：`test-vault/` 看板 18 → 20（新增「任务卡片」「数学卡片」两个 CARD_VIEW 示例），
  全部看板 SQL 已同步到 DSQL v2.0，`viewOverride` 字段已迁移为 `viewType`。
- 测试：106 例（七套件，位于 data_show_test）。

## 1.8.0

- **DSQL 语言升级 v1.5：三值语义分家 / 别名唯一性 / 摄取容错**（自测试版 1.8.001 迁移，
  插件版本不变，仅语言版本升级；规范见 `docs/DSQL-EBNF.md` v1.5）：
  - 三种「无」正交定义：`0` / `false` 为**正常值**（仅裸真值判断为假，运算照常）；
    `null` 为**空容器**（`字段: ""` / `字段: []` 摄取为 null）；**empty 值**为**未赋值**
    （`字段:` 冒号后无内容），除 `**empty**()` 外一切运算按 null 传播；
  - 裸真值判断：`0` 由真改假（empty / null / 0 / false / 空串 / 空数组均为假）；
  - `**empty**(x)` 语义收窄为「仅当 x 未赋值时为真」，`""` / `[]` / `0` / `false` / null 均假；
  - NUMBER 词法收窄：`1.` 与 `.5` 为词法错误；
  - SELECT 别名唯一性：所有 `**AS**` 别名互不相同，且不得与行字段名冲突（致命错误，
    不限是否含 TOTAL 项）；已有看板若用 `价格 **AS** 价格` 这类同名别名需改别名；
  - frontmatter 重复键：该文件从结果集剔除并计入 `duplicateKey` 警告，查询继续；
  - warnings 结构化 `{ type, message }`，调试页按 `[type] message` 渲染；
- **DSQL 语言升级 v1.4：TOTAL 全表聚合 + $变量$ 派生体系**（自测试版 1.7.003 迁移）：
  - 两遍执行模型：聚合遍扫描 FROM 全量命中行（恒忽略 WHERE）计算 `**TOTAL**`；
    投影遍 WHERE/SORT/LIMIT/SELECT，`$变量$` 查变量表、裸标识符查行字段；
  - 语法：`**TOTAL** (字段|数字) **AS** 别名`（别名强制）；`$变量$` 仅 SELECT 内可引用；
    不可反向引用、TOTAL 内禁止引用变量；别名与行字段同名 → 致命报错；
  - 语义：数值求和（null/缺失跳过、非数值跳过计入 warnings、空表 → null）；`TOTAL 1` = 总行数；
    仅含 TOTAL 项 → 单行"汇总"结果；派生列只读（列表视图以辅助信息行展示）；
  - 调试新增 AGG 行；规范见 `docs/DSQL-EBNF.md` v1.4；
- **演示 vault 同步**：`test-vault/` 新增 `示例/三值示例/`（正常零值 / 空容器 / 未赋值 三篇），
  预置看板 16 → 18（新增「三值示例」分组：三值展示、empty 谓词与三值传播）；
  看板定义 `data.json` 已纳入版本控制；
- 测试：80 例（五套件：功能 22 / 数学 29 / DSQL语言 21 / store 4 / 摄取层 4，位于 data_show_test）。

## 1.7.0

- **最低版本要求提升为 Obsidian 1.4.4**：属性编辑依赖的 `fileManager.processFrontMatter`
  官方标注 @since 1.4.4，原 1.4.0 声明在 1.4.0–1.4.3 上会运行报错；
- 稳定性修缮（自测试版 1.6.001 迁移）：
  - `workspace.revealLeaf` 全部改为 `await`（该 API 自 1.7.2 返回 Promise，
    确保视图完全加载、避免 deferred leaf 未就绪）；
  - `metadataCache.on("resolved")` 改为仅首次全量重建，之后走增量路径
    （该事件在启动后每次批量修改解析完成都会触发，原先每次都全量扫描）；
- 写法现代化：`vault.getAbstractFileByPath` → `getFileByPath`、
  `workspace.getLeaf(true)` → `getLeaf('tab')`（均为官方推荐形式）；
- **结果区改为标签页**：「查询结果 / 调试信息」两个标签切换——原 `<details>` 折叠面板
  在移动端跟随正文长列表无法单独滚动，现调试列表限高 45vh 独立滚动；
- **「显示 DSQL 调试信息」默认改为关闭**（已保存过设置的用户不受影响）。

## 1.6.0

- frontmatter 属性编辑：表格视图双击单元格直接改属性（回车保存，自动转型）；
  列表视图点击条目或行内 ✎ 打开 YAML 属性编辑弹窗（官方 processFrontMatter 写回）；
  保存后索引增量更新、查询结果自动刷新；
- DSQL 语言规范升级 v1.3：空 `**BY** ()` 视为无自定义优先级并计入警告；
  SELECT `*` 自动列按 UTF-8 字节序排序；排序方向语义文档勘误（末尾方向属于最后一个键）。

## 1.4.0

- DSQL 子句改为按前件关系解析：书写顺序自由，`**SELECT**` 可省略（默认全字段）；
- `**WITHOUT** **ID**` 可写在任意子句位置，子句重复出现时报错（带行列号）；
- 查询结果调试信息并入 SELECT 投影期字段缺失提示；
- 设置新增「小数显示位数」；
- 视图下拉仅保留已实装的表格 / 列表；
- 新增效果验收 vault（`test-vault/`，构建自动同步插件产物）。

## 1.2.0

- 看板数据统一存插件 data.json，移除未使用的 DataShow 目录约定。

## 1.1.0

- 查询支持省略 SELECT 的列表视图与全字段自动列；
- 测试数据与示例看板完善。

## 1.0.0

- 首个正式版本：看板（名称/类型/说明/DSQL）、看板侧栏与面板、
  metadataCache 增量索引、表格 / 列表视图、DSQL v1.2 标记语法。
