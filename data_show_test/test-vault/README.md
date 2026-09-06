# DataShow 功能展示 vault

> 本 vault 仅用于**功能展示**：用 Obsidian 打开并启用对应插件，即可演示
> DSQL 查询、表格/列表视图与 frontmatter 属性编辑。
> 看板配置：**设置 → 第三方插件 → DataShow → 看板**（只填名称/类型/说明）；
> **DSQL 在看板面板里编辑**（输入自动保存，「刷新」立即重跑，「视图」下拉切换表格/列表）。
>
> **DSQL v1.3 标记语法**：关键词用 `**` 包裹（如 `**SELECT**`）、运算符用 `%` 包裹（如 `%==%`）、
> 字符串用单引号 `'值'`、路径用双引号 `"文件夹"`。完整规范见 `docs/DSQL-EBNF.md`。

---

## 一、查询结构（子句按前件关系，书写顺序自由）

```
[TABLE | LIST]  [**SELECT** 列 [AS 别名], ...]  [**WITHOUT** **ID**]  **FROM** 数据源  [**WHERE** 表达式]  [**SORT** ...]  [**LIMIT** 数字]
```

- 视图 `**TABLE**`/`**LIST**` 可省略（默认 TABLE）；
- **子句书写顺序自由**，每条子句至多出现一次；**WHERE / SORT / LIMIT 以 `**FROM**` 为前件**（`**FROM**` 必须写在它们之前），`**SELECT**` 无前件、可写在任意位置；
- `**SELECT**` 可省略（默认 `*` 全部字段，自动取结果里出现过的字段）；
- `**WITHOUT** **ID**` 隐藏表格首列「文件」，可写在任意子句位置；
- `--` 开头是注释；错误会在「查询结果」区直接显示（带行列号）。

---

## 二、数据源（**FROM**）

| 写法 | 含义 |
|---|---|
| `"Notes"` | 文件夹（含全部子文件夹，大小写不敏感） |
| `"Notes" **OR** "Projects"` | 并集 |
| `"Notes" **AND** #task` | 交集 |
| `#task` | 含该标签的笔记 |
| `("Notes" **OR** "Projects") **AND** ...` | 括号组合 |

> **AND 优先于 OR**：`"A" **OR** "B" **AND** #x` 等价 `"A" **OR** ("B" **AND** #x)`，复杂组合建议加括号。

---

## 三、字段

| 写法 | 含义 |
|---|---|
| `status`、`owner`、`涉及人物` | frontmatter 属性（中文直接写，不存在为 null） |
| `file.name` / `file.path` / `file.folder` / `file.ext` | 文件名/路径/文件夹/扩展名 |
| `file.size` / `file.ctime` / `file.mtime` | 大小 / 创建 / 修改时间 |
| `file.outlinks` / `file.inlinks` | 出链 / 入链（路径数组） |
| `this.字段` | 当前笔记字段（看板面板无上下文 → null） |

---

## 四、运算符（全部用 %% 包裹）与函数（用 ** 包裹）

| 类别 | 运算符 |
|---|---|
| 比较 | `%==%` `%!=%` `%>%` `%<%` `%>=%` `%<=%` |
| 连接 | `%||%`（字符串拼接） |
| 算术 | `%+%` `%-%` `%*%` `%/%` `%%%`（取模） `%^%`（乘方，右结合） |
| 逻辑 | `**AND**` `**OR**` `**NOT**` |

- `%==%` 按字节精确匹配（区分大小写）；`%>%` 等数字按数值、文字按 UTF-8 字节序；
- 字符串用单引号：`'进行中'`；数字直接写：`%>% 0`；
- 类型不匹配、除零、缺字段 → null，不报错。

| 函数 | 说明 | 示例 |
|---|---|---|
| `**sqrt**(x)` / `**cbrt**(x)` | 平方根 / 立方根 | `**sqrt**(值)` |
| `**root**(x, n)` | n 次方根 | `**root**(值, 3)` |
| `**contains**(a, b)` | 包含，**区分大小写**（数组严格匹配元素；字符串子串） | `**contains**(tags, 'urgent')` |
| `**length**(x)` | 数组/字符串长度 | `**length**(涉及人物) %>% 2` |
| `**lower**(x)` / `**upper**(x)` | 转小写 / 大写 | `**contains**(**lower**(status), 'todo')` |
| `**empty**(x)` | null / 空串 / 空数组 | `**empty**(owner)` |

> 忽略大小写的包含：`**contains**(**lower**(字段), '值')`。

---

## 五、**SORT** 排序

```sql
-- 基础（UTF-8 字节序：你好AAAA < 你好AAAB，a < 你，Z < a；null 恒最后）
**SORT** file.name **ASC**

-- 多级排序（键级方向）
**SORT** owner **ASC**, priority **DESC**

-- 自定义优先级：列表内的值按位置排（作用于其书写的排序键）
**SORT** status **BY** ('已完成', '进行中')

-- 优先级 + 方向（**DESC** 反转该键非 null 部分，null 仍最后）
**SORT** status **BY** ('已完成', '进行中') **DESC**

-- 多级排序 + 优先级写在最后一个键上
**SORT** owner **ASC**, status **BY** ('已完成')
```

---

## 六、可复制示例

演示数据（多项目结构）：
- `Notes/任务A|B|C.md`（任务字段 + 互链）、`Notes/子组/归档任务.md`（子文件夹递归演示）
- `Projects/Alpha/`（需求评审/开发/测试）与 `Projects/Beta/`（设计/开发/联调）：同 schema 多组数据（project/owner/priority/spent/estimate/tags）

**1. 任务表（推荐先试这个）**

```sql
**TABLE** **SELECT**
  status **AS** 状态,
  owner **AS** 负责人,
  priority **AS** 优先级
**FROM** "Notes"
**WHERE** status %==% '进行中'
**SORT** priority **ASC**
```

**2. 状态机优先级排序**

```sql
**SELECT** file.name **AS** 任务, status **AS** 状态
**FROM** #task
**SORT** status **BY** ('已完成', '进行中')
```

**3. 全字段自动列**

```sql
**SELECT** *
**FROM** "Notes"
**WHERE** status %!=% null
```

**4. 计算 + 连接**

```sql
**TABLE** **SELECT**
  file.name **AS** 名称,
  priority %*% 10 **AS** 权重,
  owner %||% '负责' **AS** 标注
**FROM** "Notes"
**WHERE** **contains**(tags, 'task') **AND** priority %>=% 2
**SORT** priority **DESC**
**LIMIT** 10
```

**5. 列表 + 反查链接（省略 SELECT，按执行顺序书写）**

```sql
**LIST**
**FROM** "Notes"
**WHERE** **contains**(file.outlinks, "Notes/任务A.md")
```

**6. 布尔 / 日期字段**

```sql
**SELECT** file.name **AS** 名称, due **AS** 截止, blocked **AS** 阻塞
**FROM** "Notes"
**WHERE** blocked
**SORT** due **ASC**
```

**7. 子文件夹与标签交集**

```sql
**SELECT** status **AS** 状态, owner **AS** 负责人
**FROM** "Notes" **AND** #task
**WHERE** **contains**(tags, 'archived')
```

---

## 七、功能展示清单（逐条在面板里跑）

| # | 展示点 | 示例 |
|---|---|---|
| 1 | 标准五子句查询 | 示例 1 |
| 2 | 省略 SELECT（默认全字段） | 示例 3、5 |
| 3 | 子句乱序（书写顺序自由，FROM 为 WHERE/SORT/LIMIT 前件） | `**FROM** "Notes" **SORT** priority **DESC** **WHERE** done` |
| 4 | 出链反查（file.outlinks） | 示例 5（任务B、任务C 出现在结果中） |
| 5 | 子文件夹递归 | `**SELECT** file.name **FROM** "Notes"` 含「归档任务」 |
| 6 | 布尔/日期字段 | 示例 6 |
| 7 | 标签 + contains | 示例 7、示例 2 |
| 8 | 修改笔记属性后结果自动刷新 | 随手改一篇笔记的 status |
| 9 | 跨目录：父目录递归 | `**FROM** "Projects"` 含 Alpha、Beta 全部 6 篇 |
| 10 | 跨目录：多级排序分组内排序 | 看板「跨项目总览」（project 分组、组内 priority 降序） |
| 11 | 跨目录：数值表达式（进度） | 看板「跨项目总览」优先级列；DSQL 1.3 系列看板 |
| 12 | 属性编辑 | 见第八节（表格双击 / 列表点击 / ✎ 弹窗） |

---

## 八、属性编辑（看板数据直接改）

| 位置 | 交互 |
|---|---|
| 表格视图 | 双击单元格（直接 frontmatter 字段）→ 输入框 → **回车保存**（Esc / 失焦取消还原） |
| 列表视图 | 点击条目 → 打开属性编辑弹窗（YAML 全量编辑，Ctrl/Cmd+Enter 保存） |
| 表格行 | 悬停文件列出现 **✎** → 点击打开属性编辑弹窗 |

- 内联输入自动转型：空 / `null` → null，`true` / `false` → 布尔，数字 → 数值，其余为字符串；
- 数组、`file.*`、表达式列不可内联编辑，请用 ✎ 弹窗改 YAML；
- 保存走官方 `processFrontMatter` 写回 → 索引增量更新 → 查询结果**自动刷新**；
- 工具条「刷新」可随时手动重跑。

## 九、常见错误

| 报错 | 原因 |
|---|---|
| `未知关键词 **xxx**` | 拼错，或函数名大小写不对 |
| `缺少 **FROM** 子句` | 没写数据源（`**FROM**` 是唯一必填子句） |
| `**WHERE** 需要 **FROM** 作为前件` | `**WHERE**`/`**SORT**`/`**LIMIT**` 写在了 `**FROM**` 之前 |
| `**xxx** 子句重复出现` | 同一子句写了两次 |
| `无法识别的运算符` | 运算符没 `%` 包裹（如写了 `=`，应为 `%==%`） |
| `字符串未闭合` | 单引号没成对 |

## 十、调试信息（默认开）

设置 → DataShow → 「显示 DSQL 调试信息」。开启时查询结果下方折叠显示：
`FROM` 命中行数、`SRC` 各数据源贡献行数、`WHERE` 过滤前后（含被剔除示例路径）、
`SORT` 排序详情与比较次数、`LIMIT` 截断、`FIELD` 字段缺失次数与示例路径、
`WARN` 非致命问题（除零/类型不匹配等，含次数）、`TIME` 执行耗时。
解析错误格式：`[DSQL] 第 N 行第 M 列：…`。排查 DSQL 问题全靠它。
