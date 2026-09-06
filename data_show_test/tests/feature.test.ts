/* 功能示例测试：数据源、排序、LIMIT、调试信息、file.* 虚拟列、this 上下文、跨目录多组数据。 */
import assert from "node:assert/strict";
import { executeQuery, evaluateExpr } from "../src/query/executor";
import { parseQuery } from "../src/query/parser";
import type { DataRow } from "../src/types";
import { exec, makeRow, rows } from "./helpers";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

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

test("#标签数据源 + **contains** 数组", () => {
  const r = exec(`**SELECT** status **FROM** #task **WHERE** **contains**(tags, 'urgent')`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].file.name, "任务C");
});

test("数据源 AND 优先于 OR", () => {
  // AND 优先：Notes ∪ (Inbox ∩ #idea) = 3 + 1 = 4
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **OR** "Inbox" **AND** #idea`).rows.length, 4);
  // 括号改变结合：(Notes ∪ Inbox) ∩ #idea = 1（只有想法）
  const r = exec(`**SELECT** a **FROM** ("Notes" **OR** "Inbox") **AND** #idea`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].file.name, "想法");
});

/* ---------- file.* 虚拟列 / this 上下文 ---------- */

test("file.* 虚拟列 / this 上下文", () => {
  const r = exec(`**SELECT** file.name **AS** 名称 **FROM** "Notes" **WHERE** **contains**(file.name, '任务')`);
  assert.equal(r.rows.length, 3);
  const ctx = rows[0];
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** owner %==% this.owner`, ctx).rows.length, 2);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **WHERE** file.path %==% this.file.path`, ctx).rows.length, 1);
});

/* ---------- SORT：多级 + BY 优先级（字节序见数学示例） ---------- */

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

test("空 **BY** () 列表：视为无自定义优先级并计入 warnings", () => {
  const r = executeQuery(
    parseQuery(`**SELECT** a **FROM** "Notes" **SORT** status **BY** ()`),
    rows,
    null,
    { debug: true },
  );
  assert.ok(r.debug!.warnings.some((w) => /空优先级列表/.test(w)));
  assert.equal(r.rows.length, 3);
});

/* ---------- LIMIT ---------- */

test("**LIMIT** 与 **LIMIT** 0", () => {
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **SORT** priority **DESC** **LIMIT** 1`).rows.length, 1);
  assert.equal(exec(`**SELECT** a **FROM** "Notes" **LIMIT** 0`).rows.length, 0);
});

/* ---------- 调试 ---------- */

test("调试对象：from/sourceStats/where/sort/limit/fieldMisses/warnings/耗时", () => {
  const r = executeQuery(
    parseQuery(`**SELECT** status **FROM** "Notes" **OR** "Inbox" **WHERE** priority %>=% 1 **SORT** status **LIMIT** 1`),
    rows,
    null,
    { debug: true },
  );
  assert.ok(r.debug);
  assert.match(r.debug!.from, /输入 4 行 → 命中 4 行/);
  assert.deepEqual(
    r.debug!.sourceStats.map((s) => `${s.source}:${s.rows}`).sort(),
    ['文件夹 "Inbox":1', '文件夹 "Notes":3'],
  );
  assert.match(r.debug!.where!, /4 → 3 行/);
  assert.match(r.debug!.sort!, /status/);
  assert.match(r.debug!.sort!, /比较 \d+ 次/);
  assert.match(r.debug!.limit!, /截断 3 → 1 行/);
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
  assert.equal(execP(`**FROM** "Projects" **WHERE** status %==% '进行中'`).rows.length, 2);
});

test("跨目录多组：多级排序分组内排序（project ASC, priority DESC）", () => {
  const r = execP(`**FROM** "Projects" **SORT** project **ASC**, priority **DESC**`);
  assert.deepEqual(r.rows.map((r) => r.file.name), ["需求评审", "开发", "联调", "设计"]);
});

test("跨目录：缺失字段行参与查询（null 沉底 / 列为空）", () => {
  const r = execP(`**FROM** "Projects" **OR** "Inbox" **SORT** project **ASC**`);
  assert.equal(r.rows.length, 5);
  assert.equal(r.rows[r.rows.length - 1].file.name, "随手记");
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

console.log(`\n功能示例测试：全部 ${passed} 个通过`);
