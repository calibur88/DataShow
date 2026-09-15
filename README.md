# DataShow

面向 Obsidian 的元数据看板插件：把笔记属性（frontmatter）索引成数据仓库，
用自研查询语言 **DSQL** 查询，在看板面板中渲染为表格 / 列表 / 卡片视图。

- **数据中立**：不预设字段体系，任何 vault 的 Properties 都能查；
- **Markdown First**：数据只存于笔记本身，插件不建私有数据库；
- **确定性排序**：UTF-8 字节序，跨平台结果一致。

- **插件版本**：`2.2.1`
- **插件 ID**：`data-show`（唯一 ID，插件目录与 `manifest.json` 一致）
- **最低 Obsidian 版本**：`1.4.4`
- **DSQL 语言版本**：`2.5`（v2.5 修复两池隔离：`$变量$` 列标签不再与裸标识符列标签跨池判重，列标签唯一性按两池分别判定；
  v2.4 新增 `**WHILE**` 循环驱动子句、`**SEARCH**` 改由 `**WHILE**` 驱动、
  `**TOTAL**` 口径扩展至 SEARCH 场景；v2.3 新增 `**COUNT**` 分类计数子句与槽位模型；v2.2 新增 `**SEARCH**` 正文抽取；
  语言版本与插件版本各自独立，规范见 [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md)）

> **版本兼容性**：
> - **插件 `2.2.1`**：两池同名列的预览与导出列名口径统一（表格表头复用 `exportHeaders`）；DSQL 两池隔离修复，
>   跨池同名不再误报，已有 `data.json` 可继续使用；
> - **插件 `2.2.0`**：新增侧栏搜索、三视图通用搜索与结果导出（JSON / CSV），纯 UI / 导出能力，
>   看板定义与查询结果渲染均无改动，已有 `data.json` 可继续使用；
> - **插件 `2.1.4`**：纯架构重构，行为零变化；视图渲染、看板定义均无改动，已有 `data.json`
>   可继续使用（旧扁平格式首次保存后自动升级为槽位结构）；
> - **DSQL `2.5`**：修复两池隔离——`$变量$` 列标签（含普通 `expr AS $x$`、TOTAL / COUNT 槽位）与裸
>   `AS x` 列标签同名不再判重、各自成列；同池内列标签仍须互不相同。**非破坏性**，仅放宽此前误报的跨池同名
>   （详见 [CHANGELOG.md](CHANGELOG.md) DSQL 2.5 条目）；
> - **DSQL `2.4`**：新增 `**WHILE** [起始, 结束]` 循环驱动子句，`**SEARCH**` 不再独立自足、
>   必须与 `**WHILE**` 成对出现——**破坏性**，既有仅写 `**SEARCH**` 的看板须补 `**WHILE** [0, 1]`
>   （单次匹配，等价旧行为）；同时 `**TOTAL**` 口径扩张至 FROM 全量命中行（含 SEARCH 展开与 null 填充行），
>   数值串抽取字段可参与聚合（详见 [CHANGELOG.md](CHANGELOG.md) DSQL 2.4 条目）；
> - **DSQL `2.3`**：新增 `**COUNT**` 分类计数子句与槽位模型；`**TOTAL**` 的 `**AS**` 收紧为强制
>   `$槽位$`（既有看板的裸名写法如 `**TOTAL** 成绩 **AS** 总成绩` 须改为 `$总成绩$`）——**破坏性**，
>   详见 [CHANGELOG.md](CHANGELOG.md) DSQL 2.3 条目；
> - **DSQL `2.2`**：新增 `**SEARCH**` 正文抽取子句；比较语义修订为「同能转数字 → 数值比」——
>   `"007" %==% "7"` 由 false 变 true、`"" %==% 0` 由 true 变 false，
>   依赖旧字节精确匹配口径的混合类型比较需复检（详见 [CHANGELOG.md](CHANGELOG.md) DSQL 2.2 条目）。

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
├── tests/               单元测试（十三套件，零 Obsidian 依赖）
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
├── host/           types.ts 宿主接口与依赖契约唯一出口 + obsidian/ 七个适配器（另有 file-meta.ts 共享映射）
├── core/           可移植核心（零 Obsidian 依赖）
│   ├── dsql/       DSQL 语言层（别名 @dsql，独立 tsconfig）：types.ts 语言层类型出口
│   │               （含 ViewType 与 EMPTY 哨兵）+ lexer / parser / ast / functions / executor
│   └── index/      行仓库 / 行构造 / frontmatter 原文扫描 / 正文抽取 / [ext] 文件级分派与自研 YAML 解析（别名 @index）
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
npm test        # 单测十三套件，共 295 例
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
   （默认关闭，设置可开）；
6. **侧栏搜索**：看板侧栏顶部搜索栏，按分类名 / 看板名过滤，保留折叠状态、隐藏空组、清空恢复全部；
7. **通用搜索**：面板工具条搜索对表格 / 列表 / 卡片三视图统一生效（匹配文件标题 + 列名 + 列值），切视图保留搜索词；
8. **结果导出**：面板工具条导出当前结果为 JSON / CSV（vault 相对路径，自动建目录，拒绝越界 / 绝对路径 / .xlsx）。

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
- 非 md 数据源：`**WHERE**` 中写 `[txt, mp4]` / `[]` 后缀过滤，把 FROM 目录下的非 md 文件
  （自研 YAML 子集解析）接入查询，md 文件仍走官方解析；解析失败文件剔除并在结果区尾部
  渲染「解析失效」列表（详见规范 §6.9）；
- 正文抽取：`**SEARCH** '正则' **AS** 别名` 从每行 body 用正则抽字段，与 frontmatter 字段平级，
  WHERE / SORT / SELECT 全部可用。**DSQL 2.4 起 `**SEARCH**` 由 `**WHILE**` 驱动**，
  必须成对出现（详见规范 §6.10）；
- 循环驱动：`**WHILE** [起始, 结束]` 声明迭代轮数（两边界为非负整数字面量、`parse` 期校验起始 < 结束，
  轮数 = `结束 - 起始`），每轮推进一次 SEARCH 匹配游标，匹配不足补 `null`；SEARCH 的前件即 WHILE，
  仅写 `**SEARCH**` 须补 `**WHILE** [0, 1]`（单次匹配，等价旧行为）——**破坏性**（详见规范 §6.12）；
- 分类计数：`**COUNT** 比较语句 **AS** $槽位$` 在 WHERE 过滤后行集上计数（无 WHERE = 全量），
  填充 SELECT 声明的 `$槽位$`；`**TOTAL**` 恒为 FROM 全量口径（含 SEARCH 展开与 null 填充行），
  两口径可对照组合（详见规范 §6.11）；
- 函数：`**sqrt** **cbrt** **root** **contains** **length** **lower** **upper** **empty**`
  （`**contains**` 区分大小写，忽略大小写用 `**contains**(**lower**(字段), '值')`）；
- 排序：多级排序、`**SORT** 字段 **BY** ('值1', '值2')` 自定义优先级；
- **聚合与派生变量**：`**TOTAL** 字段 **AS** $总成绩$` 取 FROM 整集合的单标量（恒忽略 WHERE）；
  `$变量$` 在 SELECT 中引用——`expr **AS** $变量$` 可**链式派生**（变量表恒存在，与是否含 TOTAL / COUNT 无关），
  派生列只读；SELECT 仅含槽位 / TOTAL 项时输出单行汇总；
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

许可类型：非商业授权协议（非商业源码可见许可）。

- 非商业用途：个人、教育机构、非营利组织及其他不以营利为目的的主体，可免费使用、复制、修改、分发本软件，需在所有副本或实质性部分中保留版权声明与许可声明。
- 商业用途：任何商业用途均需事先获得作者书面授权。未经书面许可，不得将本插件或其衍生品用于商业分发、商业服务或商业产品集成。
- 完整条款见 [LICENSE](LICENSE)。
- 版权归属与联系方式：见 [LICENSE](LICENSE) 与 `manifest.json` 的 `author` / `authorUrl` 字段。
