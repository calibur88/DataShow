# DataShow

面向 Obsidian 的元数据看板插件：把笔记属性（frontmatter）索引成数据仓库，
用自研查询语言 **DSQL** 查询，在看板面板中渲染为表格 / 列表 / 卡片视图。

- **数据中立**：不预设字段体系，任何 vault 的 Properties 都能查；
- **Markdown First**：数据只存于笔记本身，插件不建私有数据库；
- **确定性排序**：UTF-8 字节序，跨平台结果一致。

- **插件版本**：`2.3.1`
- **插件 ID**：`data-show`（唯一 ID，插件目录与 `manifest.json` 一致）
- **最低 Obsidian 版本**：`1.4.4`
- **DSQL 语言版本**：`2.6`（新增**域扩展**：块 `{ }` 语法声明多个子域，`<域>` / `<域>::字段` 引用子域，
  `**YIELD**` + `**IN**` / `**DIFF**` 建立跨数据集的逐行关系并按行展开；**无块的查询完全走 v2.5 旧算法**、
  输出逐字节一致。语言版本与插件版本各自独立，规范见 [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md)；
  历史版本说明见 [CHANGELOG.md](CHANGELOG.md)）

> **版本兼容性**：当前版本与上一版本**完全兼容**，不涉及破坏性变更，已有 `data.json` 可继续使用。
>
> - **插件 `2.3.1`**：修复列表视图（LIST_VIEW）静默丢弃投影列——投影列按「内容列（主行）/
>   辅助列（缩进子行）」两分、**全部可见**，取值口径（`col.total` 取变量表）与表格 / 卡片视图对齐；
>   纯视图层修复，看板定义与查询语义无改动；
> - **DSQL `2.6`**：新增域扩展——`<域>` / `<域>::字段` / 块 `{ }` / `**YIELD**` / `**IN**` / `**DIFF**`。
>   **非破坏性且可加**：无块的查询不进入新算法，输出与 v2.5 逐字节一致；`<` / `>` / `{` / `}` / `IN` /
>   `DIFF` / `YIELD` 在 v2.5 中均无用途，裸标识符 `in` / `diff` / `yield` 与 `'**IN**'` 等字面量不受影响
>   （词法隔离）；详见 [CHANGELOG.md](CHANGELOG.md) DSQL 2.6 条目与规范 §6.13。
>
> 更早版本的兼容性声明见 [CHANGELOG.md](CHANGELOG.md)（近期版本）与 `changelog-<起始版本>-<最后版本>.log`（归档）。

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
├── tests/               单元测试（十四套件，零 Obsidian 依赖）
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
│   │               （含 ViewType 与 EMPTY 哨兵）+ lexer / parser / ast
│   │               + coerce（值语义）/ expr（表达式求值）/ source（FROM 判定与 [ext] 范围）
│   │               + functions / executor（旧算法管线）/ domains（域扩展执行，DSQL 2.6）
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
npm test        # 单测十四套件，共 348 例
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
   列表视图主行 = 文件名 + 内容列（裸字段 / SEARCH 抽取字段 / 表达式列），缩进子行 = 辅助列
   （TOTAL / COUNT 槽位、`$变量$`、`file.*` / `this.*`、域扩展合成列），投影列全部可见；
4. **数据可编辑**：卡片视图单击字段值直接改 frontmatter（派生列只读），保存后结果自动刷新；
   表格 / 列表为只读，点击行打开笔记；
5. **调试**：「查询结果 / 调试信息」标签页显示各阶段行数、字段缺失、非致命警告与耗时
   （默认关闭，设置可开）；
6. **侧栏搜索**：看板侧栏顶部搜索栏，按分类名 / 看板名过滤，保留折叠状态、隐藏空组、清空恢复全部；
7. **通用搜索**：面板工具条搜索对表格 / 列表 / 卡片三视图统一生效（匹配文件标题 + 列名 + 列值），切视图保留搜索词；
8. **结果导出**：面板工具条导出当前结果为 JSON / CSV（vault 相对路径，自动建目录，拒绝越界 / 绝对路径 / .xlsx）；
9. **域扩展**（DSQL 2.6）：块 `{ }` 内声明多个**子域**（各带自己的 `**SELECT**` / `**FROM**` / `**WHERE**`），
   用 `**YIELD**` + `**IN**` / `**DIFF**` 建立子域之间的**逐行关系**并按行展开——
   回答「谁引用了谁 / 谁还有谁没有」这类跨数据集问题；无块的查询不受影响（仍走旧算法）。
   输出列标签：`<域>` 保留尖括号、`$槽位$` 去 `$`；域对象显示为 `[字段:值][字段:值]`、
   槽位值显示为 `true` / `false` 或 `金针,铁针`（详见规范 §6.13.7）。

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
- 域扩展：**块 `{ }` 语法**声明子域并建立跨域逐行关系（DSQL 2.6，详见规范 §6.13）：

  ```sql
  **TABLE_VIEW** **SELECT** <人物>, <武器>, $人物有武器$
  {
    { **SELECT** name, wolf **FROM** "示例/域示例/人物" } **AS** <人物>
    { **SELECT** name **FROM** "示例/域示例/武器" } **AS** <武器>

    **YIELD**
      <武器>::name **IN** <人物>::wolf **AS** $人物有武器$
  }
  ```

  顶层 `**SELECT**` 只接受单级 `<域>` / `$槽位$`；子域由 `{ 子查询 } **AS** <域>` 声明（`**AS**` 必填，
  子查询内 `**FROM**` 必填）；`**YIELD**` 的 `**IN**` 逐行判断成员、`**DIFF**` 取「左参全集 \ 右参逐行值」；
  行数 = 所有 ROW 位涉及域（`**IN**` 两侧 / `**DIFF**` 右侧）行数之积，无 `**YIELD**` 时 = 所有子域笛卡尔积；
  跨域引用只允许一级（`<域>::字段`，词法层拦截）；**无块的查询完全走旧算法**，输出逐字节一致；
  输出列标签 `<域>` 保留尖括号、`$槽位$` 去 `$`（命名空间标记仅输出层去掉），域对象显示为
  `[name:傻青][wolf:狼牙棒,金针]`、槽位值显示为 `true` / `金针,铁针`；
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
| [CHANGELOG.md](CHANGELOG.md) | 更新日志（近期版本 + 归档导航；划分规范见 CONTRIBUTING §6.3） |
| [docs/DSQL-语言规范.md](docs/DSQL-语言规范.md) | DSQL 语法与语义权威规范 |
| [test-vault/README.md](test-vault/README.md) | 演示库看板清单与验收步骤 |

## License

许可类型：非商业授权协议（非商业源码可见许可）。

- 非商业用途：个人、教育机构、非营利组织及其他不以营利为目的的主体，可免费使用、复制、修改、分发本软件，需在所有副本或实质性部分中保留版权声明与许可声明。
- 商业用途：任何商业用途均需事先获得作者书面授权。未经书面许可，不得将本插件或其衍生品用于商业分发、商业服务或商业产品集成。
- 完整条款见 [LICENSE](LICENSE)。
- 版权归属与联系方式：见 [LICENSE](LICENSE) 与 `manifest.json` 的 `author` / `authorUrl` 字段。
