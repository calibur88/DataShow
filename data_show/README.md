# DataShow

面向 Obsidian 的元数据看板插件：把笔记属性（frontmatter）索引成数据仓库，
用自研查询语言 **DSQL** 查询，在看板面板中渲染为表格 / 列表视图。

- **数据中立**：不预设字段体系，任何 vault 的 Properties 都能查；
- **Markdown First**：数据只存于笔记本身，插件不建私有数据库；
- **确定性排序**：UTF-8 字节序，跨平台结果一致。

**当前版本**：`1.7.0`（正式版末段为 `0`；新功能先在 `../data_show_test` 以
`x.y.001+` 测试版本开发，测试通过并经允许后迁移至此并定为 `x.y.0`）。

## 安装

将 `main.js`、`manifest.json`、`styles.css` 三个文件放入
`你的仓库/.obsidian/plugins/data-show/`，在 设置 → 第三方插件 中启用。

## 使用

1. **设置 → DataShow → 看板**：新建看板，填写名称（侧栏显示名）、类型（侧栏分组）、作用描述；
2. 点击左侧栏（ribbon 仪表盘图标）打开看板侧栏，点击看板在主工作区打开面板；
3. 在面板的 **DSQL** 编辑框中输入查询（自动保存），「刷新」立即重跑，「视图」下拉切换表格/列表；
4. 修改笔记属性后，查询结果自动刷新。

## DSQL 快速上手

完整语法见 [docs/DSQL-EBNF.md](docs/DSQL-EBNF.md)。关键词用 `**` 包裹、运算符用 `%` 包裹、
字符串单引号、路径双引号：

```sql
**TABLE** **SELECT**
  status **AS** 状态,
  owner **AS** 负责人
**FROM** "Notes"
**WHERE** status %==% '进行中'
**SORT** priority **ASC**
**LIMIT** 20
```

- 数据源：`"文件夹"`（含子文件夹）、`#标签`，`**OR**`/`**AND**` 组合（AND 优先）；
- 表达式：四则与乘方（`%^%` 右结合）、连接 `%||%`、比较 `%==%` 族、`**AND**/**OR**/**NOT**`；
- 函数：`**sqrt** **cbrt** **root** **contains** **length** **lower** **upper** **empty**`
  （`**contains**` 区分大小写，忽略大小写用 `**contains**(**lower**(字段), '值')`）；
- 排序：多级排序、`**SORT** 字段 **BY** ('值1', '值2')` 自定义优先级；
- 调试：面板结果下方折叠显示各操作行数、字段缺失、非致命警告与耗时（设置可关）。

## 构建

```bash
npm install
npm run build   # 类型检查 + 产出 main.js
npm run dev     # watch 模式
```

## 目录

```
manifest.json      插件清单（id: data-show）
package.json       构建脚本与开发依赖
versions.json      历史版本记录
main.js            构建产物
styles.css         样式
CHANGELOG.md       更新日志（从简，只写功能更新）
test-vault/        演示与验收 vault（预置三大类看板：功能/数学/DSQL语言；两个工程的构建产物都部署到这里）
src/
  main.ts          入口：装配各层、注册视图
  types.ts         公共类型
  settings.ts      设置页（看板管理）
  index/           数据层：扫描器 / 行构造 / 行仓库
  query/           DSQL 语言层：词法 / 语法 / 执行（零 Obsidian 依赖）
  views/           表现层：看板侧栏 / 看板面板 / 属性编辑弹窗
docs/DSQL-EBNF.md  DSQL v1.3 语法规范
```

构建时产物（main.js / manifest.json / styles.css）自动同步到 `test-vault/.obsidian/plugins/data-show/`
（本工程专用的演示 vault；草稿工程的产物部署到它自己的 `../data_show_test/test-vault/`）。

整体架构与双目录工作流见工作区根目录的 [../ARCHITECTURE.md](../ARCHITECTURE.md)。

## License

MIT 附加商业使用限制：非商业用途可自由使用、修改、分发；**商业用途须事先获得作者授权**
（联系：QQ `jiuxin303@qq.com` / Email `chy36126@gmail.com`）。全文见根目录
[LICENSE](../LICENSE)。作者：**calibur88**。
