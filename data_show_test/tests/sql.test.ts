/* DSQL v1.3 冒烟测试：词法/语法/执行/排序/调试（node 环境，无 Obsidian 依赖）。 */
import assert from "node:assert/strict";
import { compareUtf8, executeQuery, evaluateExpr } from "../src/query/executor";
import { parseQuery, QueryParseError } from "../src/query/parser";
import type { DataRow } from "../src/types";

function makeRow(path: string, folder: string, fields: DataRow["fields"], inlinks: string[] = []): DataRow {
  const name = path.split("/").pop()!.replace(/\.md$/, "");
  return {
    path,
    file: { path, name, folder, ext: "md", size: 100, ctime: 1, mtime: 1, outlinks: [], inlinks },
    fields,
  };
}

const rows: DataRow[] = [
  makeRow("Notes/任务A.md", "Notes", { status: "进行中", owner: "张三", priority: 2, tags: ["task"], done: false }),
  makeRow("Notes/任务B.md", "Notes", { status: "已完成", owner: "李四", priority: 1, tags: ["task"], done: true }),
  makeRow("Notes/子/任务C.md", "Notes/子", { status: "进行中", owner: "张三", priority: 3, tags: ["task", "urgent"], done: false }),
  makeRow("Inbox/想法.md", "Inbox", { done: false, tags: ["idea"] }),
];

function exec(sql: string, ctx: DataRow | null = null) {
  return executeQuery(parseQuery(sql), rows, ctx);
}

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/* ---------- 词法与基础结构 ---------- */

test("v1.2 标准查询：**TABLE** **SELECT** ... **FROM** ... **WHERE** ... **SORT** ... **LIMIT**", () => {
  const r = exec(
    `**TABLE** **SELECT** status **AS** 状态, owner **AS** 负责人 **FROM** "Notes" **WHERE** status %==% '进行中' **SORT** priority **ASC**`,
  );
  assert.equal(r.view, "table");
  assert.deepEqual(r.columns.map((c) => c.alias), ["状态", "负责人"]);
  assert.deepEqual(r.rows.map((r) => r.file.name), ["任务A", "任务C"]);
});

test("视图可省略（默认 TABLE），**LIST** 亦可用", () => {
  assert.equal(exec(`**SELECT** status **FROM** "Notes"`).view, "table");
  assert.equal(exec(`**LIST** **SELECT** status **FROM** "Notes"`).view, "list");
});

test("**SELECT** * 自动列；**WITHOUT** **ID**", () => {
  const r = exec(`**SELECT** * **FROM** "Notes" **LIMIT** 1`);
  assert.ok(r.columns.length >= 3);
  const r2 = exec(`**TABLE** **WITHOUT** **ID** **SELECT** status **FROM** "Notes"`);
  assert.equal(r2.columns.length, 1); // WITHOUT ID 时面板隐藏文件列，列本身仍存在
});

test("投影表达式 + **AS** 别名（四则运算）", () => {
  const data = [makeRow("M/x.md", "M", { 价格: 10, 运费: 3, 库存: 5 })];
  const r = executeQuery(
    parseQuery(`**SELECT** 价格 %+% 运费 **AS** 总成本, 库存 %*% 价格 **AS** 货值 **FROM** "M"`),
    data,
    null,
  );
  const row = r.rows[0];
  assert.equal(evaluateExpr(r.columns[0].expr, row, null), 13);
  assert.equal(evaluateExpr(r.columns[1].expr, row, null), 50);
});

test("无别名投影：字段路径为默认别名，表达式为 列N", () => {
  const r = exec(`**SELECT** status, priority %+% 1 **FROM** "Notes" **LIMIT** 1`);
  assert.deepEqual(r.columns.map((c) => c.alias), ["status", "列2"]);
});

/* ---------- 子句前件关系（书写顺序自由） ---------- */

test("**SELECT** 可省略（默认 *），截图场景 **LIST** **FROM** ... **WHERE** ... 直接可用", () => {
  const r = parseQuery(`**LIST** **FROM** "Notes" **WHERE** **contains**(file.outlinks, "Notes/任务A.md")`);
  assert.equal(r.view, "list");
  assert.equal(r.select, "*");
  assert.ok(r.where);
  const r2 = parseQuery(`**FROM** "Notes"`);
  assert.equal(r2.select, "*");
  assert.equal(r2.from.kind, "folder");
});

test("子句按前件关系任意书写顺序（WHERE/SORT/LIMIT 只要求 **FROM** 在前）", () => {
  // SORT 在 WHERE 前：两者都只要求 FROM
  const r = exec(`**SELECT** a **FROM** "Notes" **SORT** priority **DESC** **WHERE** done`);
  assert.deepEqual(r.rows.map((r) => r.file.name), ["任务B"]);
  // LIMIT 在 SORT 前
  const r2 = exec(`**FROM** "Notes" **LIMIT** 1 **SORT** priority **ASC**`);
  assert.equal(r2.rows.length, 1);
  assert.equal(r2.rows[0].file.name, "任务B");
});

test("前件缺失报错：WHERE/SORT/LIMIT 缺 **FROM**；缺少 **FROM** 子句", () => {
  assert.throws(() => parseQuery(`**SELECT** a **WHERE** b %==% 1 **FROM** "x"`), (e: unknown) =>
    e instanceof QueryParseError && /\*\*WHERE\*\* 需要 \*\*FROM\*\* 作为前件/.test((e as Error).message));
  assert.throws(() => parseQuery(`**SELECT** a **SORT** b **FROM** "x"`), /\*\*SORT\*\* 需要 \*\*FROM\*\* 作为前件/);
  assert.throws(() => parseQuery(`**SELECT** a **LIMIT** 1 **FROM** "x"`), /\*\*LIMIT\*\* 需要 \*\*FROM\*\* 作为前件/);
  assert.throws(() => parseQuery(`**SELECT** a **WHERE** b`), /\*\*WHERE\*\* 需要 \*\*FROM\*\* 作为前件/);
  assert.throws(() => parseQuery(`**SELECT** a`), /缺少 \*\*FROM\*\* 子句/);
});

test("子句重复报错（每条至多一次，含 WITHOUT ID）", () => {
  assert.throws(() => parseQuery(`**SELECT** a **FROM** "x" **FROM** "y"`), /\*\*FROM\*\* 子句重复出现/);
  assert.throws(() => parseQuery(`**FROM** "x" **WHERE** a **WHERE** b`), /\*\*WHERE\*\* 子句重复出现/);
  assert.throws(() => parseQuery(`**FROM** "x" **LIMIT** 1 **LIMIT** 2`), /\*\*LIMIT\*\* 子句重复出现/);
  assert.throws(() => parseQuery(`**FROM** "x" **WITHOUT** **ID** **WITHOUT** **ID**`), /重复出现/);
  assert.throws(() => parseQuery(`**FROM** "x" **WHERE** a **ASC**`), /多余的查询子句/);
});

test("**WITHOUT** **ID** 可在任意子句位置", () => {
  const r = exec(`**FROM** "Notes" **WITHOUT** **ID** **LIMIT** 1`);
  assert.equal(r.rows.length, 1);
});

test("错误带行列号；未知 **关键词** 报错", () => {
  assert.throws(
    () => parseQuery(`**SELECT** a\n**FROM** "x"\n**LIMIT** abc`),
    (e: unknown) => e instanceof QueryParseError && /第 3 行/.test((e as Error).message),
  );
  assert.throws(() => parseQuery(`**FOO**`), /未知关键词/);
  assert.throws(() => parseQuery(`TABLE SELECT a FROM "x"`), /缺少 \*\*FROM\*\* 子句/); // 旧写法不再兼容
});

/* ---------- 数据源 ---------- */

test("FROM 子文件夹包含在父文件夹内（大小写不敏感）", () => {
  assert.equal(exec(`**SELECT** status **FROM** "Notes"`).rows.length, 3);
  assert.equal(exec(`**SELECT** status **FROM** "notes"`).rows.length, 3);
});

test("FROM 多路径 **OR** / 括号 / **AND**", () => {
  const names = exec(`**SELECT** status **FROM** "Notes/子" **OR** "Inbox"`).rows.map((r) => r.file.name).sort();
  assert.equal(names.length, 2);
  assert.equal(exec(`**SELECT** status **FROM** ("Notes" **OR** "Inbox") **AND** "Notes"`).rows.length, 3);
});

test("#标签数据源 + **contains** 数组；**contains** 区分大小写", () => {
  const r = exec(`**SELECT** status **FROM** #task **WHERE** **contains**(tags, 'urgent')`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].file.name, "任务C");
  // v1.2 修订：数组严格相等、字符串子串均区分大小写
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** **contains**(status, '进行中')`).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** **contains**(status, '进行')`).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** **contains**(owner, '张三')`).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** **contains**(owner, 'zhang')`).rows.length, 0);
  // 忽略大小写用 **lower** 组合
  assert.equal(
    exec(`**SELECT** a **FROM** "Notes" **WHERE** **contains**(**lower**(status), '已完成')`).rows.length,
    1,
  );
});

test("数据源 AND 优先于 OR", () => {
  // AND 优先：Notes ∪ (Inbox ∩ #idea) = 3 + 1 = 4
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **OR** "Inbox" **AND** #idea`).rows.length, 4);
  // 括号改变结合：(Notes ∪ Inbox) ∩ #idea = 1（只有想法）
  const r = exec(`**SELECT** a **FROM** ("Notes" **OR** "Inbox") **AND** #idea`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].file.name, "想法");
});

/* ---------- 表达式与函数 ---------- */

test("比较运算与裸真值判断", () => {
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** priority %>% 2`).rows.length, 1);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** priority %<=% 2`).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** done`).rows.length, 1);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** **NOT** done`).rows.length, 2);
  assert.equal(
    exec(`**SELECT** a **FROM** "Notes" **WHERE** status %==% '已完成' **OR** priority %>=% 3`).rows.length,
    2,
  );
});

test("== 按字节精确（区分大小写），%!=% 配 null", () => {
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** status %==% '进行中'`).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** status %!=% null`).rows.length, 3);
  assert.equal(exec(`**SELECT** a **FROM** "Inbox" **WHERE** owner %!=% null`).rows.length, 0);
});

test("算术：乘方右结合、取模、除零非致命为 null", () => {
  const data = [makeRow("M/x.md", "M", { a: 2, b: 3 })];
  const evalOne = (sql: string): number | null => {
    const r = executeQuery(parseQuery(`**SELECT** ${sql} **AS** v **FROM** "M"`), data, null);
    return evaluateExpr(r.columns[0].expr, r.rows[0], null) as number | null;
  };
  assert.equal(evalOne(`a %^% b %^% 2`), 512); // 2^(3^2)=2^9，右结合
  assert.equal(evalOne(`(a %+% b) %*% 2`), 10);
  assert.equal(evalOne(`b %%% a`), 1);
  assert.equal(evalOne(`a %/% (b %-% 3)`), null); // 除零 → null
  assert.equal(evalOne(`a %+% '字符串'`), null);  // 类型不匹配 → null
  assert.equal(evalOne(`(%-%2) %^% 0.5`), null);  // 负数开偶次方 → null
  assert.equal(evalOne(`2 %^% 0.5`), Math.SQRT2); // 分数指数
});

test("字符串连接 %||%", () => {
  const r = exec(`**SELECT** owner %||% '：' %||% status **AS** 条目 **FROM** "Notes" **LIMIT** 1`);
  assert.equal(evaluateExpr(r.columns[0].expr, r.rows[0], null), "张三：进行中");
});

test("内置函数 sqrt/cbrt/root/contains/length/lower/upper/empty", () => {
  const data = [makeRow("M/x.md", "M", { 值: 16, 标签: ["a", "b"], 名: "ABC" })];
  const evalOne = (sql: string): unknown => {
    const r = executeQuery(parseQuery(`**SELECT** ${sql} **AS** v **FROM** "M"`), data, null);
    return evaluateExpr(r.columns[0].expr, r.rows[0], null);
  };
  assert.equal(evalOne(`**sqrt**(值)`), 4);
  assert.equal(evalOne(`**cbrt**(27)`), 3);
  assert.equal(evalOne(`**root**(值, 4)`), 2);
  assert.equal(evalOne(`**root**(%-%8, 3)`), -2); // 负号也是 %-% 运算符
  assert.equal(evalOne(`**root**(值, 0)`), null);
  assert.equal(evalOne(`**sqrt**(%-%1)`), null);
  assert.equal(evalOne(`**length**(标签)`), 2);
  assert.equal(evalOne(`**lower**(名)`), "abc");
  assert.equal(evalOne(`**upper**(名)`), "ABC");
  assert.equal(evalOne(`**empty**(缺失)`), true);
});

test("file.* 虚拟列 / this 上下文", () => {
  const r = exec(`**SELECT** file.name **AS** 名称 **FROM** "Notes" **WHERE** **contains**(file.name, '任务')`);
  assert.equal(r.rows.length, 3);
  const ctx = rows[0];
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** owner %==% this.owner`, ctx).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** file.path %==% this.file.path`, ctx).rows.length, 1);
});

/* ---------- SORT：UTF-8 字节序 + 多级 + BY 优先级 ---------- */

test("UTF-8 字节序：递归下降与混排确定", () => {
  assert.ok(compareUtf8("你好AAAA", "你好AAAB") < 0);
  assert.ok(compareUtf8("abc", "abcd") < 0);
  assert.ok(compareUtf8("a", "你") < 0);
  assert.ok(compareUtf8("Z", "a") < 0);
});

test("**SORT** 多级排序（键级方向）", () => {
  const r = exec(`**SELECT** a **FROM** "Notes" **SORT** owner **ASC**, priority **DESC**`);
  // 张三(2,3) 在前内部 priority 降序 → C,A；李四(1) 最后
  assert.deepEqual(r.rows.map((r) => r.file.name), ["任务C", "任务A", "任务B"]);
});

test("**SORT** **BY** 自定义优先级（作用于所写键），**DESC** 反转，null 恒沉底", () => {
  const r = exec(`**SELECT** a **FROM** "Notes" **SORT** status **BY** ('已完成', '进行中')`);
  assert.deepEqual(r.rows.map((r) => r.file.name), ["任务B", "任务A", "任务C"]);
  const rd = exec(`**SELECT** a **FROM** "Notes" **SORT** status **BY** ('已完成', '进行中') **DESC**`);
  assert.deepEqual(rd.rows.map((r) => r.file.name), ["任务A", "任务C", "任务B"]);

  // BY 写在最后一个键上：owner 升序（字节序：张三 < 李四）分组内按 status 优先级
  const m = exec(`**SELECT** a **FROM** "Notes" **SORT** owner **ASC**, status **BY** ('已完成')`);
  assert.deepEqual(m.rows.map((r) => r.file.name), ["任务A", "任务C", "任务B"]);

  // 全部行（null 不受 BY 影响，恒最后）
  const all = exec(`**SELECT** a **FROM** "Notes" **OR** "Inbox" **SORT** status **BY** ('进行中')`);
  assert.deepEqual(all.rows.map((r) => r.file.name), ["任务A", "任务C", "任务B", "想法"]);
});

test("**SORT** **BY** 语法错误", () => {
  assert.throws(() => parseQuery(`**SELECT** a **FROM** "x" **SORT** s **BY** 'a'`), /预期 \(/);
  assert.throws(() => parseQuery(`**SELECT** a **FROM** "x" **SORT** s **BY** ('a', b)`), /\*\*BY\*\* 列表中应为字面量/);
});

/* ---------- LIMIT / 调试 ---------- */

test("**LIMIT** 与 **LIMIT** 0", () => {
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **SORT** priority **DESC** **LIMIT** 1`).rows.length, 1);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **LIMIT** 0`).rows.length, 0);
});

test("调试对象：from/sourceStats/where/sort/limit/fieldMisses/warnings/耗时", () => {
  const r = executeQuery(
    parseQuery(`**SELECT** status **FROM** "Notes" **OR** "Inbox" **WHERE** priority %>=% 1 **SORT** status **LIMIT** 1`),
    rows,
    null,
    { debug: true },
  );
  assert.ok(r.debug);
  assert.match(r.debug!.from, /输入 4 行 → 命中 4 行/);
  // sourceStats：各叶子源贡献行数
  assert.deepEqual(
    r.debug!.sourceStats.map((s) => `${s.source}:${s.rows}`).sort(),
    ['文件夹 "Inbox":1', '文件夹 "Notes":3'],
  );
  assert.match(r.debug!.where!, /4 → 3 行/);
  assert.match(r.debug!.sort!, /status/);
  assert.match(r.debug!.sort!, /比较 \d+ 次/);
  assert.match(r.debug!.limit!, /截断 3 → 1 行/);
  // 想法.md 无 priority 字段，WHERE 求值时记录缺失（该行被过滤，SORT 不再见到它）
  assert.deepEqual(r.debug!.fieldMisses, [
    { field: "priority", count: 1, sample: "Inbox/想法.md" },
  ]);
  assert.ok(r.debug!.executionTimeMs >= 0);
});

test("调试：WHERE 剔除示例", () => {
  const r = executeQuery(
    parseQuery(`**SELECT** a **FROM** "Notes" **WHERE** done`),
    rows,
    null,
    { debug: true },
  );
  assert.match(r.debug!.where!, /过滤 3 → 1 行/);
  assert.match(r.debug!.where!, /剔除示例：Notes\/任务A\.md, Notes\/子\/任务C\.md/);
});

test("调试：warnings 收集除零与类型不匹配（含次数）", () => {
  // WHERE 阶段对每行求值：3 行除零 + 3 行类型不匹配
  const r = executeQuery(
    parseQuery(`**SELECT** status **FROM** "Notes" **WHERE** priority %/% 0 %==% 1 **OR** priority %+% 'x' %==% 0`),
    rows,
    null,
    { debug: true },
  );
  assert.ok(r.debug!.warnings.some((w) => /%\/% 除零（3 次）/.test(w)));
  assert.ok(r.debug!.warnings.some((w) => /非数字（3 次）/.test(w)));
});

test("调试：WHERE 引用不存在字段记录 fieldMisses", () => {
  const r = executeQuery(
    parseQuery(`**SELECT** a **FROM** "Inbox" **WHERE** nonexistent %==% 'x'`),
    rows,
    null,
    { debug: true },
  );
  const miss = r.debug?.fieldMisses.find((m) => m.field === "nonexistent");
  assert.ok(miss);
  assert.equal(miss!.count, 1);
  assert.equal(miss!.sample, "Inbox/想法.md");
});

test("null 比较语义：%==% null 检空，%!=% null 检非空", () => {
  assert.equal(exec(`**SELECT** a **FROM** "Inbox" **WHERE** owner %==% null`).rows.length, 1);
  assert.equal(exec(`**SELECT** a **FROM** "Inbox" **WHERE** owner %!=% null`).rows.length, 0);
});

test("关闭 debug：结果无 debug 字段", () => {
  assert.equal(exec(`**SELECT** a **FROM** "Notes"`).debug, undefined);
});

/* ---------- 中文标识符 ---------- */

test("中文标识符字段", () => {
  const custom = [makeRow("Notes/人物.md", "Notes", { 涉及人物: ["张三"] })];
  const r = executeQuery(
    parseQuery(`**SELECT** 涉及人物 **FROM** "Notes" **WHERE** **contains**(涉及人物, '张三')`),
    custom,
    null,
  );
  assert.equal(r.rows.length, 1);
});

/* ---------- 跨目录 / 多项目多组数据 ---------- */

// 模拟多项目 vault：Projects/Alpha、Projects/Beta、Archive/2025、Inbox
const projRows: DataRow[] = [
  makeRow("Projects/Alpha/需求评审.md", "Projects/Alpha", { status: "进行中", project: "Alpha", owner: "张三", priority: 2, tags: ["proj"], spent: 3, estimate: 5 }),
  makeRow("Projects/Alpha/开发.md", "Projects/Alpha", { status: "进行中", project: "Alpha", owner: "李四", priority: 1, tags: ["proj"], spent: 8, estimate: 8 }),
  makeRow("Projects/Beta/设计.md", "Projects/Beta", { status: "已完成", project: "Beta", owner: "王五", priority: 1, tags: ["proj"], spent: 2, estimate: 2 }),
  makeRow("Projects/Beta/联调.md", "Projects/Beta", { status: "待办", project: "Beta", owner: "李四", priority: 4, tags: ["proj", "urgent"], spent: 0, estimate: 2 }),
  makeRow("Archive/2025/旧任务.md", "Archive/2025", { status: "已完成", project: "Alpha", priority: 9, tags: ["proj", "archived"] }),
  makeRow("Inbox/随手记.md", "Inbox", { tags: ["idea"] }),
];
const execP = (sql: string) => executeQuery(parseQuery(sql), projRows, null);

test("跨目录：兄弟文件夹互不穿透，父文件夹递归包含", () => {
  assert.equal(execP(`**FROM** "Projects/Alpha"`).rows.length, 2);
  assert.equal(execP(`**FROM** "Projects/Beta"`).rows.length, 2);
  assert.equal(execP(`**FROM** "Projects"`).rows.length, 4); // 父目录含两个项目组
  assert.equal(execP(`**FROM** "Archive"`).rows.length, 1);
  assert.equal(execP(`**FROM** "Projects/Alpha" **WHERE** project %==% 'Beta'`).rows.length, 0);
});

test("跨目录多组数据：并集 / 交集 / 空交集", () => {
  assert.equal(execP(`**FROM** "Projects/Alpha" **OR** "Projects/Beta"`).rows.length, 4);
  assert.equal(execP(`**FROM** "Projects" **OR** "Archive" **OR** "Inbox"`).rows.length, 6);
  assert.equal(execP(`**FROM** ("Projects" **OR** "Inbox") **AND** #proj`).rows.length, 4);
  assert.equal(execP(`**FROM** "Projects" **AND** "Inbox"`).rows.length, 0);
  // 项目组 × 状态过滤：跨组同名字段各自求值
  assert.equal(execP(`**FROM** "Projects" **WHERE** status %==% '进行中'`).rows.length, 2);
});

test("跨目录多组：多级排序分组内排序（project ASC, priority DESC）", () => {
  const r = execP(`**FROM** "Projects" **SORT** project **ASC**, priority **DESC**`);
  assert.deepEqual(r.rows.map((r) => r.file.name), ["需求评审", "开发", "联调", "设计"]);
});

test("跨目录：缺失字段行参与查询（null 沉底 / 列为空）", () => {
  // Inbox/随手记 无 project 字段：过滤不受影响、排序 null 沉底
  const r = execP(`**FROM** "Projects" **OR** "Inbox" **SORT** project **ASC**`);
  assert.equal(r.rows.length, 5);
  assert.equal(r.rows[r.rows.length - 1].file.name, "随手记");
  // 投影缺失字段 → null（面板显示 —）
  const row = execP(`**FROM** "Inbox"`).rows[0];
  assert.equal(evaluateExpr({ kind: "field", path: "project" }, row, null), null);
});

test("跨目录：数值表达式聚合投影（spent ÷ estimate 进度）", () => {
  const r = execP(
    `**SELECT** file.name **AS** 任务, spent %/% estimate **AS** 进度 **FROM** "Projects" **WHERE** estimate %>% 0 **SORT** spent %/% estimate **DESC** **LIMIT** 2`,
  );
  assert.deepEqual(r.rows.map((r) => r.file.name), ["开发", "设计"]); // 并列 1.0 时按输入稳定序
  assert.equal(evaluateExpr(r.columns[1].expr, r.rows[0], null), 1);
});

test("跨目录调试：sourceStats 逐源统计多组贡献", () => {
  const r = executeQuery(
    parseQuery(`**FROM** "Projects/Alpha" **OR** "Projects/Beta" **OR** "Archive"`),
    projRows,
    null,
    { debug: true },
  );
  assert.deepEqual(
    r.debug!.sourceStats.map((s) => `${s.source}:${s.rows}`).sort(),
    ['文件夹 "Archive":1', '文件夹 "Projects/Alpha":2', '文件夹 "Projects/Beta":2'],
  );
  assert.match(r.debug!.from, /输入 6 行 → 命中 5 行/);
});

test("空 **BY** () 列表：视为无自定义优先级并计入 warnings", () => {
  const r = executeQuery(
    parseQuery(`**SELECT** a **FROM** "Notes" **SORT** status **BY** ()`),
    rows,
    null,
    { debug: true },
  );
  assert.ok(r.debug!.warnings.some((w) => /空优先级列表/.test(w)));
  // 空列表 = 无优先级：status 字节序 已完成 < 待办 < 进行中…实际为 UTF-8：已完成 < 进行中（待办无此数据行外）
  assert.equal(r.rows.length, 3);
});

test("SELECT * 自动列按 UTF-8 字节序排列", () => {
  const data = [makeRow("M/x.md", "M", { 你好: 1, abc: 2, Zed: 3 })];
  const r = executeQuery(parseQuery(`**SELECT** * **FROM** "M"`), data, null);
  assert.deepEqual(r.columns.map((c) => c.alias), ["Zed", "abc", "你好"]); // 0x5A < 0x61 < 0xE4…
});

console.log(`\nDSQL v1.3 测试：全部 ${passed} 个通过`);
