# DataShow

面向 Obsidian 的元数据看板插件：把笔记属性（frontmatter）索引成数据仓库，
用自研查询语言 **DSQL** 查询，在看板面板中渲染为表格 / 列表 / 卡片视图。

- **数据中立**：不预设字段体系，任何 vault 的 Properties 都能查；
- **Markdown First**：数据只存于笔记本身，插件不建私有数据库；
- **确定性排序**：UTF-8 字节序，跨平台结果一致。

- **插件版本**：`2.1.4`
- **插件 ID**：`data-show`（唯一 ID，插件目录与 `manifest.json` 一致）
- **最低 Obsidian 版本**：`1.4.4`
- **DSQL 语言版本**：`2.0`（语言版本与插件版本各自独立，规范见 [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md)）

> **版本兼容性**：`2.1.4` 为纯架构重构，行为零变化；DSQL 语法、视图渲染、看板定义均无改动，
> 已有 `data.json` 可继续使用（旧扁平格式首次保存后自动升级为槽位结构）。

## 单目录工程结构

```
DataShow/
├── manifest.json        插件清单（id: data-show）
├── package.json         构建脚本与开发依赖
├── versions.json        历史版本 → minAppVersion 映射
├── tsconfig.json         类型检查配置（outDir: dist，rootDir: src）
├── esbuild.config.mjs   构建 + 自动同步到两个测试库
├── styles.css           样式
├── src/                 插件源码（见下）
├── tests/               单元测试（七套件，零 Obsidian 依赖）
├── scripts/test.mjs     测试运行器（esbuild 打包后交给 node）
├── docs/                DSQL 语言规范
├── dist/                构建产物（不入库）
├── test-vault/          干净演示库（入库，仅提交用）
└── test-vault-local/    本地测试库（不入库，日常验收用）
```

`src/` 分层（host 依赖模式：宿主能力收敛于 `host/obsidian/`，核心层零 Obsidian 依赖；
跨层引用走别名 `@dsql` / `@index` / `@host` / `@controller` / `@render` / `@views` / `@settings` / `@utils`）：

```
src/
├── main.ts         插件入口：只做装配（宿主适配器 → 索引器 → 视图注册）
├── host/           types.ts 宿主接口与依赖契约唯一出口 + obsidian/ 七个适配器
├── core/           可移植核心（零 Obsidian 依赖）
│   ├── dsql/       DSQL 语言层（别名 @dsql，独立 tsconfig）：types.ts 语言层类型出口
│   │               （含 ViewType 与 EMPTY 哨兵）+ lexer / parser / ast / functions / executor
│   └── index/      行仓库 / 行构造 / frontmatter 原文扫描（别名 @index）
├── controller/     索引器：宿主事件 → 行仓库
├── render/         纯 UI：面板 / 侧栏 + 表格·列表·卡片三视图
├── views/          Obsidian 视图壳（panel / sidebar / settings-tab）+ 视图类型常量
├── settings/       设置与看板内容：schema / defaults / normalize
└── utils/          viewSync 视图与 SQL 双向同步（纯函数）
```

## 安装

将 `dist/main.js`（重命名为 `main.js`）、`manifest.json`、`styles.css` 三个文件放入
`你的仓库/.obsidian/plugins/data-show/`，在 设置 → 第三方插件 中启用。

## 快速开始（开发）

```bash
npm install
npm run build   # tsc 类型检查 + 产出 dist/main.js，并自动同步到两个测试库
npm run dev     # watch 模式：src / manifest.json / styles.css 变化即重建并同步
npm test        # 单测七套件，共 106 例
```

构建产物（`main.js` / `manifest.json` / `styles.css`）由 `esbuild.config.mjs` 自动同步到
`test-vault-local/.obsidian/plugins/data-show/` 与 `test-vault/.obsidian/plugins/data-show/`。

- `test-vault-local/` —— **本地测试库**：日常在 Obsidian 中验收功能，测试产生的改动都留在这里，不入库；
- `test-vault/` —— **干净提交库**：仅用于版本提交，不用于日常测试。
  若本地测试污染了 `test-vault-local/.obsidian/plugins/data-show/data.json`，
  直接把 `test-vault/` 下的同名文件复制过去覆盖即可恢复。

## 核心功能

1. **看板**：`名称 + 分类 + 说明 + DSQL`，在设置中管理、在看板面板中编辑（防抖自动保存）；
   看板定义存于插件 `data.json`（已纳入版本控制，构建产物不入库）；
2. **索引**：Obsidian `metadataCache` 全量首扫 + 增量监听（debounce），frontmatter 原样入行；
3. **视图**：表格 / 列表 / 卡片三种视图，视图切换与 SQL 开头关键词双向同步；
4. **数据可编辑**：卡片视图单击字段值直接改 frontmatter（派生列只读），保存后结果自动刷新；
   表格 / 列表为只读，点击行打开笔记；
5. **调试**：「查询结果 / 调试信息」标签页显示各阶段行数、字段缺失、非致命警告与耗时
   （默认关闭，设置可开）。

## DSQL 快速上手

关键词用 `**` 包裹、运算符用 `%` 包裹、字符串单引号、路径双引号。视图关键词为
`**TABLE_VIEW**` / `**LIST_VIEW**` / `**CARD_VIEW**`（可省略，缺省 `TABLE_VIEW`；
旧 `**TABLE**` / `**LIST**` 已废除，写入直接报词法错误）：

```sql
**TABLE_VIEW** **SELECT**
  status **AS** 状态,
  owner **AS** 负责人
**FROM** "Notes"
**WHERE** status %==% '进行中'
**SORT** priority **ASC**
**LIMIT** 20
```

- 数据源：`"文件夹"`（含子文件夹）、`#标签`，`**OR**` / `**AND**` 组合（AND 优先）；
- 表达式：四则与乘方（`%^%` 右结合）、连接 `%||%`、比较 `%==%` 族、`**AND**` / `**OR**` / `**NOT**`；
- 函数：`**sqrt** **cbrt** **root** **contains** **length** **lower** **upper** **empty**`
  （`**contains**` 区分大小写，忽略大小写用 `**contains**(**lower**(字段), '值')`）；
- 排序：多级排序、`**SORT** 字段 **BY** ('值1', '值2')` 自定义优先级；
- **聚合与派生变量**：`**TOTAL** 字段 **AS** $总成绩$` 全表聚合（恒忽略 WHERE）；
  `$变量$` 在 SELECT 中引用（链式派生），派生列只读；仅含 TOTAL 项时输出单行汇总；
- **三种「无」互不混淆**：`0` / `false` 是**正常值**（仅裸真值判断为假，运算照常）；
  `null` 是**空容器**（`字段: ""` / `字段: []` 摄取为 null）；**empty 值**是**未赋值**
  （`字段:` 冒号后无内容），除 `**empty**()` 外的一切运算按 null 传播。

完整语法见 [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md)。

## 文档索引

| 文档 | 说明 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 整体架构、分层依赖、数据流、构建与测试流程 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 开发 / 版本 / 文档 / 提交规范 |
| [API.md](API.md) | Obsidian 官方 API + 插件自身 API |
| [CHANGELOG.md](CHANGELOG.md) | 更新日志 |
| [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md) | DSQL 语法与语义权威规范 |
| [test-vault/README.md](test-vault/README.md) | 演示库看板清单与验收步骤 |

## License

许可类型：个人授权协议（非商业源码可见许可）。

- 非商业用途：个人、教育、非营利组织及其他非商业目的可免费使用、复制、修改、分发，需保留版权与许可声明。
- 商业用途：需事先获得作者书面授权。未经书面许可，不得将本插件或其衍生品用于商业分发或商业服务。
- 完整条款见 [LICENSE](LICENSE)。
- 版权归属与联系方式：见 [LICENSE](LICENSE) 与 `manifest.json` 的 `author` / `authorUrl` 字段。
