/**
 * @module tests/domains
 * @description DSQL 2.6 域扩展套件：词法硬约束 / 块与 YIELD 语法 / 作用域（SELECT 宽松 · YIELD 严格）/
 * 不可传递性 / IN·DIFF 展开语义 / 行展开基数（规范 §7 十项验收 + §5 错误表）
 * + 输出显示口径（列标签去 `$`、域对象 `[字段:值]`、槽位 `true`/`金针,铁针`，规范 §6.13.7）
 */

import assert from "node:assert/strict";
import { executeQuery, type ResultSet } from "@dsql/executor";
import { LexError } from "@dsql/lexer";
import { parseQuery, QueryParseError } from "@dsql/parser";
import { DomainSlotValue, EMPTY, isDomainSlotValue, type DataRow } from "@dsql/types";
import { formatCell } from "@render/format";
import { buildExport, exportHeaders } from "@render/export";
import { makeRow } from "./helpers";

let passed = 0;
const failures: { name: string; err: unknown }[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

/* ---------- 共用场景（对应 新语法示例.txt 的 小说/人物 · 武器 · 剧情） ---------- */

const ROWS: DataRow[] = [
  makeRow("小说/人物/傻青.md", "小说/人物", { name: "傻青", type: "人物", wolf: ["狼牙棒", "金针"] }),
  makeRow("小说/人物/王五.md", "小说/人物", { name: "王五", type: "人物", wolf: ["狼牙棒"] }),
  makeRow("小说/武器/狼牙棒.md", "小说/武器", { name: "狼牙棒", type: "武器" }),
  makeRow("小说/武器/金针.md", "小说/武器", { name: "金针", type: "武器" }),
  makeRow("小说/武器/铁针.md", "小说/武器", { name: "铁针", type: "武器" }),
  makeRow("小说/剧情/苍蓝传.md", "小说/剧情", { name: "苍蓝传", type: "剧情", chart: ["傻青", "笨蛋"] }),
];

/** 作用域/不可传递性用例用的最小行集 */
const SRC: DataRow[] = [
  makeRow("src/a/一.md", "src/a", { name: "一" }),
  makeRow("src/b/二.md", "src/b", { name: "二" }),
  makeRow("src/inner/三.md", "src/inner", { name: "三" }),
];

function run(sql: string, rows: DataRow[] = ROWS): ResultSet {
  return executeQuery(parseQuery(sql), rows, null);
}

/** 取第 index 行的某个投影列值（列标签即单元格键） */
function cell(result: ResultSet, index: number, alias: string): unknown {
  return result.rows[index].fields[alias];
}

/** 解包域扩展槽位标记（取原始值，用于断言语义） */
function raw(value: unknown): unknown {
  return isDomainSlotValue(value) ? value.value : value;
}

/** 取第 index 行某列的**显示文本**（走 formatCell，即三视图 / CSV / 搜索文本的统一出口） */
function show(result: ResultSet, index: number, alias: string): string {
  return formatCell(cell(result, index, alias), 4);
}

const parseErr = (sql: string, match: RegExp): void => {
  assert.throws(() => parseQuery(sql), (err: unknown) => {
    assert.ok(err instanceof QueryParseError, `应为 QueryParseError，实际：${String(err)}`);
    assert.match(err.message, match);
    assert.match(err.message, /第 \d+ 行第 \d+ 列/);
    return true;
  });
};

const lexErr = (sql: string, match: RegExp): void => {
  assert.throws(() => parseQuery(sql), (err: unknown) => {
    assert.ok(err instanceof LexError, `应为 LexError，实际：${String(err)}`);
    assert.match(err.message, match);
    return true;
  });
};

/* ---------- 1. 词法层硬约束（§7 硬约束由词法层拦截） ---------- */

test("[词法] <域> 与 **WORD** / $变量$ 并列，不冲突", () => {
  const q = parseQuery(
    `**TABLE_VIEW** **SELECT** <人物>, $槽$\n{\n  { **SELECT** name **FROM** "小说/人物" } **AS** <人物>\n  **YIELD** <人物>::name **IN** <人物>::name **AS** $槽$\n}`,
  );
  assert.ok(q.domains);
  assert.equal(q.domains!.select.length, 2);
  assert.equal(q.domains!.select[0].kind, "domain");
  assert.equal(q.domains!.select[1].kind, "slot");
});

test("[词法] <域>::<域> → :: 右侧非 IDENT", () => {
  lexErr(`**SELECT** <a> { { **SELECT** name **FROM** "x" } **AS** <a> **YIELD** <a>::<b> **IN** <a>::name }`, /:: 右侧须 IDENT，<b> 非法/);
});

test("[词法] <域>::<域>::字段 → 第二个 :: 左侧非 DOMAIN", () => {
  lexErr(`**SELECT** <a> { { **SELECT** name **FROM** "x" } **AS** <a> **YIELD** <a>::<b>::name **IN** <a>::name }`, /:: 右侧须 IDENT，<b> 非法/);
});

test("[词法] :: 左侧非 <域> → 报错", () => {
  lexErr(`**SELECT** <a> { { **SELECT** name **FROM** "x" } **AS** <a> **YIELD** name::b **IN** <a>::name }`, /:: 左侧须为域标记/);
});

test("[词法] <...> 内只允许一个 IDENT", () => {
  lexErr(`**SELECT** <人 物> { { **SELECT** name **FROM** "x" } **AS** <人> }`, /域标记 <人 物> 内应为单个标识符/);
  lexErr(`**SELECT** <a> { { **SELECT** name **FROM** "x" } **AS** <a b> }`, /内应为单个标识符/);
});

test("[词法] 域标记未闭合 / 跨行", () => {
  lexErr(`**SELECT** <人物 { **FROM** "x" }`, /域标记未闭合/);
  lexErr("**SELECT** <人\n物>", /域标记不能跨行/);
});

test("[词法] 块 { } 未闭合 / 多余的 }", () => {
  lexErr(`**SELECT** <a> { { **SELECT** name **FROM** "x" } **AS** <a>`, /块 \{ 未闭合/);
  lexErr(`**SELECT** <a> { } }`, /多余的 \}/);
});

/* ---------- 2. §7 十项验收 ---------- */

test("§7-1 合法完整示例（单子域 + 无 YIELD）", () => {
  const r = run(`**TABLE_VIEW** **SELECT** <人物>
{
  {
    **SELECT** name, wolf
    **FROM** "小说/人物"
    **WHERE** type %==% '人物'
  } **AS** <人物>
}`);
  assert.deepEqual(r.columns.map((c) => c.alias), ["<人物>"]);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(cell(r, 0, "<人物>"), { name: "傻青", wolf: ["狼牙棒", "金针"] });
});

test("§7-2 顶层 SELECT <域名> 无 block → 未声明域", () => {
  parseErr(`**SELECT** <人物>`, /域 <人物> 未声明（缺少块 \{ \}/);
});

test("§7-3 YIELD 引用未声明域名 → 未声明", () => {
  parseErr(
    `**SELECT** <a> { { **SELECT** name **FROM** "src/a" } **AS** <a> **YIELD** <b>::name **IN** <a>::name **AS** $x$ }`,
    /域 <b> 未声明/,
  );
});

test("§7-4 YIELD 引用写在它之后的同层子域 → 文本顺序违规", () => {
  parseErr(
    `**SELECT** <a>, <b> {
  { **SELECT** name **FROM** "src/a" } **AS** <a>
  **YIELD** <b>::name **IN** <a>::name **AS** $x$
  { **SELECT** name **FROM** "src/b" } **AS** <b>
}`,
    /<b> 未在该 \*\*YIELD\*\* 之前声明/,
  );
});

test("§7-5 同一 block 两个 YIELD → 唯一性违规", () => {
  parseErr(
    `**SELECT** <a> {
  { **SELECT** name **FROM** "src/a" } **AS** <a>
  **YIELD** <a>::name **IN** <a>::name **AS** $x$
  **YIELD** <a>::name **DIFF** <a>::name **AS** $y$
}`,
    /\*\*YIELD\*\* 子句重复出现/,
  );
});

test("§7-6 内层读外层 + SELECT 前向引用 → 通过", () => {
  const r = run(
    `**SELECT** <a>
{
  { **SELECT** name **FROM** "src/a" } **AS** <a>

  { **SELECT** name, <a> **FROM** "src/b" } **AS** <b>
}`,
    SRC,
  );
  assert.equal(r.rows.length, 1);
  assert.deepEqual(cell(r, 0, "<a>"), { name: "一" });
});

test("§7-7 没 AS 的块 → 语法错误", () => {
  parseErr(
    `**SELECT** <人物> { { **SELECT** name **FROM** "小说/人物" } }`,
    /子域必须写 \*\*AS\*\* <域>/,
  );
});

test("§7-8 YIELD 缺省 AS variable → 通过（计算照常，不投影）", () => {
  const r = run(
    `**SELECT** <a> {
  { **SELECT** name **FROM** "src/a" } **AS** <a>
  **YIELD** <a>::name **IN** <a>::name
}`,
    SRC,
  );
  assert.deepEqual(r.columns.map((c) => c.alias), ["<a>"]);
  assert.equal(r.rows.length, 1);
});

test("§7-9 SELECT 前向合法 + YIELD 前向非法（最关键区分验证）", () => {
  const sql = `**SELECT** <a>, $x$ {
  { **SELECT** name, <b> **FROM** "src/a" } **AS** <a>
  **YIELD** <b>::name **IN** <a>::name **AS** $x$
  { **SELECT** name **FROM** "src/b" } **AS** <b>
}`;
  // <a> 的 SELECT 引用后置的 <b> → 宽松查找通过；YIELD 引用后置的 <b> → 严格查找拦截
  parseErr(sql, /<b> 未在该 \*\*YIELD\*\* 之前声明/);
});

test("§7-10 子域 SELECT 前向引用同层域名 → 通过", () => {
  const r = run(
    `**SELECT** <b>
{
  { **SELECT** name, <b> **FROM** "src/a" } **AS** <a>
  { **SELECT** name **FROM** "src/b" } **AS** <b>
}`,
    SRC,
  );
  assert.equal(r.rows.length, 1);
  assert.deepEqual(cell(r, 0, "<b>"), { name: "二" });
});

/* ---------- 3. §5 错误表其余条目 ---------- */

test("[错误] 顶层 SELECT 写 <域>::字段 → 只接受单级", () => {
  parseErr(
    `**SELECT** <人物>::name { { **SELECT** name **FROM** "小说/人物" } **AS** <人物> }`,
    /顶层 \*\*SELECT\*\* 只接受单级 <域> 或 \$槽位\$/,
  );
});

test("[错误] YIELD 引用内层子域 → 不向外暴露", () => {
  parseErr(
    `**SELECT** <a> {
  {
    **SELECT** name **FROM** "src/a"
    { **SELECT** name **FROM** "src/inner" } **AS** <inner>
  } **AS** <a>
  **YIELD** <inner>::name **IN** <a>::name **AS** $x$
}`,
    /<inner> 不向外暴露/,
  );
});

test("[错误] 子域 SELECT 缺 FROM → FROM 是唯一数据来源", () => {
  parseErr(`**SELECT** <人物> { { **SELECT** name } **AS** <人物> }`, /子查询缺少 \*\*FROM\*\* 子句/);
});

test("[错误] YIELD 出现在同层无已声明子域之前 → 前件缺失", () => {
  parseErr(
    `**SELECT** <a> { **YIELD** <a>::name **IN** <a>::name **AS** $x$ { **SELECT** name **FROM** "src/a" } **AS** <a> }`,
    /\*\*YIELD\*\* 需要同层已声明的子域作为前件/,
  );
});

test("[错误] IN / DIFF 出现在 YIELD 之外 → 前件缺失", () => {
  parseErr(`**SELECT** 1 **FROM** "src/a" **WHERE** x **IN** y`, /\*\*IN\*\* 只可写在域扩展查询中/);
  parseErr(`**SELECT** 1 **FROM** "src/a" **WHERE** **DIFF**(x)`, /\*\*DIFF\*\* 只能写在 \*\*YIELD\*\* 项中/);
});

test("[错误] YIELD 写在非域查询（无块）→ 前件缺失", () => {
  parseErr(`**SELECT** 1 **FROM** "src/a" **YIELD** <a>::name **IN** <a>::name`, /\*\*YIELD\*\* 只可写在域扩展查询中/);
});

test("[错误] 嵌套块内 YIELD 不受支持", () => {
  parseErr(
    `**SELECT** <a> {
  {
    **SELECT** name **FROM** "src/a"
    { **SELECT** name **FROM** "src/inner" } **AS** <inner>
    **YIELD** <inner>::name **IN** <inner>::name **AS** $x$
  } **AS** <a>
}`,
    /\*\*YIELD\*\* 只能写在顶层块/,
  );
});

test("[错误] 同名域在同层重复声明", () => {
  parseErr(
    `**SELECT** <a> {
  { **SELECT** name **FROM** "src/a" } **AS** <a>
  { **SELECT** name **FROM** "src/b" } **AS** <a>
}`,
    /域 <a> 在同层重复声明/,
  );
});

test("[错误] 域引用循环依赖", () => {
  parseErr(
    `**SELECT** <a> {
  { **SELECT** name, <b> **FROM** "src/a" } **AS** <a>
  { **SELECT** name, <a> **FROM** "src/b" } **AS** <b>
}`,
    /循环依赖/,
  );
});

test("[错误] 子查询内只支持 SELECT / FROM / WHERE", () => {
  parseErr(`**SELECT** <a> { { **SELECT** name **FROM** "src/a" **SORT** name } **AS** <a> }`, /子查询内只支持/);
  parseErr(`**SELECT** <a> { { **SELECT** name **FROM** "src/a" **LIMIT** 1 } **AS** <a> }`, /子查询内只支持/);
});

test("[错误] 块之后不得再有子句", () => {
  parseErr(`**SELECT** <a> { { **SELECT** name **FROM** "src/a" } **AS** <a> } **LIMIT** 1`, /多余的查询子句/);
});

test("[错误] YIELD 项 AS 必须为 $变量$", () => {
  parseErr(
    `**SELECT** <a> { { **SELECT** name **FROM** "src/a" } **AS** <a> **YIELD** <a>::name **IN** <a>::name **AS** x }`,
    /\*\*YIELD\*\* 项的 \*\*AS\*\* 必须为 \$变量\$/,
  );
});

/* ---------- 4. IN / DIFF 展开语义（新语法示例.txt 二 / 三 / 四） ---------- */

test("[IN] 单射拆分逐元素判断：行数 = |人物| × |武器|", () => {
  const r = run(`**TABLE_VIEW** **SELECT** <人物>, <武器>, $人物有武器$
{
  {
    **SELECT** name, wolf
    **FROM** "小说/人物"
    **WHERE** type %==% '人物'
  } **AS** <人物>

  {
    **SELECT** name
    **FROM** "小说/武器"
    **WHERE** type %==% '武器'
  } **AS** <武器>

  **YIELD**
    <武器>::name **IN** <人物>::wolf **AS** $人物有武器$
}`);
  assert.equal(r.rows.length, 6);
  assert.deepEqual(
    r.rows.map((row) => raw(row.fields["人物有武器"])),
    [true, true, false, true, false, false],
  );
  // 行展开顺序：人物外层、武器内层（字典序）
  assert.deepEqual(
    r.rows.map((row) => (row.fields["<人物>"] as { name: string }).name),
    ["傻青", "傻青", "傻青", "王五", "王五", "王五"],
  );
  assert.deepEqual(
    r.rows.map((row) => (row.fields["<武器>"] as { name: string }).name),
    ["狼牙棒", "金针", "铁针", "狼牙棒", "金针", "铁针"],
  );
});

test("[IN] 同域自引合法：ROW 位涉及 {j}，行数 = |j|", () => {
  const r = run(`**SELECT** <j>, $name在chart$
{
  {
    **SELECT** name, chart
    **FROM** "小说/剧情"
  } **AS** <j>

  **YIELD**
    <j>::name **IN** <j>::chart **AS** $name在chart$
}`);
  assert.equal(r.rows.length, 1);
  assert.equal(raw(cell(r, 0, "name在chart")), false); // 苍蓝传 ∉ [傻青, 笨蛋]
  assert.equal(show(r, 0, "name在chart"), "false");
});

test("[DIFF] 左参取全集、右参逐行：行数 = |人物|（AGG 不贡献行）", () => {
  const r = run(`**TABLE_VIEW** **SELECT** <人物>, $未引用$
{
  {
    **SELECT** name
    **FROM** "小说/武器"
    **WHERE** type %==% '武器'
  } **AS** <武器>

  {
    **SELECT** name, wolf
    **FROM** "小说/人物"
    **WHERE** type %==% '人物'
  } **AS** <人物>

  **YIELD**
    <武器>::name **DIFF** <人物>::wolf **AS** $未引用$
}`);
  assert.equal(r.rows.length, 2);
  // 保留左参全集顺序 [狼牙棒, 金针, 铁针]
  assert.deepEqual(raw(cell(r, 0, "未引用")), ["铁针"]);
  assert.deepEqual(raw(cell(r, 1, "未引用")), ["金针", "铁针"]);
  // 显示口径：数组 `,` 无空格（§6.13.7）
  assert.equal(show(r, 0, "未引用"), "铁针");
  assert.equal(show(r, 1, "未引用"), "金针,铁针");
});

test("[混合] 律表 ROW ∘ AR = ROW：行数 = |剧情| × |人物|", () => {
  const r = run(`**TABLE_VIEW** **SELECT** <剧情>, <人物>, $在剧情里$, $非剧情人物$
{
  {
    **SELECT** name, chart
    **FROM** "小说/剧情"
    **WHERE** name %==% '苍蓝传'
  } **AS** <剧情>

  {
    **SELECT** name
    **FROM** "小说/人物"
    **WHERE** type %==% '人物'
  } **AS** <人物>

  **YIELD**
    <人物>::name **IN** <剧情>::chart      **AS** $在剧情里$,
    <剧情>::chart **DIFF** <人物>::name    **AS** $非剧情人物$
}`);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(raw(cell(r, 0, "在剧情里")), true);
  assert.deepEqual(raw(cell(r, 0, "非剧情人物")), ["笨蛋"]);
  assert.deepEqual(raw(cell(r, 1, "在剧情里")), false);
  assert.deepEqual(raw(cell(r, 1, "非剧情人物")), ["傻青", "笨蛋"]);
});

test("[展开] 无 YIELD → 所有子域 ROW，笛卡尔积 |人物| × |武器|", () => {
  const r = run(`**TABLE_VIEW** **SELECT** <人物>, <武器>
{
  {
    **SELECT** name, wolf
    **FROM** "小说/人物"
  } **AS** <人物>

  {
    **SELECT** name
    **FROM** "小说/武器"
  } **AS** <武器>
}`);
  assert.equal(r.rows.length, 6);
});

test("[展开] 三域 + 三项：ROW 位涉及 {剧情, 人物, 武器}", () => {
  const r = run(`**TABLE_VIEW** **SELECT** <剧情>, <人物>, <武器>,
       $人物武器绑定$, $剧情人物$, $未引用$
{
  {
    **SELECT** name, chart
    **FROM** "小说/剧情"
    **WHERE** name %==% '苍蓝传'
  } **AS** <剧情>

  {
    **SELECT** name, wolf
    **FROM** "小说/人物"
    **WHERE** type %==% '人物'
  } **AS** <人物>

  {
    **SELECT** name
    **FROM** "小说/武器"
    **WHERE** type %==% '武器'
  } **AS** <武器>

  **YIELD**
    <武器>::name **IN** <人物>::wolf       **AS** $人物武器绑定$,
    <人物>::name **IN** <剧情>::chart      **AS** $剧情人物$,
    <武器>::name **DIFF** <人物>::wolf     **AS** $未引用$
}`);
  assert.equal(r.rows.length, 6); // |剧情| × |人物| × |武器| = 1 × 2 × 3
  assert.deepEqual(r.columns.map((c) => c.alias), ["<剧情>", "<人物>", "<武器>", "人物武器绑定", "剧情人物", "未引用"]);
});

test("[不可传递性] 内层同名域不遮蔽外层绑定（5.1 场景）", () => {
  // 内层 <武器> 的数据源刻意放在 小说/内层（不落在 小说/武器 的子目录内，避免 FROM 含子目录语义互相污染）
  const rows: DataRow[] = [
    ...ROWS,
    makeRow("小说/内层/暗器.md", "小说/内层", { name: "暗器", type: "武器" }),
  ];
  const r = run(`**TABLE_VIEW** **SELECT** <人物>, <武器>, $人物有武器$
{
  {
    **SELECT** name, wolf
    **FROM** "小说/人物"
    **WHERE** type %==% '人物'

    {
      **SELECT** name
      **FROM** "小说/内层"
      **WHERE** type %==% '武器'
    } **AS** <武器>
  } **AS** <人物>

  {
    **SELECT** name
    **FROM** "小说/武器"
    **WHERE** type %==% '武器'
  } **AS** <武器>

  **YIELD**
    <武器>::name **IN** <人物>::wolf **AS** $人物有武器$
}`, rows);
  // 外层 <武器> = 3 行（内层 <武器> 只对 <人物> 块内可见，不参与顶层投影）
  assert.equal(r.rows.length, 2 * 3);
  assert.deepEqual(
    r.rows.map((row) => (row.fields["<武器>"] as { name: string }).name),
    ["狼牙棒", "金针", "铁针", "狼牙棒", "金针", "铁针"],
  );
});

/* ---------- 5. 兼容性（无 block 走旧算法） ---------- */

test("[兼容] 无块查询不含 domains 节点，行为与 DSQL 2.5 一致", () => {
  const q = parseQuery(`**TABLE_VIEW** **SELECT** name **FROM** "小说/人物" **SORT** name **ASC** **LIMIT** 1`);
  assert.equal(q.domains, null);
  const r = executeQuery(q, ROWS, null);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.columns.map((c) => c.alias), ["name"]);
});

test("[兼容] 旧算法的裸 $槽位$ 声明不误判为域模式", () => {
  const q = parseQuery(`**SELECT** $x$, **TOTAL** 1 **AS** $y$ **FROM** "小说/人物"`);
  assert.equal(q.domains, null);
  assert.equal(q.select === "*" ? 0 : q.select.length, 2);
});

test("[调试] debug 开启时输出子域 / 行展开 / YIELD 摘要", () => {
  const r = executeQuery(
    parseQuery(`**SELECT** <人物> {
  { **SELECT** name, wolf **FROM** "小说/人物" } **AS** <人物>
  **YIELD** <人物>::name **IN** <人物>::wolf **AS** $x$
}`),
    ROWS,
    null,
    { debug: true },
  );
  const lines = r.debug?.domains ?? [];
  assert.ok(lines.some((line) => line.includes("子域 <人物>")));
  assert.ok(lines.some((line) => line.includes("行展开：<人物> = 2 行")));
  assert.ok(lines.some((line) => line.includes("**IN**")));
});

/* ---------- 6. 输出显示口径（规范 §6.13.7 / §1–§3） ---------- */

/** 规范 §4 的完整示例（IN 板） */
const IN_SQL = `**TABLE_VIEW** **SELECT** <人物>, <武器>, $人物有武器$
{
  {
    **SELECT** name, wolf
    **FROM** "小说/人物"
    **WHERE** type %==% '人物'
  } **AS** <人物>

  {
    **SELECT** name
    **FROM** "小说/武器"
    **WHERE** type %==% '武器'
  } **AS** <武器>

  **YIELD**
    <武器>::name **IN** <人物>::wolf **AS** $人物有武器$
}`;

test("[显示] 列标签：<域> 保留尖括号（类型标记）、$槽位$ 去 $（命名空间标记）", () => {
  const r = run(IN_SQL);
  assert.deepEqual(r.columns.map((c) => c.alias), ["<人物>", "<武器>", "人物有武器"]);
  // 表头（表格视图）与 CSV / JSON 键同源，故三者一致
  assert.deepEqual(exportHeaders(r, false), ["文件", "<人物>", "<武器>", "人物有武器"]);
  assert.deepEqual(exportHeaders(r, true), ["<人物>", "<武器>", "人物有武器"]);
});

test("[显示] 域对象 → [字段:值][字段:值]（字段顺序 = 子域 SELECT 声明顺序）", () => {
  const r = run(IN_SQL);
  assert.equal(show(r, 0, "<人物>"), "[name:傻青][wolf:狼牙棒,金针]");
  assert.equal(show(r, 0, "<武器>"), "[name:狼牙棒]");
  assert.equal(show(r, 3, "<人物>"), "[name:王五][wolf:狼牙棒]");
  assert.equal(show(r, 4, "<武器>"), "[name:金针]");
  // 字段顺序随子域 SELECT 声明顺序（把 type 提到 name 之前即换序）
  const r2 = run(IN_SQL.replace("**SELECT** name, wolf", "**SELECT** wolf, name"));
  assert.equal(show(r2, 0, "<人物>"), "[wolf:狼牙棒,金针][name:傻青]");
});

test("[显示] 槽位值：bool → true/false、数组 → `,` 无空格、标量原样", () => {
  const r = run(IN_SQL);
  assert.deepEqual(
    r.rows.map((_, i) => show(r, i, "人物有武器")),
    ["true", "true", "false", "true", "false", "false"],
  );
  const diff = run(`**TABLE_VIEW** **SELECT** <人物>, $未引用$
{
  { **SELECT** name **FROM** "小说/武器" **WHERE** type %==% '武器' } **AS** <武器>
  { **SELECT** name, wolf **FROM** "小说/人物" **WHERE** type %==% '人物' } **AS** <人物>
  **YIELD** <武器>::name **DIFF** <人物>::wolf **AS** $未引用$
}`);
  assert.equal(show(diff, 1, "未引用"), "金针,铁针");
});

test("[显示] 域扩展口径只作用于域扩展输出：其余查询的布尔 / 数组口径不变", () => {
  // 域扩展：true / `,` 无空格；普通查询：是 / `, `（既有行为）
  assert.equal(formatCell(true), "是");
  assert.equal(formatCell(["金针", "铁针"]), "金针, 铁针");
  const r = run(`**SELECT** name, wolf **FROM** "小说/人物" **SORT** name **ASC**`);
  assert.equal(show(r, 0, "name"), "傻青");
  assert.equal(show(r, 0, "wolf"), "狼牙棒, 金针");
});

test("[显示] 空值 / empty → —（域对象字段、槽位值两级同口径）", () => {
  // 槽位值为 null / empty：域口径同样落 —
  assert.equal(formatCell(new DomainSlotValue(null)), "—");
  assert.equal(formatCell(new DomainSlotValue(EMPTY)), "—");
  // 域对象字段为 null / empty
  assert.equal(formatCell({ name: null, wolf: EMPTY }), "[name:—][wolf:—]");
});

test("[显示] §4 完整示例：IN 板六行逐格输出", () => {
  const r = run(IN_SQL);
  const table = r.rows.map((row) => [
    formatCell(row.fields["<人物>"], 4),
    formatCell(row.fields["<武器>"], 4),
    formatCell(row.fields["人物有武器"], 4),
  ]);
  assert.deepEqual(table, [
    ["[name:傻青][wolf:狼牙棒,金针]", "[name:狼牙棒]", "true"],
    ["[name:傻青][wolf:狼牙棒,金针]", "[name:金针]", "true"],
    ["[name:傻青][wolf:狼牙棒,金针]", "[name:铁针]", "false"],
    ["[name:王五][wolf:狼牙棒]", "[name:狼牙棒]", "true"],
    ["[name:王五][wolf:狼牙棒]", "[name:金针]", "false"],
    ["[name:王五][wolf:狼牙棒]", "[name:铁针]", "false"],
  ]);
});

test("[显示] §4 完整示例：DIFF 板两行逐格输出", () => {
  const r = run(`**TABLE_VIEW** **SELECT** <人物>, $未引用$
{
  { **SELECT** name **FROM** "小说/武器" **WHERE** type %==% '武器' } **AS** <武器>
  { **SELECT** name, wolf **FROM** "小说/人物" **WHERE** type %==% '人物' } **AS** <人物>
  **YIELD** <武器>::name **DIFF** <人物>::wolf **AS** $未引用$
}`);
  assert.deepEqual(
    r.rows.map((row) => [formatCell(row.fields["<人物>"], 4), formatCell(row.fields["未引用"], 4)]),
    [
      ["[name:傻青][wolf:狼牙棒,金针]", "铁针"],
      ["[name:王五][wolf:狼牙棒]", "金针,铁针"],
    ],
  );
});

test("[显示] CSV：表头用输出列标签、单元格用域口径文本（含逗号按 RFC 4180 加引号）", () => {
  const r = run(IN_SQL);
  const csv = buildExport("csv", r, r.rows.slice(0, 1), true, 4).data;
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "<人物>,<武器>,人物有武器");
  // 域对象文本内含逗号 → 按 RFC 4180 用双引号包裹
  assert.equal(lines[1], '"[name:傻青][wolf:狼牙棒,金针]",[name:狼牙棒],true');
});

test("[显示] JSON：域对象结构化、槽位输出原值、null 保留键", () => {
  const r = run(IN_SQL);
  const json = JSON.parse(buildExport("json", r, r.rows.slice(0, 1), true, 4).data);
  assert.deepEqual(json, [
    {
      "<人物>": { name: "傻青", wolf: ["狼牙棒", "金针"] },
      "<武器>": { name: "狼牙棒" },
      "人物有武器": true,
    },
  ]);
  // 空值 / empty → null 且保留键
  const r2 = run(`**SELECT** <人物> {
  { **SELECT** name, 不存在 **FROM** "小说/人物" } **AS** <人物>
}`, [...ROWS, makeRow("小说/人物/空缺.md", "小说/人物", { name: "空缺" })]);
  const json2 = JSON.parse(buildExport("json", r2, r2.rows.slice(2, 3), true, 4).data);
  assert.deepEqual(json2, [{ "<人物>": { name: "空缺", 不存在: null } }]);
});

/* ---------- 汇总 ---------- */

if (failures.length > 0) {
  console.error(`\n域扩展测试：${failures.length} 个失败 / ${passed + failures.length} 个`);
  for (const f of failures) console.error(`  ✗ ${f.name}\n${f.err}`);
  process.exitCode = 1;
} else {
  console.log(`\n域扩展测试：全部 ${passed} 个通过`);
}
