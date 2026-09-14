# DSQL 语言规范

> **DSQL**（DataShow Query Language）—— Obsidian 元数据查询方言。
> **DSQL 语言版本**：`2.4`（v2.4 新增 `**WHILE**` 循环驱动子句，`**SEARCH**` 改为由 `**WHILE**` 驱动迭代，
> 且 `**WHILE**` 边界收紧为非负整数字面量、parse 期校验；
> v2.3 新增 `**COUNT**` 分类计数子句与槽位模型，SEARCH 提前至聚合遍之前；
> v2.2 新增 `**SEARCH**` 正文抽取子句与 §6.3 算术 / 比较补丁；v2.1 新增 `[ext]` 后缀过滤）
> **文档版本**：`2.4.0`（语言版本与插件版本各自独立；2.3.1 定稿：别名两分法、LIMIT 整数、一元正负号语义；
> 2.4.0：WHILE 子句、SEARCH 双向绑定、TOTAL 对数字串的隐式转换、WHILE 边界字面量收紧）
>
> 本文档为权威依据：语法 EBNF + 语义逐条定义，语言变更需同步本文与 `tests/` 用例。

---

## 1. 设计总纲

| 属性 | 说明 |
|---|---|
| **标记体系（字面语法）** | 关键词 / 函数：`**WORD**` 包裹 · 运算符：`%op%` 包裹 · 字符串：`'...'` · 路径：`"..."` · 字段：裸标识符 |
| **子句顺序（前件关系）** | 书写顺序自由，每条子句至多一次；**WHERE / COUNT / SORT / LIMIT / WHILE 以 `**FROM**` 为前件**，**SEARCH 以 `**WHILE**` 为前件**（两者必须同时出现）；`**SELECT**` 可省略（默认 `*`） |
| **执行顺序** | FROM 源解析 → [ext] 行并入 → WHILE 驱动 SEARCH 结构匹配 → 聚合遍（TOTAL）→ WHERE 行过滤 → COUNT 分类计数 → SORT 排序 → LIMIT 截断 → SELECT 投影（与书写顺序无关，由 AST 固定） |
| **数据中立** | 不预设字段；UTF-8 字节序确定性排序 |
| **非致命语义** | 类型不匹配 / 除零 / 字段缺失求值为 null，不中断查询，计入 `warnings` |

**关键词（`**` 包裹，约定全大写；下表即全部，共 21 个）**：

| 组 | 词 |
|---|---|
| 子句 | `SELECT` `FROM` `WHERE` `WHILE` `SEARCH` `COUNT` `SORT` `LIMIT` `WITHOUT` `ID` `BY` |
| 视图 | `TABLE_VIEW` `LIST_VIEW` `CARD_VIEW` |
| 逻辑 / 别名 | `AND` `OR` `NOT` `AS` |
| 排序方向 | `ASC` `DESC` |
| 聚合项（仅 `**SELECT**` 项内合法，见 §6.7） | `TOTAL` |

`**WORD**` 只认上表成员——未收录者一律**词法错误**「未知关键词」。故 DSQL **没有** `GROUP BY` /
`HAVING`（整集合分组聚合由 `**TOTAL**` 子句承担、过滤后计数由 `**COUNT**` 子句承担，见 §6.7 / §6.11），
也不含已废除的旧视图词 `TABLE` / `LIST`。

**内置函数（`**` 包裹，约定小写）**：
`sqrt cbrt root contains length lower upper empty`

---

## 2. 词法规则（Tokens）

```ebnf
MARKED     = "**" , word , "**" ;   (* word ∈ 关键词（大写）或函数名（小写），未知即词法错误 *)

PATH       = '"' , { any - '"' } , '"' ;
STRING     = "'" , { any - "'" } , "'" ;   (* 逐字符扫描；遇 \ 读下一字符：\' → 内容 '，
                                              其余 \ 与下一字符都原样入内容（\\ → 两个反斜杠）；
                                              未转义的 ' 终止；不可跨行。推论：内容结尾 \ 个数必为偶数 *)

OP_COMPARE = "%==%" | "%!=%" | "%>=%" | "%<=%" | "%>%" | "%<%" ;
OP_CONCAT  = "%||%" ;
OP_ADD     = "%+%" | "%-%" ;
OP_MUL     = "%*%" | "%/%" | "%%%" ;
OP_POW     = "%^%" ;

IDENT      = ident_start , { ident_part } , { "." , ident_start , { ident_part } } ;
(* 支持 Unicode 字母（中文一等公民）与带点路径：file.name / this.状态 *)

VARIABLE   = "$" , ident , "$" ;     (* 槽位名：TOTAL / COUNT 的填充目标，或 SELECT 内的声明 / 引用 *)

NUMBER     = digit , { digit } , [ "." , digit , { digit } ] ;
(* 小数点后必须至少一位数字："1." 与 ".5" 均为词法错误 *)
(* 不支持科学计数法（1e3）与负数字面量；负数用一元 %-% *)

BOOLEAN    = "true" | "false" ;
NULL       = "null" ;
COMMENT    = "--" , { any } , newline ;
STAR       = "*" ;          (* 仅 **SELECT** * 全字段；** 只作为标记起始 *)
PUNCT      = "(" | ")" | "," | "#" ;
EXT_FILTER = "[" , [ ext , { "," , ext } ] , "]" ;  (* [ext] 后缀过滤，ext 不含 "]" 与 ","，原样保留 *)
(* [ ] 的两种语法角色：
   · WHERE 表达式内 —— [ext] 后缀过滤原子（§6.9）；
   · WHILE 后 —— [起始, 结束] 迭代边界（§6.12）。
   词法层不做语义区分：遇 [ 即起收集，扫描至首个 ] 止。
   括号内不做归一化，仅换行（LF / CRLF / CR）折为一个空格（CRLF 视作单个换行，不双计行号）；
   无 STRING 感知——合法查询的括号内不含 STRING（[ext] 列表与 WHILE 边界均为裸文本）。
   原样产出 [..] 片段，由 parser 按所在子句赋予语义。
   未闭合（至 EOF 无 ]）→ 词法错误。 *)
```

---

## 3. 语法规则（EBNF）

```ebnf
query          = [ view ] , { clause } , EOF ;             (* 各 clause 至多一次；WHERE/COUNT/SORT/LIMIT/WHILE 要求 FROM 已出现，SEARCH 要求 WHILE 已出现；
                                                              SELECT / WITHOUT ID / view 无前件，但整条查询必须含 FROM（缺失由收尾检查报错，见 §4） *)
clause         = select_clause | from_clause | where_clause | while_clause | search_clause | count_clause
               | sort_clause | limit_clause | without_id ;

view           = **TABLE_VIEW** | **LIST_VIEW** | **CARD_VIEW** ;  (* 缺省 TABLE_VIEW *)
without_id     = **WITHOUT** , **ID** ;                    (* 任意子句位置 *)
select_clause  = **SELECT** , select_list ;                (* 可整体省略，省略 = "*" 全字段 *)
from_clause    = **FROM** , source ;                       (* 唯一必填子句 *)
where_clause   = **WHERE** , expr ;                        (* 前件：FROM *)
while_clause   = **WHILE** , "[" , NUMBER , "," , NUMBER , "]" ;  (* 前件：FROM；至多一次；与 SEARCH 双向绑定；
                                                                    两边界须为非负整数且 起始 < 结束，parse 期校验（§6.12） *)
search_clause  = **SEARCH** , search_item , { "," , search_item } ;  (* 前件：WHILE；至多一次 *)
search_item    = STRING , **AS** , ident ;                 (* 正则 + 裸标识符别名（不接受 $变量$）；
                                                              非法正则 / 未转义 \p{ parse 期致命错误 *)
limit_clause   = **LIMIT** , NUMBER ;                      (* 前件：FROM；须为整数，小数为语法错误 *)
select_list    = "*" | select_item , { "," , select_item } ;
select_item    = expr , [ **AS** , alias ]                 (* alias 为裸标识符（仅列标签）或 $变量$（派生变量） *)
               | **TOTAL** , ( ident | NUMBER ) , **AS** , variable ;  (* 聚合项：填充 $槽位$，自声明自投影 *)
               | variable ;                                           (* 裸槽位声明（同名至多一次）；
                                                                         由 TOTAL / COUNT 填充，未填充静默忽略 *)
count_clause   = **COUNT** , count_item , { "," , count_item } ;      (* 独立子句，前件 FROM，至多一次 *)
count_item     = comparison , **AS** , variable ;                     (* 显式比较（裸操作数致命）；
                                                                         AS 强制 $槽位$，须已在 SELECT 声明 *)
alias          = ident | variable ;                        (* 两分法（DSQL 2.3.1 定稿）：*)
                                                               (* ident → 列标签：仅命名输出列，不进入变量命名空间，*)
                                                               (*          不可被 $..$ 引用；*)
                                                               (* variable → 派生变量：进入变量命名空间，*)
                                                               (*          可被更晚的列以 $..$ 引用；*)
                                                               (* 全部列标签互不相同；裸标识符标签另需与行字段池无重名，*)
                                                               (* $变量$ 标签只受变量池约束（§6.7 两池隔离） *)
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
primary        = literal | function_call | ident | variable | ext_filter
               | "(" , expr , ")" ;
variable       = "$" , ident , "$" ;                       (* 仅 SELECT 内可引用 *)
ext_filter     = EXT_FILTER ;                              (* 仅 WHERE 表达式内合法；
                                                              出现在 SELECT / SORT / FROM → 解析错误（带行列号） *)

literal        = STRING | PATH | NUMBER | BOOLEAN | NULL ;
function_call  = **函数名** , "(" , [ expr , { "," , expr } ] , ")" ;
```

**实现说明**：

- `comparison` 允许无比较符的裸操作数：此时 `concat_expr` 按**真值判断**（§6.3「真值」行：
  empty 值 / null / 0 / false / 空串 / 空数组 → 假，其余 → 真），否则 `**WHERE** **contains**(...)`
  这类写法无法成立；
- `[ext]` 支持**并置简写**：`**WHERE** [txt] status %==% 'x'` 等价于
  `**WHERE** [txt] **AND** status %==% 'x'`（`[ext]` 原子后紧跟表达式即隐式 AND，
  见 §6.9）；显式 `**AND**` 写法始终可用；
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
| `**FROM**` | ✅ | — | 唯一必填子句（数据源；唯一能提供文本的子句） |
| `**WHERE**` | ❌ | `**FROM**` | 行过滤 |
| `**WHILE**` | ❌ | `**FROM**` | 循环驱动（§6.12）；与 `**SEARCH**` 双向绑定，只写其一 → parse 期致命 |
| `**SEARCH**` | ❌ | `**WHILE**` | 正文正则抽字段（§6.10）；由 WHILE 逐轮推进游标，执行在聚合遍之前 |
| `**COUNT**` | ❌ | `**FROM**` | 分类聚合计数（§6.11）；执行于 WHERE 后 / SORT 前，与 WHERE 书写先后自由 |
| `**SORT**` | ❌ | `**FROM**` | 多级排序 + 自定义优先级 |
| `**LIMIT**` | ❌ | `**FROM**` | 截断 |
| `**WITHOUT** **ID**` | ❌ | — | 隐藏文件列，任意位置 |

**子句作用域区间**：前件规则与关键字边界共同界定各子句的区间——子句自其关键字起，至下一个子句
起始关键字止（即任何开启新子句的 `**KEYWORD**`）。SEARCH 的语法单元（`STRING **AS** ident`）是
区间内专属，跨区间即语法错误（§6.10）。此规则适用于所有子句：`**WHERE**` 的表达式、`**COUNT**` 的
比较语句、`**SORT**` 的排序项等，均只在各自区间内合法。

**「无前件」不等于「不需要 FROM」**：上表中前件为「—」的子句（视图 / `**SELECT**` / `**WITHOUT** **ID**`）
不触发前件检查，写在任何位置都合法；但整条查询必须包含 `**FROM**`。这一约束由**收尾检查**（读到 EOF）兜底，
与前件错误是两条不同分支、两种文案——实测：视图 / `**SELECT**` / `**WITHOUT** **ID**` 单独出现时报
「缺少 `**FROM**` 子句（数据源），实际为 文件结束」（列号为 EOF 位置，非子句起始位置）；
`**SELECT**` 重复 / `**FROM**` 重复则报「子句重复出现（每条子句至多一次）」。

**错误示例**：

```sql
-- ❌ WHERE 的前件 FROM 未在其之前出现
**SELECT** 任务 **WHERE** 状态 %==% '待办' **FROM** #待办
-- 报错：第 1 行第 … 列：**WHERE** 需要 **FROM** 作为前件（**FROM** 必须在其之前）

-- ❌ 同一子句出现两次
**FROM** "x" **LIMIT** 1 **LIMIT** 2
-- 报错：**LIMIT** 子句重复出现（每条子句至多一次）

-- ❌ WHILE 与 SEARCH 只写其一（双向绑定，parse 期致命）
**FROM** "x" **SEARCH** 'a' **AS** b
-- 报错：**SEARCH** 需要 **WHILE** 作为前件（**WHILE** 必须在其之前）→ 迁移：SEARCH 前补 **WHILE** [0, 1]
**FROM** "x" **WHILE** [0, 1]
-- 报错：**WHILE** 需 **SEARCH** 配合（两者必须同时出现，只写其一为 parse 期致命错误）

-- ❌ SEARCH 写在 WHILE 之前（前件约束依赖序，不约束紧邻）
**FROM** "x" **SEARCH** 'a' **AS** b **WHILE** [0, 1]
-- 报错：**SEARCH** 需要 **WHILE** 作为前件（**WHILE** 必须在其之前）

-- ❌ 整条查询缺 FROM（非前件错误：由收尾检查在 EOF 处报，列号指向 EOF）
**SELECT** 1
-- 报错：第 1 行第 13 列：缺少 **FROM** 子句（数据源），实际为 文件结束
**WITHOUT** **ID**
-- 报错：第 1 行第 19 列：缺少 **FROM** 子句（数据源），实际为 文件结束
**TABLE_VIEW**
-- 报错：第 1 行第 15 列：缺少 **FROM** 子句（数据源），实际为 文件结束

-- ❌ 子句重复（任意子句，含无前件的 SELECT / FROM）
**FROM** "a" **SELECT** 1 **SELECT** 2
-- 报错：**SELECT** 子句重复出现（每条子句至多一次）
**FROM** "a" **FROM** "b"
-- 报错：**FROM** 子句重复出现（每条子句至多一次）
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
| 其他裸标识符 | SEARCH 抽取字段 ∪ frontmatter 属性（同名已 prepare 期致命）；均不存在求值 `null` |

**裸标识符求值顺序**：`file.*` →（SEARCH 产出字段 ∪ frontmatter 键，同名已 prepare 期致命）→ `null`。

> 注：SEARCH 产出与 frontmatter 同属**行字段池**，同名冲突已在 prepare 期拦截（§6.10 冲突处理），
> 运行期无优先级问题。故此处用「∪（并集）」而非箭头串——箭头串 `file.* → SEARCH → frontmatter → null`
> 会被误读为「同名时 SEARCH 覆盖 frontmatter」，而实际两者是**对等并列**的两个源，不是优先关系。

### 6.3 类型与运算（三值语义 + 隐式数值转换，DSQL 2.2 修订）

**三种「无」的正交定义**：

| 值 | 来源 | 语义 | 运算行为 |
|---|---|---|---|
| `0` / `false` | 字面量或字段值 | 数值零 / 布尔假，**正常值** | 仅在裸真值判断中为假，其余运算一切照常（`0 %+% 1 = 1`） |
| `null` | `字段: ""` / `字段: []` / `字段: null` / `字段: ~`，或字段不存在 | 已赋值但内容为空 / 无值 | 算术 → null（**不计 warning**）；比较 → 同一性（`null %==% null` 为 true） |
| **empty 值** | `字段:`（冒号后无任何内容） | 字段存在但**从未赋值** | 与 null 行为等价（区分仅为语义溯源）；`**empty**()` 是唯一能看见它的运算 |
| **空串 `""`** | 字段值或 SEARCH 捕获组抽取 | 合法字符串值，长度为 0 | 参与比较 / 排序按字符串；算术「转不出」→ null + warning |

> SEARCH 字段只会产生 null（无匹配 / 无 body），不会产生 empty 值；empty 值仅由 frontmatter `字段:` 产生。
> 现有子句对 null 与 empty 行为等价（算术、比较、排序口径全同）；若后续引入 IS EMPTY 之类谓词再分叉。

**非原始值**（数组 / 对象，含 `[5]`、`[1,2]`、`{}`）：既不是 null 也不是 empty，
不参与算术 / 比较的隐式转换，排序恒排末尾。

| 运算 | 规则（DSQL 2.2 修订） |
|---|---|
| **算术**（`%+%` `%-%` `%*%` `%/%` `%%%` `%^%`） | ① 任一操作数 null / empty → 结果 null，**不计 warning**；② 任一操作数为非原始值 → 结果 null，**计入 warnings**（禁止 `Number([5]) === 5` 式静默转换）；③ 否则做 `Number()` 转换（布尔 → 0/1；数字串 `"123"` → 123；空串 / 全空白 / 非数值串视为**转不出**）；④ 任一转出非有限数（NaN / ±Infinity）→ null（计入 warnings）；⑤ 除零 / 取模零 → null；⑥ 结果非有限数（NaN / ±Infinity）→ null（计入 warnings，DSQL 2.3.1 定稿） |
| **一元正负号**（`%+%` / `%-%` 前缀） | 仅作用于数值；非数值（含数字串 / 布尔 / null / empty 值）→ null，不计 warning（DSQL 2.3.1 定稿） |
| **字符串连接**（`%||%`） | 任一操作数 null（含 empty 值）→ null；非字符串自动转字符串 |
| **比较**（`%==%` 族） | ① null / empty 参与 → 按同一性（`null %==% null` 为 true，其余 false；`%!=%` 取反）；② 任一操作数为非原始值 → false（守卫写在一切 `Number()` / 隐式字符串化之前，`[5] %==% "5"` 不因 toString 漏成 true）；③ 否则两边都能 `Number()` 转出有限数 → **数值比**（`"007" %==% "7"` 为 true）；两边都转不出 → 字符串比（UTF-8 字节序，区分大小写）；一边能转一边不能 → false |
| **真值**（裸真值判断） | **empty 值**、null、0、false、空串、空数组 → 假；**其余一切值为真** |

> 注：缺失字段求值 null（§6.2），不产生 empty 值；empty 值仅在「键存在但未赋值」时出现（§6.1 摄取）。
>
> **显示与导出口径**：empty 值与 null 同口径外露——三视图单元格与 CSV 字段均显示为 `—`
> （三视图渲染、CSV 导出、结果区搜索文本共用 `render/format` 的 `formatCell` 单一出口）；
> JSON 导出为 `null` 且**保留键**（不丢键）。empty 值**不得**以 `Symbol(...)` 等内部形态出现在
> 任何界面文本或导出文本中；卡片内联编辑点击未赋值字段时，输入框预填**空串**。

### 6.4 排序（确定性方案）

1. **排序比较复用 §6.3 比较口径**：两边都能 `Number()` 转出有限数 → 数值序（数字串 `"123"` / `"45"` 按数值排）；
   两边都转不出 → 字符串 UTF-8 字节流逐字节比较，公共前缀递归下降，短者在前（`'你'` < `'你好'`）；
   空串 `""` 是合法字符串值，按 UTF-8 序参与排序（排最前）；
2. **数字**按数值；**布尔**按 0/1 数值；
3. **null / empty 值 / 非原始值**：恒排末尾（无论方向），同侧按稳定序保留原相对顺序；
4. **自定义优先级**：`**SORT** 键 [方向] **BY** ('值1', '值2', ...)`——**作用于其书写的排序键**
   （写在最后即最后一个键）；列表内按位置（严格匹配）；**列表外的项恒排在列表内之后**，组内按 UTF-8 默认序；
   `**DESC**` 反转该键**非 null 项的顺序**——但反转只在**各自组内**发生，列表内恒在列表外之前
   （实测 `**SORT** x **DESC** **BY** ('a','b')` → `b, a, 其余项, null`）；空列表 `()` 视为无自定义优先级并计入 warnings；
5. **多级排序**：键按书写顺序依次比较；排序稳定；
6. **方向**：键级方向优先；`sort_item` 未写方向时默认 `**ASC**`；写在末尾的方向属于最后一个键
   （如 `**SORT** a, b **DESC**` 中 `**DESC**` 归 b）。

### 6.5 内置函数

| 函数 | 签名 | 语义 |
|---|---|---|
| `**sqrt**(x)` | number → number | 平方根（`x` 按 §6.3 隐式转换取数）；负数 → null |
| `**cbrt**(x)` | number → number | 立方根（支持负数；取数口径同上） |
| `**root**(x, n)` | (number, number) → number | n 次方根（取数口径同上）；n = 0 / 负数偶次根 → null |
| `**contains**(h, x)` | any × any → boolean | **区分大小写**：数组严格相等匹配元素；字符串子串包含 |
| `**length**(x)` | any → number | 数组 / 字符串长度；其他 null |
| `**lower**(x)` / `**upper**(x)` | string → string | 大小写转换（非字符串原样返回） |
| `**empty**(x)` | any → boolean | **当且仅当 x 为 empty 值（未赋值）时 → true**；其余一切输入——含 `""`、`[]`、`0`、`false`、null、缺失字段——均为 false |

> 数值族（`**sqrt**` / `**cbrt**` / `**root**`）按 §6.3 **隐式转换**取数：数字串（含 SEARCH 抽取的
> `"16"` 与 STRING 字面量 `'16'`）与布尔（`true` → 1 / `false` → 0）都与数字同等对待，
> 例如 `**sqrt**('16')` = 4、`**root**('16', '4')` = 2；转不出（空串 / 全空白 / 非数值串 / 数组 / null）
> → null。全语言仅**一元正负号**是例外——它只认数值本身（§6.3）。
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
| `search` | 各 SEARCH 模板按产出单元格计的命中数 / 补 null 数 / 抽取示例 ≤3（调试页 SEARCH 行；单元格 = 源行 × WHILE 迭代轮次） |
| `count` | 各 `**COUNT**` 计数项结果（调试页 COUNT 行） |
| `fieldMisses` | 缺失字段名、次数、首个示例路径 |
| `warnings` | 非致命问题列表（结构化 `type` + `message`，含次数；类型如 除零 / 类型不匹配 / 未知函数 / TOTAL / SORT / **duplicateKey**） |
| `executionTimeMs` | 执行耗时（ms） |

> warnings 与字段缺失主要由执行器在 FROM / WHERE / SORT 阶段收集；SELECT 投影在面板渲染时逐格求值，
> 其字段缺失由面板收集后并入调试信息（FIELD 条目）。非致命结果直接显示为 `—`。

### 6.7 聚合与派生变量

**两遍执行模型**：

```
第一遍 聚合遍：SEARCH 正文抽取后，扫描 FROM 全量命中行（含 [ext] 并入行，恒忽略 WHERE），
              计算所有 **TOTAL** 项 → 写入变量表
第二遍 投影遍：WHERE → **COUNT** 分类计数 → SORT → LIMIT → SELECT 逐行求值
              （$变量$ 查变量表，裸标识符查行字段）
```

> [ext] 并入行与 SEARCH 抽取均在聚合遍**之前**（TOTAL 的「全量」含非 md 行；
> 数值型 SEARCH 抽取字段可被 TOTAL 聚合）；**COUNT** 在 WHERE 之后、SORT 之前执行，
> 口径 = WHERE 过滤后行集（§6.11）。

**变量表查询规则（两套命名空间完全隔离）**：

| 名称来源 | 写法 | 命名空间 | 示例 |
|---|---|---|---|
| frontmatter / `file.*` | 裸标识符 | 行字段命名空间 | `姓名`、`file.name` |
| **SEARCH** 抽取 | 裸标识符 | 行字段命名空间 | `待办`、`章节号`（与上一行同池） |
| **TOTAL** 聚合 | `$变量$` | 变量命名空间 | `$总成绩$` |
| 表达式派生（`**AS** $变量$`） | `$变量$` | 变量命名空间 | `$平均分$` |

- `$平均分$` → 查变量表；`平均分` → 查行字段；`**AS** $变量$` 定义的派生别名自动进入变量表
  （裸标识符别名仅作列标签，不进入变量表——§3 alias 两分法，DSQL 2.3.1 定稿）；
- SELECT 列表**从左到右**计算，前面的派生变量可被后面的列引用（链式派生），不可反向引用；
  **变量表在查询开始时即建为空表**，链式派生与查询是否含 `**TOTAL**` / `**COUNT**` 无关——
  `**SELECT** 单价 %*% 数量 **AS** $小计$, $小计$ %*% 0.8 **AS** $折扣价$` 在无任何聚合项时同样成立；
- 变量仅存在于当前查询执行期间，不写回任何数据；**仅 SELECT 内可引用**
  （WHERE / SORT 中出现 `$变量$` 为致命错误——每行派生变量在投影阶段才计算，时序上不可用）。

**两池互不越界——三堵墙**：行字段池（裸标识符）与变量池（`$变量$`）彼此独立，由三堵墙保证互不越界：

| 墙 | 规则 | 错误类别 | 期次 |
|---|---|---|---|
| 读写墙 | `$变量$` 仅 SELECT 可引用，WHERE / SORT 引用即致命 | 名称绑定错误 | parse |
| 循环依赖墙 | 聚合项内不得引用聚合变量（如 `**TOTAL** $c$ **AS** $x$` 与 `**COUNT** … **AS** $c$` 互引） | — | parse 致命 |
| 结构墙 | SEARCH 模板（`STRING **AS** ident`）越出 SEARCH 区间即致命 | 语法结构错误 | parse |

两类 parse 期错误分法：**语法结构错**（报「多余的查询子句」）与**名称绑定错**（报「仅可在 SELECT 引用」）
文案不同，须区分（实测文案见 §6.10）。

三堵墙只约束**越界使用**；两池之间的**重名**不构成冲突——`$状态$`（变量池）与 `status`（行字段池）
可以同名共存，各读各池（DSQL 2.4 定稿；DSQL 1.5 曾按「别名唯一性」把 `$变量$` 别名与行字段同名
判为致命，属跨池误判，已废除）。

**列标签与行字段的唯一性规则（致命错误，聚合遍开始前检查）**：

1. SELECT 内所有 `**AS**` 列标签**互不相同**——裸标识符标签与 `$变量$` 标签都产出同名列，故同属
   标签命名空间，重复定义即报错；
2. **裸标识符列标签**不得与行字段池中的名称重复——判定范围是 FROM **全量命中行的字段名并集**
   ∪ SEARCH 别名，任一行出现过该字段名即冲突（不要求所有行都有）；
   `**AS** $变量$` 是变量池名称，只受第 1 条约束，**不与行字段池校验**（两池隔离）。

违反任一条 → 致命错误，直接报错不执行：

```sql
-- ❌ 两个 AS 标签同名
**SELECT** 成绩 %+% 1 **AS** x, 成绩 %+% 2 **AS** x **FROM** "学生"
-- 报错：别名 'x' 重复定义（SELECT 内 **AS** 别名互不相同）

-- ❌ 裸标识符列标签与行字段冲突（任一命中行出现过字段「平均分」即冲突）
**SELECT** 成绩 %+% 1 **AS** 平均分 **FROM** "学生"
-- 报错：列标签 '平均分' 与现有字段名冲突，请改用其他别名

-- ✅ $变量$ 别名与行字段同名不报错：$平均分$ 读变量表（TOTAL 和），平均分 读行字段
**SELECT** **TOTAL** 成绩 **AS** $平均分$, 平均分 **FROM** "学生"
```

**TOTAL 计算规则**：

| 输入 | 结果 |
|---|---|
| 数值字段 / 数字串 | 整集合（FROM 全量，恒忽略 WHERE）非 null 数值之和（走 §6.3 隐式转换——SEARCH 抽取的 `"100"` 可求和；null / 缺失跳过；非数值跳过并计入 warnings） |
| 全无数值 / 空表 | `null`（计入 warnings） |
| 常量 `**TOTAL** 1` | 总行数（`COUNT(*)` 的等价替代；`**TOTAL** 0` 恒为 0） |

- `**TOTAL**` 产出 **FROM 全量集合的单标量**（DSQL 2.4 起：含 `**WHILE**` 驱动的匹配后行集，见 §6.12），
  **恒忽略 WHERE**（全局基准值，供每行算占比 / 偏差）；
  过滤后聚合暂不支持——变通：单独建看板，或用标签 / 子文件夹等数据源缩小口径使 TOTAL 恰为所需范围；
- `**TOTAL**` 在聚合遍计算，晚于 WHILE + SEARCH 匹配（§6.10 / §6.12）：数值型抽取字段**可以**被 TOTAL 聚合
  （DSQL 2.3 起，DSQL 2.4 起按 §6.3 对数字串隐式转换）；早于 **COUNT**（§6.11），因此**无法聚合 COUNT 的计数结果**；
- `**TOTAL**` 的 `**AS**` 强制 `$槽位$` 写法（DSQL 2.3 破坏性修订）：聚合项自声明自投影，
  SELECT 内裸 `$x$` 槽位与 TOTAL 填充同名 → parse 期致命「重复声明」（`$x$` 引用直接指向填充值），
  裸名别名 → parse 期致命；
- SELECT **仅含槽位 / TOTAL 项**（且至少一个 TOTAL）时输出单行合成结果（文件名「汇总」）；
- 派生变量列为**只读**（卡片视图内联编辑不生效；列表视图以辅助信息行展示）。

### 6.8 错误处理

- 解析错误**带行列号**，格式 `[DSQL] 第 N 行第 M 列：预期 X，实际 Y`，直接报错不执行；
- 词法层拦截：未知 `**WORD**`、未包裹的关键词 / 运算符、字符串未闭合、非法数字（`1.` / `.5`）；
- 运行期非致命：类型不匹配、除零、未知函数、字段缺失 → null 或过滤掉，并计入 warnings；
- 摄取期容错（重复键等）见 §6.1。

### 6.9 [ext] 后缀过滤（非 md 数据源）

`**WHERE**` 表达式中的原子 `[ext]`（可 `**AND**` / `**OR**` / `**NOT**` 组合）把 FROM 目录下的
非 md 文件接入查询。后缀**不做归一化**：写什么匹配什么（`[.TXT]` / `[Txt]` / `[-]` 均按字面
处理），与 `file.ext` 严格相等；无白名单，解析不了按失败处理。

```sql
**TABLE_VIEW** **SELECT** status **AS** 状态, message **AS** 信息
**FROM** "示例/logs"
**WHERE** [txt, mp4] status %!=% 'error'
**SORT** priority **ASC**
```

**执行语义（WHERE 阶段分两步，顺序不可调换）**：

1. **文件级**：抽 `[ext]` → 从 **FROM** 目录集合筛文件 → 按后缀分派解析器 → 建行并入行集。
   分派规则：`md` → 官方路径（metadataCache frontmatter，无回退）；非 md → 自研路径
   （cachedRead + 自研 YAML 子集解析，失败剔除并在结果区尾部渲染「解析失效」列表，
   上限见设置 `failedFileListLimit`）。两条路径正交，同一文件只走一条。
2. **行级**：其余 WHERE 条件（含 `[ext]` 自身）在合并行集上求值。`[ext]` 按行判断——
   行的 `file.ext` 属于该节点自己的后缀列表（`[]` 恒真），因此 `[txt] **OR** status %==% 'x'`
   的 OR 意图完整保留，`[txt] **AND** [mp4]` 得空结果。

**读取范围 = FROM 命中的目录集合**（禁止全库扫描）；`**FROM** #标签` 不触发非 md 读取，
只对现有 md 行做行级过滤。三态收集：没写 `[ext]` → 零触发（现状）；出现 `[]` → 读目录下
全部文件（与其它 `[ext]` 同现时仍归全部）；其余 → 各 `[ext]` 后缀的并集。

**语义对照**：

| 写法 | 结果 |
|---|---|
| `[txt]` | 只剩 txt 行（全部来自本次读取） |
| `[md]` | 只剩 md 行（md 交官方路径） |
| `[txt] **AND** status %==% 'x'` | txt 行里 status='x' 的 |
| `[txt] **OR** status %==% 'x'` | 全部 txt 行 + 满足 status 的 md 行 |
| `**NOT** [txt]` | 只剩 md 行（txt 文件仍会被读入再滤掉） |
| `[]` | FROM 目录下所有文件（md + 非 md） |
| 不写 `[...]` | 完全现状 |

**已知方言差异**（两条路径正交，同写法允许不同结果）：md 同名键 → 文件剔除 + duplicateKey
warning，非 md → 收集为数组；`yes` / 日期等官方类型推断在非 md 为自研方言（裸字符串等）；
嵌套结构非 md 不可见（`键:` 无子行产出 null）。**TOTAL** 恒基于 FROM 全量命中行——
[ext] 行并入先于聚合遍，非 md 行计入 TOTAL（占比类计算的全部分母）。非 md 文件变更由查询级
刷新兜底（vault 事件去抖 300ms 重跑），不建立常驻监听、不进索引器；`file.outlinks` /
`file.inlinks` 对非 md 恒为空数组。

---

### 6.10 SEARCH 正文抽取器（DSQL 2.2；2.4 起由 `**WHILE**` 驱动）

SEARCH 是**正文抽取器，不是过滤器**：从每行 body 用正则抽取内容，挂成行字段，
与 frontmatter 字段、`file.*` 平级，后续 WHERE / SORT / LIMIT / SELECT 全部可用。
DSQL 2.4 起 SEARCH 不再单独出现——由 `**WHILE**`（§6.12）驱动逐轮推进游标。

| 属性 | 说明 |
|---|---|
| 位置 | 独立子句（不是函数——不进表达式、不与 AND / OR / NOT 组合、至多一次、无括号形式） |
| 前件 | `**WHILE**`（2.4 起；双向绑定，缺一即 parse 期致命） |
| 对行的作用 | 行级：正文正则抽字段；每轮迭代取下一个匹配（不足补 null） |
| 产出 | 行字段（原始字符串，逐字符保留，不做类型推断） |

```sql
**TABLE_VIEW** **SELECT**
  书名, 章节号, 标题
**FROM** "小说"
**WHILE** [0, 1]
**SEARCH**
  '第([一二三四五六七八九十百\d]+)章' **AS** 章节号,
  '\[(.+?)\]' **AS** 标题
**WHERE** [gnd] **AND** 章节号 %!=% null
**SORT** 章节号 **ASC**
-- 两组 search_item 仍只配 [0, 1]：每篇 1 行、每轮各模板各取一个匹配
-- （`**WHILE**` 的 N 是**轮数**，与 `search_item` 个数无关，见 §6.12）
```

**词法**：STRING 解析规则见 §2（全语言生效，非 SEARCH 专有）。

**作用域（区间专属）**：`STRING **AS** ident` 是 SEARCH 的语法单元，只在 SEARCH 子句区间内合法。
SEARCH 区间以 `**SEARCH**` 起始，以下一个子句起始关键字（`**WHERE**` / `**COUNT**` / `**SORT**` /
`**LIMIT**` 等，即任何开启新子句的 `**KEYWORD**`）为终点。
区间外出现 `STRING **AS** ident` → parse 期致命——这是**语法结构错误**。注意 DSQL 中 STRING 本身是
合法表达式原子（`**WHERE** '年龄：'` 可单独 parse 成功），故越界的实际表现是 `**AS**` 成为「多余子句」。
这与「`$变量$` 在 WHERE / SORT 内不可引用」——**名称绑定错误**（该上下文不绑定该名字）——是两类不同
错误，报错文案区分（下表为实测）：

| 越界写法 | 错误性质 | 实测报错 |
|---|---|---|
| `**WHERE** 'regex' **AS** 姓名` | 语法结构错误 | 多余的查询子句「`**AS**`」（子句：SELECT / FROM / WHERE / WHILE / SEARCH / COUNT / SORT / LIMIT / WITHOUT ID，每条至多一次） |
| `**WHERE** $x$ %==% 1` | 名称绑定错误 | 变量 `$x$` 仅可在 `**SELECT**` 中引用（WHERE / `**SORT**` 无法看到每行派生变量） |

```sql
-- ❌ 语法结构错误：SEARCH 模板越界到 WHERE（STRING 是合法表达式原子，AS 沦为多余子句）
**FROM** "笔记"
**WHILE** [0, 3]
**SEARCH** '姓名：(.+)' **AS** 姓名
**WHERE** '年龄：(\d+)' **AS** 年龄
-- 报错：多余的查询子句「**AS**」（子句：SELECT / FROM / WHERE / WHILE / SEARCH / COUNT / SORT / LIMIT / WITHOUT ID，每条至多一次）

-- ❌ 名称绑定错误：变量引用越界到 WHERE
**WHERE** $姓名$ %==% '张三'
-- 报错：变量 $姓名$ 仅可在 **SELECT** 中引用（WHERE / **SORT** 无法看到每行派生变量）
```

同时明确：SEARCH 的 `**AS**` 别名是**裸 ident（行字段）**，不是 `$变量$` 槽位——
SEARCH 产出进入**行字段池**，与 frontmatter / `file.*` 平级，WHERE / SORT / TOTAL / COUNT / SELECT
全流水线可读（双向因果：WHERE 能用它，因为它是裸 ident；它是裸 ident，因为抽取器要交给下游消费）。

**裸标识符求值顺序**：见 §6.2（`file.*` →（SEARCH 产出字段 ∪ frontmatter 键，同名已 prepare 期致命）→ `null`）。

**单次出现**：`**SEARCH**` 子句至多一次（重复 → parse 期致命「**SEARCH** 子句重复出现」）；
多字段需求由**单条 SEARCH 的多个 `search_item`** 覆盖（`'a' **AS** x, 'b' **AS** y`），无需写多条 SEARCH。

**与 [ext] 的交互**：SEARCH 对 `[ext]` 触发的非 md 行同样生效——body 取剥围栏后的剩余文本；
md 行与 [ext] 并入行在 SEARCH 阶段一视同仁（这也是「FROM 唯一提供文本」的体现：
范围由 FROM 决定，SEARCH 只按 body 抽取）。

**求值语义（逐轮推进）**：第 k 轮（k 从 0 起，共 `结束 - 起始` 轮）取该模板在 body 中的**第 k+1 个匹配**——
有捕获组取 `m[1]`，`m[1] === undefined`（可选捕获组未匹配）回落 `m[0]`；无捕获组取 `m[0]`；
匹配数不足 → **null**（不是 empty 值，不是 ""），不提前停、不 warning。无 body → 该行所有轮次字段全 null。
`**WHILE** [0, 1]` 即退化为「只取首个匹配」，等价于 DSQL 2.3 及以前的行为（迁移口径）。

**body 来源（仅查询含 SEARCH 时按需读取，随行临时携带、不缓存不常驻）**：

- **md**：`cachedRead` + `frontmatterPosition.end.offset` 剥离；有 frontmatter → 去掉**一个**前导 `\n`
  （分隔符不属 body，其后连续空行属 body）；无 frontmatter → body = 全文，不去前导 `\n`；
  其余字符原样保留不 trim；禁用正则法剥离（会误伤正文水平线 `---`）；
- **非 md**：剥掉全部 `trim() === "---"` 独立行及其之间的内容（与自研解析器围栏语义一致）；
  围栏成对翻转，未闭合 / 奇数个 → 其后内容剥到 EOF；只认这一种围栏，``` / ~~~ / 缩进围栏原样保留；
  已知取舍：非 md 正文中的水平线 `---`、以及奇数个 `---` 导致的尾部剥离，均与自研解析器
  围栏语义对齐，属已知取舍；
- **末尾换行不规范化**：JS 无 m flag 时 `$` 严格匹配输入末尾（区别于 Python/PCRE）——
  body 末尾有 `\n` 时 `'第(\d+)章$'` 匹配不上，须写 `'第(\d+)章\n?$'`；
- body 只作 SEARCH 的内部求值输入，`file.body` 不进 §6.2 字段表（SELECT / WHERE 中求值 null）；
  匹配范围仅 body，不含文件名 / 路径 / frontmatter / 围栏内容。

**正则规则**：STRING 字面量；parse 期 `new RegExp` 编译一次运行期复用；非法正则 → parse 期
致命错误带行列号；**用户语法层无 flags**（不支持 i / m / g / s / u），大小写敏感（与 contains 口径一致）；
`^` / `$` 锚整个 body，`.` 不跨行（跨行写 `[\s\S]`）——实现层为逐轮推进游标，会基于同一 source
**预构造一个全局副本、逐行重置 `lastIndex` 复用**（不影响用户可见语义）；parse 期扫描 STRING 内容，
连续反斜杠个数为奇数且其后紧接 `p{` / `P{` → 致命错误（非 u 模式下 `\p` 是 identity escape，
静默退化为字面 p，用户写的 CJK 断言永远匹配不上且不报错）；偶数个反斜杠后跟 `p{` 是字面文本，
不报错；CJK 请用字符范围 `[一-鿿]`。

**冲突处理（分两阶段）**：

| 阶段 | 冲突 | 错误 |
|---|---|---|
| parse 期（AST 静态可判定） | SEARCH 别名互相重复；SEARCH 别名与 SELECT 的**裸标识符列标签**同名（两者同属行字段池） | 致命，带行列号 |
| prepare 期（FROM 元数据收集后、抽取前） | SEARCH 别名与 FROM 命中行的 frontmatter 字段名并集冲突；与 `file.*` 内置字段冲突 | 致命，错误信息带 SEARCH 别名的行列号（parse 期记录进 AST） |

两处判定都只覆盖**行字段池**：`**AS** $变量$` 输出别名是变量池名称，与 SEARCH 别名同名**不冲突**
（两池隔离，§6.7）——例如 `**SELECT** 姓名 **AS** $x$, 待办 … **SEARCH** '…' **AS** x` 合法。

**调试**：§6.6 调试信息新增 `search` 字段——各模板按**产出单元格**计命中数 / 补 null 数 / 抽取示例 ≤3
（DSQL 2.4 起：单元格 = 源行 × 迭代轮次）。
**TOTAL 口径**：恒忽略 WHERE，基于 FROM 全量命中行（含 [ext] 非 md 行）经 WHILE 匹配后的行集（含补 null 行，§6.12）；
SEARCH 在聚合遍之前执行，数值型抽取字段（含数字串）可被 TOTAL 聚合；**COUNT** 计数在聚合遍之后，TOTAL 不可见。

### 6.11 COUNT 分类计数（DSQL 2.3）

`**COUNT**` 是独立子句（不是函数、不进表达式）：对 **WHERE 过滤后行集**逐行求显式比较语句，
为真的行数（标量）填充 SELECT 声明的 `$槽位$`。

| 属性 | 说明 |
|---|---|
| 位置 | 独立子句，与 WHERE 同层书写；前件 `**FROM**`（与 WHERE 书写先后自由） |
| 执行遍 | WHERE 之后、SORT 之前；无 `**WHERE**` 时直接接在聚合遍之后 |
| 口径 | WHERE 过滤后行集；无 WHERE 时 = FROM 全量命中行（含 [ext] 并入行） |
| 输入 | 一条显式比较语句 `left <cmp_op> right`（裸操作数 → parse 期致命） |
| 输出 | 为真的行数，填充 `$槽位$`；空行集 → 0，不 warning |
| 求值口径 | 复用 §6.3 比较表（null 同一性 / 非原始值守卫 / 隐式数值转换）；求值异常的行不计入并计入 warnings |
| 可引用 | SEARCH 抽取字段 ✓、[ext] 并入行 ✓（均先于 COUNT 执行）；聚合变量 ✗（循环依赖致命） |

```sql
-- 分类计数（多槽位）
**TABLE_VIEW** **SELECT**
  state, $过载数$, $无事发生$
**FROM** "示例"
**COUNT**
  state %==% '过载' **AS** $过载数$,
  state %==% '无' **AS** $无事发生$

-- 恒真惯用法：true %==% true = WHERE 过滤后行数（SQL COUNT(*) 等价；与 TOTAL 1 全量口径对照）
**SELECT**
  **TOTAL** 1 **AS** $全量$,
  $过滤文件数$
**FROM** "示例/logs"
**WHERE** [md, gnd]
**COUNT** true %==% true **AS** $过滤文件数$
```

**槽位模型（三集合满射）**：S = SELECT 里声明的裸 `$x$` 项；F = TOTAL / COUNT 的 `**AS**` 填充名。

1. 裸 `$x$` 项 = 槽位声明，同名至多一次（重复 → parse 期致命「槽位 $x$ 重复声明」）；
2. COUNT 的 `**AS** $x$` 必须已在 SELECT 声明（未声明 → 致命「映射名 $x$ 未在 SELECT 声明」；
   TOTAL 项自声明自填充，不受此限）；裸 `$x$` 声明与 TOTAL 填充同名 → 致命「槽位 $x$ 重复声明」
   （与 COUNT 填充同名 = 合法配对，书写顺序不限）；
3. 声明了未填充的槽位 → **静默忽略**（不投影、不报错）；
4. 一个槽位至多被一个聚合填充（TOTAL / COUNT 共享命名空间，双填充 → 致命「槽位 $x$ 已被填充」）；
5. `expr **AS** $x$` 的 `$x$` 是输出别名，不构成可填充槽位（聚合指向它 → 致命「非槽位声明」）；
   与同名裸槽位声明撞名 → 致命「重复声明」（统一命名空间）；
6. `$x$` 引用（SELECT 表达式内）须指向槽位 / 聚合填充名或更早的输出别名（未声明 → 致命）；
   `$x$` 出现在 WHERE / SORT → parse 期致命（执行在聚合之前，值尚不存在）。

**与 TOTAL 的两口径对照**：`**TOTAL**` 与 `**COUNT**` 产出形式相同（填充槽位），求值位置不同——
**TOTAL：FROM 全量集合的单标量（恒忽略 WHERE）**；**COUNT：WHERE 过滤后行集的单标量（无 WHERE 时
退化为 FROM 全量）**。两者互不引用，只能通过 SELECT 数学表达式组合（如 `$全量$ %-% $过载数$`）。

### 6.12 WHILE 循环驱动（DSQL 2.4）

`**WHILE**` 是**循环驱动者**（独立子句，不是 SEARCH 的修饰符）：为 `**SEARCH**` 模板提供迭代机制，
驱动其在一行 body 上多次结构匹配，每次迭代产出一行。

| 属性 | 值 |
|---|---|
| 归属 | 独立子句（顶级 clause） |
| 前件 | `**FROM**` |
| 被依赖 | `**SEARCH**`（SEARCH 的前件 = WHILE） |
| 出现次数 | 至多一次 |
| 与 SEARCH | **必须同时出现**——只写其一 → parse 期致命 |

**语法（形态唯一）**：

```ebnf
while_clause = **WHILE** , "[" , NUMBER , "," , NUMBER , "]" ;
```

- 两个 `NUMBER` 字面量，方括号包裹，逗号分隔；无其它形式（无嵌套、无 `**BY**`、无方向词）；
- 边界**只能是字面量**：字段引用 / 函数调用 / 算术 / 字符串 / `$变量$` 一概不接受（v2.4 定稿收紧）；
- 顶层逗号分隔两边界；括号内不做归一化，仅换行折为空格（§2）；
- 片段内的词法错误按 `[` 的位置重定位**绝对列号**。

**前件语义**：约束数据依赖，不约束书写位置——WHILE 只要求「FROM 已出现」，SEARCH 只要求「WHILE 已出现」，
三者可被其它子句穿插（`FROM → SORT → WHILE → WHERE → SEARCH` 合法）。

**边界校验（parse 期静态，三类错误各一文案）**：

| 约束 | 内容 | 违反（parse 期致命） |
|---|---|---|
| 时机 | parse 期静态校验（**非**运行期） | — |
| 类型 | 两边界均须为 `NUMBER` 字面量 | 「`**WHILE**` 起始/结束边界须为 NUMBER 字面量（非负整数，如 [0, 3]），实际为「…」」 |
| 整数 | 值须为非负整数（`NUMBER` 允许小数，故需额外校验） | 「`**WHILE**` 起始/结束边界须为非负整数（实际为 0.5）」 |
| 大小 | 起始 `<` 结束 | 「`**WHILE**` 起始边界须小于结束边界（当前 [5, 2]，迭代次数须为正）」 |

**迭代次数 = 结束 - 起始**（parse 期即确定，运行期恒定、与行无关）。

**迭代语义**：

| 项 | 值 |
|---|---|
| 迭代序列 | `起始, 起始+1, …, 结束-1` |
| 迭代次数 | `结束 - 起始`（C 风格 `for (i=a; i!=b; i++)`） |
| 每行产出 | 固定 `结束 - 起始` 行（即使全部匹配不足、全为 null 也照产，过滤交 WHERE） |
| 游标推进 | 每轮迭代各 search_item 的游标推进一次，取第 k+1 个匹配；匹配不足 → null，不提前停 |
| 轮次变量 | **无** `$i$`、无循环索引——起始的绝对值不影响结果，只决定迭代次数（`[0, 3]` ≡ `[2, 5]`） |

> **N 与 `search_item` 个数无关**：`**WHILE** [起始, N]` 的迭代次数只由边界之差决定，与 SEARCH 写几组
> `search_item` 无关。多字段是**同一轮内多模板各取一个匹配**（单条 SEARCH 的多 item，§6.10），
> **不因字段数而增大 N**；反之增大 N 只改变行数（多取第 2…N 个匹配），不增加列。
> 例：两组 `search_item` 配 `**WHILE** [0, 1]` → 每源行 **1** 行；改成 `[0, 2]` → 每源行 **2** 行
> （第 2 轮匹配不足的部分补 null，是否留下交 WHERE）。

**执行位置**：

```
FROM 源解析 → [ext] 并入 → WHILE + SEARCH 结构匹配 → 聚合遍（TOTAL）→ WHERE → COUNT → SORT → LIMIT → SELECT
```

WHILE 驱动的 SEARCH 匹配**先于**聚合遍——TOTAL / COUNT 均基于匹配后行集计算。

**错误处理**：

| 场景 | 判定 | 结果 |
|---|---|---|
| WHILE 无 SEARCH | parse 期 | 致命：「**WHILE** 需 **SEARCH** 配合」 |
| SEARCH 无 WHILE（或写在 WHILE 之前） | parse 期 | 致命：「**SEARCH** 需要 **WHILE** 作为前件」 |
| WHILE 前件 FROM 未出现 | parse 期 | 致命（带行列号）：「**WHILE** 需要 **FROM** 作为前件」 |
| WHILE 子句重复 | parse 期 | 致命：「**WHILE** 子句重复出现（每条子句至多一次）」 |
| SEARCH 子句重复 | parse 期 | 致命：「**SEARCH** 子句重复出现（每条子句至多一次）」 |
| 缺右方括号 | 词法期 | 致命（`[` 未闭合） |
| 缺逗号 / 非两边界 / 空片段 | parse 期 | 致命（带行列号）：「**WHILE** 需两个边界」「…边界不能为空」 |
| 边界非 `NUMBER`（字段 / 函数 / 算术 / 字符串 / `$变量$`） | parse 期 | 致命：「…边界须为 `NUMBER` 字面量（非负整数，如 [0, 3]）」 |
| 边界非非负整数（小数） | parse 期 | 致命：「…边界须为非负整数（实际为 0.5）」 |
| 起始 ≥ 结束 | parse 期 | 致命：「**WHILE** 起始边界须小于结束边界（当前 [5, 2]，迭代次数须为正）」 |

> **单次出现**：`**WHILE**` 与 `**SEARCH**` 各至多一次，重复即上表致命；多字段需求由**单条 SEARCH 的
> 多个 `search_item`** 覆盖（`'a' **AS** x, 'b' **AS** y`），无需（也不允许）写多条 SEARCH。

**示例**：

```sql
-- 基础：每篇固定 5 轮，逐轮抽取待办
**TABLE_VIEW** **SELECT** file.name, 待办, **TOTAL** 1 **AS** $全量槽位$
**FROM** "会议纪要"
**WHILE** [0, 5]
**SEARCH** '- \[ \] (.+)' **AS** 待办
**WHERE** 待办 %!=% null

-- 穿插：WHILE 后、SEARCH 前写 WHERE；FROM 后、WHILE 前写 SORT
**FROM** "会议纪要"
**SORT** file.name **ASC**
**WHILE** [0, 20]
**WHERE** 状态 %==% '待办'
**SEARCH** '- \[ \] (.+)' **AS** 待办

-- 两口径正交：TOTAL 计匹配后行集（含补 null），COUNT 计实际匹配
**TABLE_VIEW** **SELECT** **TOTAL** 1 **AS** $全量$, $有效待办$
**FROM** "会议纪要"
**WHILE** [0, 5]
**SEARCH** '- \[ \] (.+)' **AS** 待办
**COUNT** 待办 %!=% null **AS** $有效待办$

-- 边界为字面量：轮数在 parse 期即确定（[0, 3] ≡ [2, 5]，起始的绝对值不影响结果）
**FROM** "章节"
**WHILE** [0, 3]
**SEARCH** '^## (.+)' **AS** 小节标题

-- 轮数 ≠ 字段数：两组 search_item 仍只配 [0, 1] → 每篇 1 行（列有两列，轮数不因此变成 2）
**TABLE_VIEW** **SELECT** file.name **AS** 文件, 章节号, 标题
**FROM** "示例/文章示例"
**WHILE** [0, 1]
**SEARCH**
  '第([一二三四五六七八九十百\d]+)章' **AS** 章节号,
  '\[(.+?)\]' **AS** 标题
**WHERE** 章节号 %!=% null
-- 实测（演示库 2 篇有章节）：凡人修仙传 | 2 | 经典；斗破苍穹 | 一 | 名场面 —— 共 2 行
-- 若把边界改成 [0, 2]，则每篇 2 行；第 2 轮两模板均无匹配 → 章节号 null → 被 WHERE 滤掉，
-- 故在这份数据上两者行数相同（各 2 行）——差异只在「有没有可能取到第 2 个匹配」。
```

**口径小结（WHILE + SEARCH 场景下的三条规则）**：

1. **TOTAL 口径** = 匹配后行集（WHILE 产生的全部行，含补 null 行），恒忽略 WHERE；
2. **COUNT 口径** = WHERE 过滤后行集——`**TOTAL** 1` 与 `**COUNT** 槽位 %!=% null` 之差
   即补 null 行数，两者相除即抽取效率；
3. **TOTAL 可聚合 SEARCH 字段**：SEARCH 产出为原始字符串，TOTAL 按 §6.3 隐式转换求和
   （数字串可转，非数值串跳过并计 warnings）。

**破坏性（DSQL 2.4）**：① `**SEARCH**` 不再可单独出现，既有 SEARCH-only 查询需补 `**WHILE** [0, 1]`
（等价于旧行为）；② `**WHILE**` 边界收紧为**非负整数字面量**（parse 期校验），此前「字段 / 函数 / 算术
表达式作边界」的写法不再可用（v2.4 尚未发布，故无已发布查询受影响）；`**WHILE**` 为新增关键词——
此前不在关键词表，故无历史查询受影响；裸标识符 `while` / `$while$` / 字符串 `'**WHILE**'` 均不受影响
（词法隔离）。

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

-- 7. 子句乱序（合法：FROM 是 WHERE / COUNT / SORT / LIMIT / WHILE 的前件）
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

-- 10. TOTAL 整集合聚合（FROM 全量、恒忽略 WHERE）+ 派生占比（$总量$ 先定义后引用）
**SELECT**
  **TOTAL** 销量 **AS** $总量$,
  任务,
  销量,
  销量 %/% $总量$ **AS** 占比
**FROM** "订单"

-- 11. ❌ WHERE 的前件 FROM 未在其之前出现（解析器报错）
**SELECT** 任务 **WHERE** 状态 %==% '待办' **FROM** #待办

-- 12. WHILE 驱动 SEARCH 逐轮抽取（每篇固定 5 轮；匹配不足补 null，交 WHERE 过滤）
**TABLE_VIEW** **SELECT**
  file.name **AS** 文件,
  待办
**FROM** "示例/待办示例"
**WHILE** [0, 5]
**SEARCH** '- \[ \] (.+)' **AS** 待办
**WHERE** 待办 %!=% null
```
