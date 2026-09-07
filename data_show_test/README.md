# datashow-dev（草稿开发目录）

DataShow 的**草稿开发工程**：新功能、DSQL 语法演进、测试与规范文档都在这里进行；
稳定后清理并迁移到 `../data_show`（正式目录，插件 id `data-show`）。

- 本目录插件 id 为 `datashow-dev`，可与正式版 `data-show` 在同一 vault 中共存；
- **版本规则**：`package.json` 版本号与正式版对齐（当前 `2.0.0`，不随测试递增）；
  开发条目在 CHANGELOG 中以末段递增编号（上一轮 `1.8.001` = DSQL 1.5 已迁移）；
  测试通过并经用户允许后迁移至 `../data_show`（正式版版本号定为 `x.y.0`）；
- 双目录结构与完整版本规则见根目录 [`../ARCHITECTURE.md`](../ARCHITECTURE.md)。

## 当前状态

- **DSQL v2.0**（规范：[`docs/DSQL-EBNF.md`](docs/DSQL-EBNF.md)）——**破坏性大版本**：
  视图关键词 `TABLE` / `LIST` 废除，新增 `TABLE_VIEW` / `LIST_VIEW` / `CARD_VIEW`（缺省 `TABLE_VIEW`）；
  旧 `**TABLE**` / `**LIST**` 直接抛 `LexError`「未知关键词」，不做兼容；
  三个视图走相同数据管道，仅渲染不同；看板定义 `viewOverride` 字段在加载时迁移到 `viewType`
  （重命名更明确语义，类型 `ViewType | ""`）；`Board.type` 保持 `string` 不变——仍是用户自由
  填写的看板分类（侧栏分组依据），与 ViewType 解耦。
- **三视图**：
  - 表格视图（`TABLE_VIEW`）：行点击打开笔记，只读；
  - 列表视图（`LIST_VIEW`）：文件名 + 派生列缩进子信息（参考 Obsidian Bases 风格），只读；
  - 卡片视图（`CARD_VIEW`）：Kanban 看板布局——按首个可分组字段（如「状态」）拆列，列内堆卡片，
    每卡片显示一个数据行，**单击字段值直接编辑**；派生列（TOTAL / 表达式 / 变量 / `file.*` / `this.*`）只读。
- **视图切换与 SQL 双向同步**：下拉切换时 `applyViewType` 同步 SQL 开头关键词；
  SQL 编辑器防抖保存时 `detectTypeFromSql` 反向同步下拉选中态。
- **测试**：`npm test` **106 例**，七套件（功能 22 / 数学 29 / DSQL语言 22 / store 4 / 摄取层 4 /
  **viewSync 15** / **normalizeBoard 10**）。
- **演示 vault**：`test-vault/` 预置 **20 个看板**，四大类
  （功能示例 6 / 数学示例 6 / DSQL语言示例 5 / 三值示例 2 + **CARD_VIEW 示例 2**），见
  [`test-vault/README.md`](test-vault/README.md)；**所有看板 SQL 已同步到 DSQL v2.0**。
- 未实现功能的规划统一记录在根目录 [`../TODO`](../TODO)。

## 开发

```bash
npm install
npm run dev     # watch 模式，产物同步到本工程 test-vault/.obsidian/plugins/datashow-dev/
npm run build   # tsc 类型检查 + esbuild 生产构建（产物自动部署到 test-vault）
npm test        # esbuild 打包后跑 node（query 层零 Obsidian 依赖）
```

> 验证看板 SQL 不能直接用 `node` 跑 TS：`src/query/parser.ts` 用了参数属性
> （`constructor(private tokens: Token[])`），node 的 strip-only 模式不支持，
> 必须经 esbuild 打包（参考 `scripts/test.mjs`）。

验收：用 Obsidian 打开本工程 `test-vault/` → 侧栏按类型分组点开看板 →
面板查看结果与调试信息。
