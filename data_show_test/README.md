# datashow-dev（草稿开发目录）

DataShow 的**草稿开发工程**：新功能、DSQL 语法演进、测试与文档都在这里进行；
稳定后清理并发布到 `../data_show`（正式目录，插件 id `data-show`）。

- 本目录插件 id 为 `datashow-dev`，可与正式版 `data-show` 在同一 vault 中共存。
- 规范文档：`docs/DSQL-EBNF.md`。
- **版本规则**：本目录为测试版，版本号末段递增（当前测试版 `1.7.001`，验收后迁移至 `../data_show`）；
  测试通过并经用户允许后迁移至 `../data_show`（正式版，版本号定为 `x.y.0`）。

## 当前状态

- ✅ **看板模型**（已确定）：看板 = `名称 + 类型 + 说明 + DSQL`。
  - **设置页**（设置 → DataShow → 看板）：只维护看板身份信息（名称/类型/说明）与增删管理；
  - **DSQL 在看板面板中编辑**：等宽输入框，防抖自动保存；「刷新」按钮手动重跑。
- ✅ **侧栏**：展示设置中定义的看板（按类型分组），点击在主工作区打开。
- ✅ **主区面板**：头部（名称 + 类型徽标 + 说明）→ DSQL 编辑器 → 工具条（刷新 + 视图类型）→ 查询结果。
- ✅ **视图类型**：表格 / 列表 实装（默认跟随 DSQL 的 TABLE/LIST 关键字，可下拉覆盖）；
  扩展视图等未实现项的规划统一记录在根目录 [`TODO`](../TODO)。
- ✅ **DSQL v1.3**（规范：`docs/DSQL-EBNF.md`；`npm test` 47 例覆盖，按 功能/数学/DSQL语言 三大类组织）：
  **标记语法字面化**——关键词 `**SELECT**`、运算符 `%==%`、字符串 `'值'`、路径 `"文件夹"`；
  子句按**前件关系**解析（书写顺序自由、每条至多一次；WHERE/SORT/LIMIT 以 FROM 为前件；
  SELECT 可省略默认 `*`，FROM 为唯一必填子句；视图 TABLE/LIST 缺省 TABLE）；
  投影支持任意表达式（四则/乘方右结合/连接 %||%/取模）+ `**AS**` 别名 + `*` 全字段；
  内置函数 sqrt/cbrt/root/contains/length/lower/upper/empty（contains 区分大小写，
  忽略大小写用 contains(lower(字段), '值') 组合）；
  多级排序 + `**SORT** 字段 **BY** ('值1','值2')` 自定义优先级；UTF-8 字节序确定性排序；
  调试信息（各操作行数/字段缺失/耗时，设置开关默认开）；语法错误带行列号；
  非致命语义（类型不匹配/除零/缺字段 → null）。**不兼容 v1.1 旧写法**（用户决策）。
- ✅ **索引层**：metadataCache 全量首扫 + 增量监听（debounce），
  frontmatter 原样入行（Breadcrumbs 等关系字段不改写）。
- ✅ **显示设置**：小数显示位数（非负整数，默认 4；超出浮点精度重置默认）。
- ✅ **属性编辑**（1.6.0）：表格双击单元格内联改 frontmatter、列表点击/行 ✎ 打开属性弹窗
  （YAML 编辑，官方 `processFrontMatter` 写回），保存后结果自动刷新；工具条「刷新」手动重跑。
- ✅ **存储与联动**：看板全部数据（名称/类型/说明/DSQL/视图覆盖）只存插件 data.json；
  面板 DSQL 编辑防抖自动保存，保存即触发侧栏刷新，外部变更经 `onExternalChange` 同步。
- 未实现功能的规划统一记录在工作区根目录 [`TODO`](../TODO)（当前留空）

## 概念边界

| 概念 | 位置 | 说明 |
|---|---|---|
| 看板定义 | 插件设置 → DataShow → 看板 | 名称/类型/说明 |
| DSQL 编辑 | 看板面板（主工作区） | 自动保存到看板定义 |
| 看板侧栏 | 左侧栏 DataShow 视图 | 展开项 = 设置里的看板名称 |
| 看板数据 | vault 任意笔记的 frontmatter | 数据即笔记本身，插件不建私有存储 |

## 开发

```bash
npm install
npm run dev     # watch 模式，产物同步到本工程 test-vault/.obsidian/plugins/datashow-dev/
npm run build   # 类型检查 + 生产构建
npm test        # 单测三大类：功能示例 / 数学示例 / DSQL语言示例（+ store，query 层零 Obsidian 依赖）
```

验收：构建产物部署到本工程专用的 `test-vault/`（预置三大类看板：
功能示例 / 数学示例 / DSQL语言示例）。用 Obsidian 打开该 vault → 侧栏点开看板 →
面板 DSQL 框粘贴 `test-vault/README.md` 里的示例 → 查询结果自动出现。
