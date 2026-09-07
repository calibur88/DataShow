# DSQL 语言规范

> **DSQL**（DataShow Query Language）—— Obsidian 元数据查询方言。
> **DSQL 语言版本**：`2.0`（视图关键词统一 `*_VIEW` 后缀，新增 `CARD_VIEW`，废除旧 `TABLE` / `LIST`）
> **文档版本**：`2.1.0`（随插件 2.1.0 发布；语言版本与插件版本各自独立）
>
> 本文档为权威依据：语法 EBNF + 语义逐条定义，语言变更需同步本文与 `tests/` 用例。

---

## 1. 设计总纲

| 属性 | 说明 |
|---|---|
| **标记体系（字面语法）** | 关键词 / 函数：`**WORD**` 包裹 · 运算符：`%op%` 包裹 · 字符串：`'...'` · 路径：`"..."` · 字段：裸标识符 |
| **子句顺序（前件关系）** | 书写顺序自由，每条子句至多一次；**WHERE / SORT / LIMIT 以 `**FROM**` 为前件**；`**SELECT**` 可省略（默认 `*`） |
| **执行顺序** | 聚合遍（TOTAL）→ FROM 源解析 → WHERE 行过滤 → SORT 排序 → LIMIT 截断 → SELECT 投影（与书写顺序无关，由 AST 固定） |
| **数据中立** | 不预设字段；UTF-8 字节序确定性排序 |
| **非致命语义** | 类型不匹配 / 除零 / 字段缺失求值为 null，不中断查询，计入 `warnings` |

**关键词（`**` 包裹，约定全大写）**：
`SELECT FROM WHERE SORT BY AND OR NOT AS LIMIT ASC DESC TABLE_VIEW LIST_VIEW CARD_VIEW WITHOUT ID TOTAL`

**内置函数（`**` 包裹，约定小写）**：
`sqrt cbrt root contains length lower upper empty`

---

## 2. 词法规则（Tokens）

```ebnf
MARKED     = "**" , word , "**" ;   (* word ∈ 关键词（大写）或函数名（小写），未知即词法错误 *)

PATH       = '"' , { any - '"' } , '"' ;
STRING     = "'" , { any - "'" } , "'" ;   (* 均支持 \ 转义引号与反斜杠，不可跨行 *)

OP_COMPARE = "%==%" | "%!=%" | "%>=%" | "%<=%" | "%>%" | "%<%" ;
OP_CONCAT  = "%||%" ;
OP_ADD     = "%+%" | "%-%" ;
OP_MUL     = "%*%" | "%/%" | "%%%" ;
OP_POW     = "%^%" ;

IDENT      = ident_start , { ident_part } , { "." , ident_start , { ident_part } } ;
(* 支持 Unicode 字母（中文一等公民）与带点路径：file.name / this.状态 *)

VARIABLE   = "$" , ident , "$" ;     (* 派生变量引用，value 为裸名 *)

NUMBER     = digit , { digit } , [ "." , digit , { digit } ] ;
(* 小数点后必须至少一位数字："1." 与 ".5" 均为词法错误 *)
(* 不支持科学计数法（1e3）与负数字面量；负数用一元 %-% *)

BOOLEAN    = "true" | "false" ;
NULL       = "null" ;
COMMENT    = "--" , { any } , newline ;
STAR       = "*" ;          (* 仅 **SELECT** * 全字段；** 只作为标记起始 *)
PUNCT      = "(" | ")" | "," | "#" ;
```

---

## 3. 语法规则（EBNF）

```ebnf
query          = [ view ] , { clause } , EOF ;             (* 各 clause 至多一次；WHERE/SORT/LIMIT 要求 FROM 已出现 *)
clause         = select_clause | from_clause | where_clause
               | sort_clause | limit_clause | without_id ;

view           = **TABLE_VIEW** | **LIST_VIEW** | **CARD_VIEW** ;  (* 缺省 TABLE_VIEW *)
without_id     = **WITHOUT** , **ID** ;                    (* 任意子句位置 *)
select_clause  = **SELECT** , select_list ;                (* 可整体省略，省略 = "*" 全字段 *)
from_clause    = **FROM** , source ;                       (* 唯一必填子句 *)
where_clause   = **WHERE** , expr ;                        (* 前件：FROM *)
limit_clause   = **LIMIT** , NUMBER ;                      (* 前件：FROM *)
select_list    = "*" | select_item , { "," , select_item } ;
select_item    = expr , [ **AS** , alias ]                 (* 别名为裸标识符或 $变量$，归一化为裸名 *)
               | **TOTAL** , ( ident | NUMBER ) , **AS** , alias ;  (* 聚合项：别名强制 *)
alias          = ident | variable ;                        (* 归一化为裸名，进入变量命名空间 *)
                                                               (* 全部别名互不相同，且不得与行字段同名（§6.7） *)
source         = or_source ;
or_source      = and_source , { **OR** , and_source } ;      (* **AND 优先于 OR** *)
and_source     = source_primary , { **AND** , source_primary } ;
source_primary = "(" , source , ")" | PATH | "#" , ident ;

sort_clause    = **SORT** , [ **BY** ] , sort_item , { "," , sort_item } ;
sort_item      = expr , { sort_modifier } ;                (* 各 modifier 至多一次，先后不限 *)
sort_modifier  = **ASC** | **DESC** | custom_order ;
custom_order   = **BY** , "(" , [ literal_list ] , ")" ;    (* 作用于其书写的 sort_item；空列表 () 视为无自定义优先级并计入 warnings *)
(* 写在末尾的方向属于最后一个 sort_item（而非"子句级"） *)
literal_list   = literal , { "," , literal } ;

(* ---------- 表达式（优先级从低到高） ---------- *)
expr           = or_expr ;
or_expr        = and_expr , { **OR** , and_expr } ;
and_expr       = not_expr , { **AND** , not_expr } ;
not_expr       = **NOT** , not_expr | comparison ;
comparison     = concat_expr , [ cmp_op , concat_expr ] ;  (* 无比较符 = 裸真值判断 *)
cmp_op         = %==% | %!=% | %>% | %<% | %>=% | %<=% ;

concat_expr    = add_expr , { %||% , add_expr } ;
add_expr       = mul_expr , { ( %+% | %-% ) , mul_expr } ;
mul_expr       = pow_expr , { ( %*% | %/% | %%% ) , pow_expr } ;
pow_expr       = unary_expr , { %^% , unary_expr } ;       (* 右结合 *)
unary_expr     = ( %+% | %-% ) , unary_expr | primary ;
primary        = literal | function_call | ident | variable | "(" , expr , ")" ;
variable       = "$" , ident , "$" ;                       (* 仅 SELECT 内可引用 *)

literal        = STRING | PATH | NUMBER | BOOLEAN | NULL ;
function_call  = **函数名** , "(" , [ expr , { "," , expr } ] , ")" ;
```

**实现说明**：

- `comparison` 允许无比较符的裸操作数：此时 `concat_expr` 按**真值判断**（§6.3「真值」行：
  empty 值 / null / 0 / false / 空串 / 空数组 → 假，其余 → 真），否则 `**WHERE** **contains**(...)`
  这类写法无法成立；
- `**WITHOUT** **ID**` 可写在任意子句位置；
- 省略 `**SELECT**` 时投影为 `*`（自动列 = 结果行字段并集，按 **UTF-8 字节序**排列）；
- PATH 在表达式内等价字符串字面量；
- 标记内大小写不敏感（约定关键词大写、函数小写），未知 `**WORD**` 词法直接报错；
- 【实现受限标注 ①】Obsidian `metadataCache` 解析后丢失原始 YAML，`字段:`（未赋值）与 `字段: null`
  在实现层同为 null 无法区分；实现按「键存在但值为 null → empty 值」近似，
  即 `字段: null` / `字段: ~` 亦映射为 empty 值（§6.1 摄取规则）；
- 【实现受限标注 ②】重复键检测基于插件自扫描 frontmatter 原文的顶层键（键名同名即判重复），
  与 Obsidian 缓存「后值覆盖前值」的折叠口径不同，以本文 §6.1 摄取规则为准。

---

## 4. 子句前件规则

书写顺序自由，但每条子句至多出现一次，且子句的前件必须已在其之前出现。

| 子句 | 必须 | 前件 | 说明 |
|---|---|---|---|
| `**TABLE_VIEW**` / `**LIST_VIEW**` / `**CARD_VIEW**` | ❌ | — | 视图，缺省 `TABLE_VIEW`，写在最前 |
| `**SELECT**` | ❌ | — | 省略 = `*` 全字段；可写在任意位置 |
| `**FROM**` | ✅ | — | 唯一必填子句（数据源） |
| `**WHERE**` | ❌ | `**FROM**` | 行过滤 |
| `**SORT**` | ❌ | `**FROM**` | 多级排序 + 自定义优先级 |
| `**LIMIT**` | ❌ | `**FROM**` | 截断 |
| `**WITHOUT** **ID**` | ❌ | — | 隐藏文件列，任意位置 |

**错误示例**：

```sql
-- ❌ WHERE 的前件 FROM 未在其之前出现
**SELECT** 任务 **WHERE** 状态 %==% '待办' **FROM** #待办
-- 报错：第 1 行第 … 列：**WHERE** 需要 **FROM** 作为前件（**FROM** 必须在其之前）

-- ❌ 同一子句出现两次
**FROM** "x" **LIMIT** 1 **LIMIT** 2
-- 报错：**LIMIT** 子句重复出现（每条子句至多一次）
```

---

## 5. 运算符优先级（从高到低）

| 优先级 | 运算符 | 结合性 | 说明 |
|---|---|---|---|
| 1 | `%^%` | **右结合** | 乘方 |
| 2 | `%+%` `%-%`（一元） | — | 正负号 |
| 3 | `%*%` `%/%` `%%%` | 左结合 | 乘、除、取模 |
| 4 | `%+%` `%-%`（二元） | 左结合 | 加、减 |
| 5 | `%||%` | 左结合 | 字符串连接 |
| 6 | `%==%` `%!=%` `%>%` `%<%` `%>=%` `%<=%` | — | 比较 |
| — | **NOT** < **AND** < **OR** | — | 逻辑（最低层） |

---

## 6. 语义规则

### 6.1 数据源与 frontmatter 摄取

**数据源**：

| 形式 | 语义 |
|---|---|
| `"文件夹"` | 该目录及全部子目录的 `.md`（**大小写不敏感**） |
| `A **OR** B` / `A **AND** B` | 并集 / 交集，可括号组合；**AND 优先于 OR** |
| `#标签` | frontmatter `tags` 包含该标签（大小写不敏感） |

**frontmatter 摄取规则**：每篇笔记的 frontmatter 键值对原样入行（数组保持数组），并按下表归一：

| 源写法 | 摄取结果 | 说明 |
|---|---|---|
| `字段: 值` | 原值 | 正常有值字段 |
| `字段: ""` / `字段: []` | `null` | 已赋值但内容为空 → null（空容器值） |
| `字段:` / `字段: null` / `字段: ~` | **empty 值** | 字段存在但未赋值（实现近似口径见 §3 受限标注 ①） |

**重复键（容错规则）**：同一笔记 frontmatter 中出现同名键时，**该文件从结果集中剔除**，
计入 warnings（类型 `duplicateKey`，含文件名与字段名）；原始键值对保留在 `sourceStats` / notes 档案供排查；
查询继续执行，不中断：

```sql
-- 某笔记 frontmatter：
-- ---
-- age: 20
-- age: 22
-- ---
-- ❌ 该笔记不进入任何查询结果
-- warnings：duplicateKey（文件 "某笔记"，字段 "age"）
```

**摄取容错策略**：摄取环节各类异常的统一口径——

| 异常 | 口径 |
|---|---|
| frontmatter 重复键 | 剔除该文件 + `duplicateKey` warnings，查询继续 |
| frontmatter 解析失败 | 口径待补充（占位） |
| 类型异常（如 tags 非数组） | 口径待补充（占位） |

### 6.2 字段解析

| 字段 | 语义 |
|---|---|
| `file.name` / `file.path` / `file.folder` / `file.ext` / `file.size` / `file.ctime` / `file.mtime` | 文件元数据 |
| `file.outlinks` / `file.inlinks` | 出链目标路径数组 / 入链来源路径数组 |
| `this.xxx` | 上下文行字段（看板面板为 null） |
| 其他裸标识符 | frontmatter 属性；不存在求值 null |

### 6.3 类型与运算（三值语义）

**三种「无」的语义（三者正交，不得混用）**：

| 值 | 产生方式 | 含义 | 运算行为 |
|---|---|---|---|
| `0` / `false` | 字面量或字段值 | 数值零 / 布尔假，**正常值** | 仅在裸真值判断中为假，其余运算一切照常（`0 %+% 1 = 1`） |
| `null` | `字段: ""`、`字段: []`（空容器） | 已赋值但内容为空 | 算术 / 连接 → null（计入 warnings）；比较 → false |
| **empty 值** | `字段:`（冒号后无任何内容） | 字段存在但**从未赋值** | 除 `empty()` 外的一切运算按 null 传播（算术 → null + warning，比较 → false） |

| 运算 | 规则 |
|---|---|
| **算术**（`%+%` `%-%` `%*%` `%/%` `%%%`） | 数字运算；非数字 → null（计入 warnings）；除零 / 取模零 → null |
| **乘方**（`%^%`） | 支持分数指数；结果非有限数（如负数开偶次方）→ null |
| **字符串连接**（`%||%`） | 任一操作数 null（含 empty 值）→ null；非字符串自动转字符串 |
| **比较** | 数字按数值；字符串按 UTF-8 字节序；null 或 empty 值参与 → false（`%!=%` 为其取反；`null %==% null` → true 同一性） |
| **真值**（裸真值判断） | **empty 值**、null、0、false、空串、空数组 → 假；**其余一切值为真** |

> 注：缺失字段求值 null（§6.2），不产生 empty 值；empty 值仅在「键存在但未赋值」时出现（§6.1 摄取）。

### 6.4 排序（确定性方案）

1. **字符串**：UTF-8 字节流逐字节比较，公共前缀递归下降，短者在前（`'你'` < `'你好'`）；
2. **数字**按数值；**布尔** false < true；
3. **null**：恒排末尾（无论方向）；
4. **自定义优先级**：`**SORT** 键 [方向] **BY** ('值1', '值2', ...)`——**作用于其书写的排序键**
   （写在最后即最后一个键）；列表内按位置（严格匹配）；列表外排后按 UTF-8 默认序；
   `**DESC**` 反转该键非 null 部分（null 仍沉底）；空列表 `()` 视为无自定义优先级并计入 warnings；
5. **多级排序**：键按书写顺序依次比较；排序稳定；
6. **方向**：键级方向优先；`sort_item` 未写方向时默认 `**ASC**`；写在末尾的方向属于最后一个键
   （如 `**SORT** a, b **DESC**` 中 `**DESC**` 归 b）。

### 6.5 内置函数

| 函数 | 签名 | 语义 |
|---|---|---|
| `**sqrt**(x)` | number → number | 平方根；负数 → null |
| `**cbrt**(x)` | number → number | 立方根（支持负数） |
| `**root**(x, n)` | (number, number) → number | n 次方根；n = 0 / 负数偶次根 → null |
| `**contains**(h, x)` | any × any → boolean | **区分大小写**：数组严格相等匹配元素；字符串子串包含 |
| `**length**(x)` | any → number | 数组 / 字符串长度；其他 null |
| `**lower**(x)` / `**upper**(x)` | string → string | 大小写转换（非字符串原样返回） |
| `**empty**(x)` | any → boolean | **当且仅当 x 为 empty 值（未赋值）时 → true**；其余一切输入——含 `""`、`[]`、`0`、`false`、null、缺失字段——均为 false |

> 忽略大小写的包含：`**contains**(**lower**(标签), '随笔')`。

### 6.6 调试信息（默认关，设置可开）

| 字段 | 内容 |
|---|---|
| `from` | 输入总行数 → 源解析后的命中行数（去重后，已被重复键剔除的文件不计入） |
| `sourceStats` | 各叶子数据源（文件夹 / 标签）及其贡献行数；重复键文件的原始键值对档案 |
| `where` | 过滤前 / 后行数 + 被剔除示例路径（最多 3 条） |
| `sort` | 排序键、方向、自定义优先级列表、比较次数 |
| `limit` | 截断前 / 后行数 |
| `aggregates` | 各 `**TOTAL**` 项结果（调试页 AGG 行） |
| `fieldMisses` | 缺失字段名、次数、首个示例路径 |
| `warnings` | 非致命问题列表（结构化 `type` + `message`，含次数；类型如 除零 / 类型不匹配 / 未知函数 / TOTAL / SORT / **duplicateKey**） |
| `executionTimeMs` | 执行耗时（ms） |

> warnings 与字段缺失主要由执行器在 FROM / WHERE / SORT 阶段收集；SELECT 投影在面板渲染时逐格求值，
> 其字段缺失由面板收集后并入调试信息（FIELD 条目）。非致命结果直接显示为 `—`。

### 6.7 聚合与派生变量

**两遍执行模型**：

```
第一遍 聚合遍：扫描 FROM 全量命中行（恒忽略 WHERE），计算所有 **TOTAL** 项 → 写入变量表
第二遍 投影遍：WHERE → SORT → LIMIT → SELECT 逐行求值（$变量$ 查变量表，裸标识符查行字段）
```

**变量表查询规则（两套命名空间完全隔离）**：

| 名称来源 | 写法 | 命名空间 | 示例 |
|---|---|---|---|
| frontmatter / `file.*` | 裸标识符 | 行字段命名空间 | `姓名`、`file.name` |
| **TOTAL** 聚合 | `$变量$` | 变量命名空间 | `$总成绩$` |
| 表达式派生（**AS**） | `$变量$` | 变量命名空间 | `$平均分$` |

- `$平均分$` → 查变量表；`平均分` → 查行字段；AS 定义的别名（含表达式派生列）自动进入变量表；
- SELECT 列表**从左到右**计算，前面的派生变量可被后面的列引用（链式派生），不可反向引用；
- 变量仅存在于当前查询执行期间，不写回任何数据；**仅 SELECT 内可引用**
  （WHERE / SORT 中出现 `$变量$` 为致命错误——每行派生变量在投影阶段才计算，时序上不可用）。

**别名唯一性规则（致命错误，聚合遍开始前检查）**：

1. SELECT 内所有 `**AS**` 别名**互不相同**（重复定义即报错）；
2. 任何别名**不得与行字段命名空间中的字段名重复**——判定范围是 FROM **全量命中行的字段名并集**，
   任一行出现过该字段名即冲突（不要求所有行都有，也不限是否含 TOTAL 项）。

违反任一条 → 致命错误，直接报错不执行：

```sql
-- ❌ 两个 AS 别名同名
**SELECT** 成绩 %+% 1 **AS** $x$, 成绩 %+% 2 **AS** $x$ **FROM** "学生"
-- 报错：别名 '$x$' 重复定义（SELECT 内别名互不相同）

-- ❌ 别名与行字段冲突（任一命中行出现过字段「平均分」即冲突）
**SELECT** **TOTAL** 成绩 **AS** $平均分$, 平均分 **FROM** "学生"
-- 报错：别名 '$平均分$' 与现有字段名冲突，请改用其他别名
```

**TOTAL 计算规则**：

| 输入 | 结果 |
|---|---|
| 数值字段 | 全表非 null 数值之和（null / 缺失跳过；非数值跳过并计入 warnings） |
| 全无数值 / 空表 | `null`（计入 warnings） |
| 常量 `**TOTAL** 1` | 总行数（`COUNT(*)` 的等价替代；`**TOTAL** 0` 恒为 0） |

- `**TOTAL**` 的行集口径恒为 FROM 全量命中行，**始终忽略 WHERE**（全局基准值，供每行算占比 / 偏差）；
  过滤后聚合暂不支持——变通：单独建看板，或用标签 / 子文件夹等数据源缩小口径使 TOTAL 恰为所需范围；
- SELECT **仅含 TOTAL 项**时输出单行合成结果（文件名「汇总」，列名为变量名）；
- 派生变量列为**只读**（卡片视图内联编辑不生效；列表视图以辅助信息行展示）。

### 6.8 错误处理

- 解析错误**带行列号**，格式 `[DSQL] 第 N 行第 M 列：预期 X，实际 Y`，直接报错不执行；
- 词法层拦截：未知 `**WORD**`、未包裹的关键词 / 运算符、字符串未闭合、非法数字（`1.` / `.5`）；
- 运行期非致命：类型不匹配、除零、未知函数、字段缺失 → null 或过滤掉，并计入 warnings；
- 摄取期容错（重复键等）见 §6.1。

---

## 7. 完整查询示例

```sql
-- 1. 标准表格 + 四则运算
**TABLE_VIEW** **SELECT**
  书名,
  价格 %+% 运费 **AS** 总成本,
  库存 %*% 价格 **AS** 货值
**FROM** "书籍"
**WHERE** 状态 %==% '在售' **AND** 库存 %>% 0
**SORT** 价格 **DESC**
**LIMIT** 20

-- 2. 乘方 + 开方（勾股定理）
**SELECT**
  直角边A, 直角边B,
  **sqrt**((直角边A %^% 2) %+% (直角边B %^% 2)) **AS** 斜边
**FROM** "三角形"
**WHERE** 直角边A %>% 0 **AND** 直角边B %>% 0

-- 3. 自定义优先级 + 多级排序
**SELECT** 任务, 状态
**FROM** #待办
**SORT** 状态 **BY** ('已完成', '进行中', '待办'), 截止日期 **ASC**

-- 4. 字符串连接 + contains
**SELECT**
  作者 %||% '：' %||% 标题 **AS** 条目
**FROM** "文章"
**WHERE** **contains**(标签, '随笔') **OR** 字数 %>% 5000

-- 5. 列表视图 + 取模（SELECT 可省略）
**LIST_VIEW** **SELECT** 序号 %%% 2 **AS** 奇偶
**FROM** #清单
**WHERE** 序号 %!=% null

-- 6. 任意次方根
**SELECT** 值, **root**(值, 3) **AS** 立方根, **root**(值, 4) **AS** 四次方根
**FROM** "数学"
**WHERE** 值 %>% 0

-- 7. 子句乱序（合法：FROM 是 WHERE / SORT / LIMIT 的唯一前件）
**LIST_VIEW** **FROM** "笔记" **SORT** 日期 **DESC** **WHERE** 状态 %==% '进行中'

-- 8. 键级方向 + 多个 custom_order（末尾 **DESC** 属于最后一个键 截止日期）
**SELECT** 任务, 状态, 优先级
**FROM** #待办
**SORT**
  状态 **BY** ('已完成', '进行中', '待办'),
  优先级 **DESC** **BY** ('P0', 'P1', 'P2'),
  截止日期 **ASC**

-- 9. 卡片视图（Kanban 看板，卡片内字段值可内联编辑）
**CARD_VIEW** **SELECT** 任务, 状态, 负责人
**FROM** "Notes"
**SORT** 优先级 **ASC**

-- 10. TOTAL 全表聚合 + 派生占比（$总量$ 恒忽略 WHERE；先定义后引用）
**SELECT**
  **TOTAL** 销量 **AS** $总量$,
  任务,
  销量,
  销量 %/% $总量$ **AS** 占比
**FROM** "订单"

-- 11. ❌ WHERE 的前件 FROM 未在其之前出现（解析器报错）
**SELECT** 任务 **WHERE** 状态 %==% '待办' **FROM** #待办
```
