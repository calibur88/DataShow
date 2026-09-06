# DataShow 功能展示 vault

> 本 vault 用于**功能展示与验收**（草稿开发目录专用）：用 Obsidian 打开并启用 DataShow Dev，
> 即可演示 DSQL 查询、表格/列表视图与 frontmatter 属性编辑。
> 草稿版（`datashow-dev`）构建产物自动部署到这里；正式版 vault 见 `data_show/test-vault/`。
>
> **DSQL v1.3 标记语法**：关键词用 `**` 包裹（如 `**SELECT**`）、运算符用 `%` 包裹（如 `%==%`）、
> 字符串用单引号 `'值'`、路径用双引号 `"文件夹"`。完整规范见 `data_show/docs/DSQL-EBNF.md`。

## 示例数据（示例/）

| 文件夹 | 内容 |
|---|---|
| `示例/功能示例/` | 任务A/B/C：status/owner/priority/due/blocked 字段 + 互链（属性编辑、反查链接演示） |
| `示例/数学示例/` | 订单一/二/三：价格、数量、运费、底数、指数、数值（数学运算与函数演示） |
| `示例/DSQL语言示例/` | 语法演示A/B：中文标识符、数组字段、大小写敏感标签、缺失字段（语法特性演示） |

## 预置看板（三大类）

已预置 14 个看板，按侧栏「类型」分为三大类，与单测三大类一一对应
（**DSQL语言示例 = DSQL 语法规范演示**，仅在看板面板中查询；不支持、也不计划支持 ```datashow 代码块）：

- **功能示例**（5 个）：五子句查询、SORT BY 状态机排序、反查链接列表、布尔与日期、全字段自动列；
- **数学示例**（4 个）：四则与连接、乘方与取模（含除零 null 演示）、内置函数、比较与逻辑；
- **DSQL语言示例**（5 个，语法规范演示）：省略 SELECT、子句乱序、WITHOUT ID 任意位置、中文标识符与字段缺失、空 BY 警告。

## 操作

1. 设置 → DataShow → 看板：查看/增删看板（名称/类型/说明）；
2. 左侧栏 DataShow 图标打开看板侧栏（按类型分组），点击看板在主工作区打开面板；
3. 面板 DSQL 编辑框可直接改查询（防抖自动保存），「刷新」手动重跑，「视图」下拉切换表格/列表；
4. 表格双击单元格 / 列表点击条目 / 行 ✎ 直接编辑 frontmatter，保存后结果自动刷新；
5. 结果下方折叠的调试信息展示 FROM/WHERE/SORT/LIMIT 各阶段统计（设置可关）。

## 开发

```bash
cd data_show_test  # 草稿版 → 部署到本 vault plugins/datashow-dev/
npm run build && npm test   # 测试三大类：功能 / 数学 / DSQL 语言

正式版另行构建部署：cd data_show → npm run build → data_show/test-vault/
```
