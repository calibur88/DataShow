# datashow-dev（草稿开发目录）

DataShow 的**草稿开发工程**：新功能、DSQL 语法演进、测试与规范文档都在这里进行；
稳定后清理并迁移到 `../data_show`（正式目录，插件 id `data-show`）。

- 本目录插件 id 为 `datashow-dev`，可与正式版 `data-show` 在同一 vault 中共存；
- **版本规则**：`package.json` 版本号与正式版对齐（当前 `1.8.0`，不随测试递增）；
  开发条目在 CHANGELOG 中以末段递增编号（当前 `1.8.001` = DSQL 1.5，已迁移至正式版）；
  测试通过并经用户允许后迁移至 `../data_show`（正式版版本号定为 `x.y.0`）；
- 双目录结构与完整版本规则见根目录 [`../ARCHITECTURE.md`](../ARCHITECTURE.md)。

## 当前状态

- **DSQL v1.5**（规范：[`docs/DSQL-EBNF.md`](docs/DSQL-EBNF.md)）——三值语义分家：
  `0`/`false` 为正常值（仅裸真值为假，运算照常）、`null` 为空容器值
  （`字段: ""` / `字段: []` 摄取为 null）、**empty 值**为未赋值（`字段:` 冒号后无内容，
  除 `empty()` 外一切运算按 null 传播）；`empty()` 语义收窄为「仅认未赋值」；
  NUMBER 词法收窄（`1.` / `.5` 报错）；SELECT 别名唯一性（互不相同 + 不与行字段并集冲突）；
  frontmatter 重复键剔除 + `duplicateKey` 结构化警告；warnings 结构化 `{ type, message }`。
- **测试**：`npm test` 80 例，五套件（功能 22 / 数学 29 / DSQL语言 21 / store 4 / 摄取层 4）。
- **演示 vault**：`test-vault/` 预置 18 个看板，四大类
  （功能示例 5 / 数学示例 6 / DSQL语言示例 5 / 三值示例 2），见
  [`test-vault/README.md`](test-vault/README.md)。
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
