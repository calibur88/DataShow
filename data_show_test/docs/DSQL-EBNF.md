# DSQL 语法规范 v1.3（EBNF）

> **DSQL**（DataShow Query Language）—— Obsidian 元数据查询方言
> **DSQL 版本**：1.3（2026-09-08，测试修订 1.3.001） · 实现：`src/query/lexer.ts` · `parser.ts` · `executor.ts`
> **注**：DSQL 语言版本与插件发布版本各自独立（当前插件 1.4.0 实现 DSQL 1.3）。
> 本文档为权威依据：语法 EBNF + 语义逐条定义，变更需同步本文与测试。

---

## 1. 设计总纲

| 属性 | 说明 |
|---|---|
| **标记体系（字面语法）** | 关键词/函数：`**WORD**` 包裹 · 运算符：`%op%` 包裹 · 字符串：`'...'` · 路径：`"..."` · 字段：裸标识符 |
| **子句顺序（前件关系）** | 书写顺序自由，每条子句至多一次；**WHERE / SORT / LIMIT 以 `**FROM**` 为前件**；`**SELECT**` 可省略（默认 `*`） |
| **执行顺序** | FROM 源解析 → WHERE 行过滤 → SORT 排序 → LIMIT 截断 → SELECT 投影（与书写顺序无关，由 AST 固定） |
| **数据中立** | 不预设字段；UTF-8 字节序确定性排序 |
| **非致命语义** | 类型不匹配/除零/字段缺失求值为 null，不中断查询 |

**关键词（`**` 包裹，约定全大写）**：`SELECT FROM WHERE SORT BY AND OR NOT AS LIMIT ASC DESC TABLE LIST WITHOUT ID`
**内置函数（`**` 包裹，约定小写）**：`sqrt cbrt root contains length lower upper empty`

---

## 2. 词法规则（Tokens）

```ebnf
MARKED     = "**" , word , "**" ;   (* word ∈ 关键词（大写）或函数名（小写），未知即词法错误 *)
PATH       = '"' , { any - '"' } , '"' ;
STRING     = "'" , { any - "'" } , "'" ;   (* 均支持 \转义引号与反斜杠，不可跨行 *)

OP_COMPARE = "%==%" | "%!=%" | "%>=%" | "%<=%" | "%>%" | "%<%" ;
OP_CONCAT  = "%||%" ;
OP_ADD     = "%+%" | "%-%" ;
OP_MUL     = "%*%" | "%/%" | "%%%" ;
OP_POW     = "%^%" ;

IDENT      = ident_start , { ident_part } , { "." , ident_start , { ident_part } } ;
(* 支持 Unicode 字母（中文一等公民）与带点路径：file.name / this.状态 *)

NUMBER     = digit , { digit } , [ "." , { digit } ] ;
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

view           = **TABLE** | **LIST** ;                    (* 缺省 TABLE *)
without_id     = **WITHOUT** , **ID** ;                    (* 任意子句位置 *)
select_clause  = **SELECT** , select_list ;                (* 可整体省略，省略 = "*" 全字段 *)
from_clause    = **FROM** , source ;                       (* 唯一必填子句 *)
where_clause   = **WHERE** , expr ;                        (* 前件：FROM *)
limit_clause   = **LIMIT** , NUMBER ;                      (* 前件：FROM *)
select_list    = "*" | select_item , { "," , select_item } ;
select_item    = expr , [ **AS** , ident ] ;               (* 别名为裸标识符；无别名：字段用路径名，表达式为 列N *)

source         = or_source ;
or_source      = and_source , { **OR** , and_source } ;      (* **AND 优先于 OR** *)
and_source     = source_primary , { **AND** , source_primary } ;
source_primary = "(" , source , ")" | PATH | "#" , ident ;

sort_clause    = **SORT** , [ **BY** ] , sort_item , { "," , sort_item } ;
sort_item      = expr , { sort_modifier } ;                (* 各 modifier 至多一次，先后不限 *)
sort_modifier  = **ASC** | **DESC** | custom_order ;
custom_order   = **BY** , "(" , [ literal_list ] , ")" ;    (* 作用于其书写的 sort_item；写在最后即最后一个键；空列表 () 视为无自定义优先级并计入 warnings *)
(* 写在末尾的方向属于最后一个 sort_item（而非"子句级"）；执行器的子句级 dir 字段保留备用，当前文法不产生 *)
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
primary        = literal | function_call | ident | "(" , expr , ")" ;

literal        = STRING | PATH | NUMBER | BOOLEAN | NULL ;
function_call  = **函数名** , "(" , [ expr , { "," , expr } ] , ")" ;
```

**实现说明（对原规范的标注）**：
- `comparison` 允许无比较符的裸操作数：此时 `concat_expr` 按**真值判断**（§6.3「真值」行：
  null / false / 空串 / 空数组 → 假，其余 → 真），否则 `**WHERE** **contains**(...)` 无法成立（规范 §7 示例 4 即此用法）；
- `WITHOUT ID` 可写在任意子句位置；
- 省略 `**SELECT**` 时投影为 `*`（自动列 = 结果行字段并集，按 **UTF-8 字节序**排列）；
- PATH 在表达式内等价字符串字面量（宽松处理）；
- 标记内大小写不敏感（约定关键词大写、函数小写），未知 `**WORD**` 词法直接报错。

---

## 4. 子句前件规则

书写顺序自由，但每条子句至多出现一次，且子句的前件必须已在其之前出现。
**前件检查时机**：解析器按文本出现顺序扫描子句，遇到 WHERE / SORT / LIMIT 时，
若此前尚未出现 FROM，立即报错；SELECT / WITHOUT ID 无前件要求：

| 子句 | 必须 | 前件 | 说明 |
|---|---|---|---|
| `[TABLE LIST]` | ❌ | — | 视图，缺省 TABLE，写在最前 |
| `**SELECT**` | ❌ | — | 省略 = `*` 全字段；可写在任意位置 |
| `**FROM**` | ✅ | — | 唯一必填子句（数据源） |
| `**WHERE**` | ❌ | `**FROM**` | 行过滤 |
| `**SORT**` | ❌ | `**FROM**` | 多级排序 + 自定义优先级 |
| `**LIMIT**` | ❌ | `**FROM**` | 截断 |
| `**WITHOUT** **ID**` | ❌ | — | 隐藏文件列，任意位置 |

**错误示例（解析器报错）**：

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
| 1 | %^% | **右结合** | 乘方 |
| 2 | %+% %-%（一元） | — | 正负号 |
| 3 | %*% %/% %%% | 左结合 | 乘、除、取模 |
| 4 | %+% %-%（二元） | 左结合 | 加、减 |
| 5 | %\|\|% | 左结合 | 字符串连接 |
| 6 | %==% %!=% %>% %<% %>=% %<=% | — | 比较 |
| — | **NOT** < **AND** < **OR** | — | 逻辑（最低层） |

---

## 6. 语义规则

### 5.1 数据源

| 形式 | 语义 |
|---|---|
| `"文件夹"` | 该目录及全部子目录的 `.md`（**大小写不敏感**） |
| `A **OR** B` / `A **AND** B` | 并集 / 交集，可括号组合；**AND 优先于 OR** |
| `#标签` | frontmatter `tags` 包含该标签（大小写不敏感） |

### 5.2 字段解析

| 字段 | 语义 |
|---|---|
| `file.name / file.path / file.folder / file.ext / file.size / file.ctime / file.mtime` | 文件元数据 |
| `file.outlinks / file.inlinks` | 出链目标路径数组 / 入链来源路径数组 |
| `this.xxx` | 上下文行字段（看板面板为 null） |
| 其他裸标识符 | frontmatter 属性；不存在求值 null |

### 5.3 类型与运算

| 运算 | 规则 |
|---|---|
| **算术**（%+% %-% %*% %/% %%%） | 数字运算；非数字 → null（计入 warnings）；除零 → null |
| **乘方**（%^%） | 支持分数指数；结果非有限数（如负数开偶次方）→ null |
| **字符串连接**（%||%） | 任一操作数 null → null；非字符串自动转字符串 |
| **比较** | 数字按数值；字符串按 UTF-8 字节序；null 参与 → false（%!=% 为其取反；null == null → true 同一性） |
| **真值** | null、false、空串、空数组 → 假；其余为真 |

### 5.4 排序（确定性方案）

1. **字符串**：UTF-8 字节流逐字节比较，公共前缀递归下降，短者在前（`'你'` < `'你好'`）
2. **数字**按数值；**布尔** false < true
3. **null**：恒排末尾（无论方向）
4. **自定义优先级**：`**SORT** 键 [方向] **BY** ('值1', '值2', ...)`——**作用于其书写的排序键**
   （写在最后即最后一个键）；列表内按位置（严格匹配）；列表外排后按 UTF-8 默认序；
   `**DESC**` 反转该键非 null 部分（null 仍沉底）
5. **多级排序**：键按书写顺序依次比较；排序稳定
6. **方向**：键级方向优先；sort_item 未写方向时默认 **ASC**。写在末尾的方向属于最后一个键
   （如 `**SORT** a, b **DESC**` 中 **DESC** 归 b）；执行器保留子句级 dir 字段备用，当前文法不产生

### 5.5 内置函数

| 函数 | 签名 | 语义 |
|---|---|---|
| `**sqrt**(x)` | number → number | 平方根；负数 → null |
| `**cbrt**(x)` | number → number | 立方根（支持负数） |
| `**root**(x, n)` | (number, number) → number | n 次方根；n=0 / 负数偶次根 → null |
| `**contains**(h, x)` | any × any → boolean | **区分大小写**：数组严格相等匹配元素；字符串子串包含 |
| `**length**(x)` | any → number | 数组/字符串长度；其他 null |
| `**lower**(x)` / `**upper**(x)` | string → string | 大小写转换（非字符串原样返回） |
| `**empty**(x)` | any → boolean | null / 空串 / 空数组 → true |

> 忽略大小写的包含：`**contains**(**lower**(标签), '随笔')`。

### 5.6 调试信息（默认开，设置可关）

| 字段 | 内容 |
|---|---|
| `from` | 输入总行数 → 源解析后的命中行数（去重后） |
| `sourceStats` | 各叶子数据源（文件夹/标签）及其贡献行数 |
| `where` | 过滤前/后行数 + 被剔除示例路径（最多 3 条） |
| `sort` | 排序键、方向、自定义优先级列表、比较次数 |
| `limit` | 截断前/后行数 |
| `fieldMisses` | 缺失字段名、次数、首个示例路径 |
| `warnings` | 非致命问题列表（除零/类型不匹配/未知函数等，含次数） |
| `executionTimeMs` | 执行耗时（ms） |

> warnings 与 FIELD 缺失仅由执行器在 FROM/WHERE/SORT 阶段收集；SELECT 投影在面板渲染时逐格求值，
> 其字段缺失由面板收集后并入调试信息（FIELD 条目）。非致命结果直接显示为空（—）。

### 5.7 错误处理

- 解析错误**带行列号**，格式 `[DSQL] 第 N 行第 M 列：预期 X，实际 Y`，直接报错不执行；
- 词法层拦截：未知 `**WORD**`、未包裹的关键词/运算符、字符串未闭合；
- 运行期非致命：类型不匹配、除零、未知函数、字段缺失 → null 或过滤掉，并计入 warnings。

---

## 7. 完整查询示例

```sql
-- 1. 标准表格 + 四则运算
**TABLE** **SELECT**
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
**LIST** **SELECT** 序号 %%% 2 **AS** 奇偶
**FROM** #清单
**WHERE** 序号 %!=% null

-- 6. 任意次方根
**SELECT** 值, **root**(值, 3) **AS** 立方根, **root**(值, 4) **AS** 四次方根
**FROM** "数学"
**WHERE** 值 %>% 0

-- 7. 子句乱序（合法：FROM 是 WHERE/SORT/LIMIT 的唯一前件）
**LIST** **FROM** "笔记" **SORT** 日期 **DESC** **WHERE** 状态 %==% '进行中'

-- 8. 键级方向 + 多个 custom_order（末尾 **DESC** 属于最后一个键 截止日期）
**SELECT** 任务, 状态, 优先级
**FROM** #待办
**SORT**
  状态 **BY** ('已完成', '进行中', '待办'),
  优先级 **DESC** **BY** ('P0', 'P1', 'P2'),
  截止日期 **ASC**

-- 9. ❌ WHERE 的前件 FROM 未在其之前出现（解析器报错）
**SELECT** 任务 **WHERE** 状态 %==% '待办' **FROM** #待办
```

---

## 8. DSQL 语言版本记录

> 以下记录 DSQL 语言规范本身的版本演进，与插件发布版本号各自独立。

- v1.1（2026-09-07）：SORT BY 自定义优先级；调试信息规范。
- v1.2（2026-09-08）：标记语法字面化（`**关键词**` / `%运算符%`）；SELECT 必须子句；表达式完备；sqrt/cbrt/root；多级排序。不兼容 v1.1。
- **v1.2 修订 2（2026-09-08，当前）**：
  - 数据源 **AND 优先于 OR**（两级文法）；
  - `**BY**` 优先级改为**作用于其书写的排序键**（方向与 BY 书写顺序不限）；
  - `**contains**` 改为**区分大小写**（数组严格 `===`，字符串子串），忽略大小写用 `**lower**` 组合；
  - 乘方结果非有限数（负数开偶次方）→ null；
  - null 比较语义明确：参与比较 → false（%!=% 取反；null == null → true 同一性）；
  - 调试对象扩展：`warnings`（非致命问题+次数）、`sourceStats`（逐源行数）、where 剔除示例、sort 比较次数；
  - 解析错误统一 `[DSQL]` 前缀。
- **v1.2 修订 3（2026-09-08）**：
  - 子句解析由**固定书写顺序**改为**前件关系**：书写顺序自由，每条至多一次；
    WHERE / SORT / LIMIT 以 `**FROM**` 为前件，缺前件报「需要 \*\*FROM\*\* 作为前件」；
  - `**SELECT**` 改为可省略（省略 = `*` 全字段自动列）；`**FROM**` 成为唯一必填子句；
  - `**WITHOUT** **ID**` 可写在任意子句位置。
- **v1.3（2026-09-08，测试修订 1.3.001，当前）**：
  - 规范勘误与语义补全（语言行为不变，文档与实现对齐）：
    `sort_item` 的方向与 `**BY**` 各至多一次、先后不限（文法改为 `{ sort_modifier }`）；
    `comparison` 裸操作数的真值语义正式写入；末尾方向归属最后一个 sort_item（文法勘误，
    移除不可达的子句级方向产生式，执行器 dir 字段保留）、未写方向的键默认 ASC；
    数字不支持科学计数法与负数字面量；自动列按 UTF-8 字节序（实现同步修正）；
  - 空 `**BY** ()` 列表：视为无自定义优先级并计入 warnings（实现新增）；
  - 调试 `from` 描述明确为「源解析后的命中行数（去重后）」。
