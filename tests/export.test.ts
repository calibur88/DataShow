/**
 * @module tests/export
 * @description 导出套件：路径解析（越界 / 格式 / 非法字符）、CSV 转义、JSON 类型保留、
 * 行搜索文本与过滤口径、导出列结构（WITHOUT ID 协同）、列表视图列分组（内容列 / 辅助列）
 */

import assert from "node:assert/strict";
import { executeQuery, type ResultSet } from "@dsql/executor";
import { parseQuery } from "@dsql/parser";
import { EMPTY, type DataRow } from "@dsql/types";
import {
  buildExport,
  exportHeaders,
  filterRows,
  resolveExportPath,
  rowRawValues,
  rowSearchText,
  toCSV,
  toJSON,
} from "@render/export";
import { formatCell } from "@render/format";
import { splitListColumns } from "@render/list-view";
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

/** 取拒绝原因（断言 ok === false 之后使用） */
function reasonOf(raw: string): string {
  const result = resolveExportPath(raw);
  assert.equal(result.ok, false, `预期拒绝：${raw}`);
  return result.ok ? "" : result.reason;
}

/* ---------- 共用数据集 ---------- */

const ROWS: DataRow[] = [
  makeRow("N/任务A.md", "N", { status: "进行中", owner: "张三", level: "INFO", priority: 2 }),
  makeRow("N/任务B.md", "N", { status: "已完成", owner: "李四", level: "WARN", priority: 1 }),
  makeRow("N/任务C.md", "N", { status: "进行中", owner: `张,三"引号"`, level: "INFO", priority: 3 }),
];

function run(sql: string, data: DataRow[] = ROWS): ResultSet {
  return executeQuery(parseQuery(sql), data, null);
}

const RESULT = run(
  '**FROM** "N" **SELECT** status **AS** 状态, owner **AS** 负责人, level **AS** 级别, priority **AS** 优先级',
);

/* ---------- 路径解析 ---------- */

test("[路径] 合法 vault 相对路径：含中文目录与子目录", () => {
  assert.deepEqual(resolveExportPath("exports/查询结果.json"), {
    ok: true,
    path: "exports/查询结果.json",
    format: "json",
  });
  assert.deepEqual(resolveExportPath("导出/任务表.csv"), {
    ok: true,
    path: "导出/任务表.csv",
    format: "csv",
  });
  assert.deepEqual(resolveExportPath("a/b/c/d.json"), {
    ok: true,
    path: "a/b/c/d.json",
    format: "json",
  });
});

test("[路径] 前导 / 与反斜杠分隔符规范化（扩展名大小写不敏感）", () => {
  assert.deepEqual(resolveExportPath("/exports/a.CSV"), {
    ok: true,
    path: "exports/a.CSV",
    format: "csv",
  });
  assert.deepEqual(resolveExportPath("a\\b\\c.json"), {
    ok: true,
    path: "a/b/c.json",
    format: "json",
  });
  assert.deepEqual(resolveExportPath("  exports/a.json  "), {
    ok: true,
    path: "exports/a.json",
    format: "json",
  });
});

test("[路径] 空 / 纯空白 / 纯分隔符 → 拒绝", () => {
  assert.match(reasonOf(""), /为空/);
  assert.match(reasonOf("   "), /为空/);
  assert.match(reasonOf("/"), /无效|相对路径/);
  // "//" 开头按 UNC 式绝对路径拒绝（早于空段判定）
  assert.match(reasonOf("///"), /相对路径/);
  assert.match(reasonOf("."), /无效/);
});

test("[路径] .. 越界 → 拒绝（含中间段）", () => {
  assert.match(reasonOf("../outside.json"), /越出 vault/);
  assert.match(reasonOf("a/../../b.json"), /越出 vault/);
  assert.match(reasonOf("..\\win.json"), /越出 vault/);
});

test("[路径] 绝对路径（盘符 / UNC）→ 拒绝", () => {
  assert.match(reasonOf("C:\\tmp\\a.json"), /相对路径/);
  assert.match(reasonOf("D:/tmp/a.csv"), /相对路径/);
  assert.match(reasonOf("\\\\server\\share\\a.json"), /相对路径/);
  assert.match(reasonOf("//server/share/a.json"), /相对路径/);
});

test("[路径] 缺扩展名 / 空扩展名 → 拒绝", () => {
  assert.match(reasonOf("exports/noext"), /\.json \/ \.csv/);
  assert.match(reasonOf("exports/a."), /\.json \/ \.csv/);
  assert.match(reasonOf("exports/.json"), /\.json \/ \.csv/);
});

test("[路径] xlsx 明确拒绝并给出替代建议（不引入表格库）", () => {
  const reason = reasonOf("导出/任务表.xlsx");
  assert.match(reason, /xlsx/);
  assert.match(reason, /另存/);
});

test("[路径] 其他扩展名 / 非法字符 → 拒绝", () => {
  assert.match(reasonOf("a.txt"), /不支持的导出格式 \.txt/);
  assert.match(reasonOf("a.md"), /不支持的导出格式 \.md/);
  assert.match(reasonOf("a:b.json"), /非法字符/);
  assert.match(reasonOf("a?.json"), /非法字符/);
});

/* ---------- 列结构 ---------- */

test("[列] 表头 = 可选「文件」列 + SELECT 列别名", () => {
  assert.deepEqual(exportHeaders(RESULT, false), ["文件", "状态", "负责人", "级别", "优先级"]);
  assert.deepEqual(exportHeaders(RESULT, true), ["状态", "负责人", "级别", "优先级"]);
});

test("[列] WITHOUT ID 时列结构与取值同步收缩", () => {
  assert.equal(rowRawValues(RESULT, RESULT.rows[0], false)[0], "任务A");
  assert.equal(rowRawValues(RESULT, RESULT.rows[0], true)[0], "进行中");
});

test("[列] 原始取值保留类型（数值不是格式化字符串）", () => {
  const values = rowRawValues(RESULT, RESULT.rows[0], false);
  assert.deepEqual(values, ["任务A", "进行中", "张三", "INFO", 2]);
});

/* ---------- 行搜索文本与过滤 ---------- */

test("[搜索] 行文本 = 文件标题 + 全部列名 + 全部列显示值", () => {
  const text = rowSearchText(RESULT, RESULT.rows[0], 4);
  for (const token of ["任务A", "状态", "进行中", "负责人", "张三", "级别", "INFO", "优先级", "2"]) {
    assert.ok(text.includes(token), `行文本应包含「${token}」：${text}`);
  }
});

test("[搜索] 空词返回全部行，且不改写结果集", () => {
  const before = RESULT.rows.length;
  const out = filterRows(RESULT, "", 4);
  assert.equal(out.length, before);
  assert.notEqual(out, RESULT.rows);
  assert.equal(RESULT.rows.length, before);
});

test("[搜索] 不区分大小写子串匹配（字段值）", () => {
  assert.equal(filterRows(RESULT, "info", 4).length, 2);
  assert.equal(filterRows(RESULT, "INFO", 4).length, 2);
  assert.equal(filterRows(RESULT, "warn", 4).length, 1);
});

test("[搜索] 匹配文件标题（大小写不敏感）", () => {
  assert.deepEqual(
    filterRows(RESULT, "任务b", 4).map((row) => row.path),
    ["N/任务B.md"],
  );
});

test("[搜索] 列名也在匹配范围内（三视图口径统一）", () => {
  assert.equal(filterRows(RESULT, "负责人", 4).length, 3);
  assert.equal(filterRows(RESULT, "优先级", 4).length, 3);
});

test("[搜索] 空格两侧忽略，无命中 → 空数组", () => {
  assert.equal(filterRows(RESULT, "  张三  ", 4).length, 1);
  assert.equal(filterRows(RESULT, "不存在的词", 4).length, 0);
});

/* ---------- JSON ---------- */

test("[JSON] 键为列名，缺失字段补 null 且不丢键", () => {
  const r = run('**FROM** "N" **SELECT** status **AS** 状态, priority **AS** 优先级, due **AS** 截止');
  const text = toJSON(r, r.rows, false);
  const data = JSON.parse(text) as Record<string, unknown>[];
  assert.equal(data.length, 3);
  assert.deepEqual(Object.keys(data[0]), ["文件", "状态", "优先级", "截止"]);
  assert.equal(data[0]["文件"], "任务A");
  assert.equal(data[0]["状态"], "进行中");
  assert.equal(data[0]["优先级"], 2);
  assert.equal(data[0]["截止"], null);
  assert.ok(text.endsWith("\n"));
});

test("[JSON] 数组字段保留数组，布尔保留布尔", () => {
  const data = [makeRow("N/n.md", "N", { tags: ["a", "b"], done: true })];
  const r = run('**FROM** "N" **SELECT** tags **AS** 标签, done **AS** 完成', data);
  const parsed = JSON.parse(toJSON(r, r.rows, true)) as Record<string, unknown>[];
  assert.deepEqual(parsed[0]["标签"], ["a", "b"]);
  assert.equal(parsed[0]["完成"], true);
});

/* ---------- CSV ---------- */

test("[CSV] 表头 + CRLF 行结束 + 数值显示文本", () => {
  const text = toCSV(RESULT, RESULT.rows, false, 4);
  const lines = text.split("\r\n");
  assert.equal(lines[0], "文件,状态,负责人,级别,优先级");
  assert.equal(lines[1], "任务A,进行中,张三,INFO,2");
  assert.equal(lines[2], "任务B,已完成,李四,WARN,1");
  assert.ok(text.endsWith("\r\n"));
});

test("[CSV] 含逗号 / 双引号的字段加引号且内部引号翻倍", () => {
  const lines = toCSV(RESULT, RESULT.rows, false, 4).split("\r\n");
  assert.equal(lines[3], '任务C,进行中,"张,三""引号""",INFO,3');
});

test("[CSV] 含换行的字段加引号包裹", () => {
  const data = [makeRow("N/n.md", "N", { note: "第一行\n第二行" })];
  const r = run('**FROM** "N" **SELECT** note **AS** 备注', data);
  assert.ok(toCSV(r, r.rows, false, 4).includes('"第一行\n第二行"'));
});

test("[CSV] 小数位按设置修剪；null 显示为 —", () => {
  const data = [makeRow("N/n.md", "N", { ratio: 1.23456 })];
  const r = run('**FROM** "N" **SELECT** ratio **AS** 比率, due **AS** 截止', data);
  const lines = toCSV(r, r.rows, true, 2).split("\r\n");
  assert.equal(lines[0], "比率,截止");
  assert.equal(lines[1], "1.23,—");
});

/* ---------- EMPTY 消费点回归 ---------- */

test("[EMPTY] 未赋值字段（empty 值）四面口径：渲染 / WHERE / JSON / CSV", () => {
  // frontmatter `备注:`（冒号后无内容）→ empty 值；`标题` 为对照的正常值
  const data = [makeRow("E/空备注.md", "E", { 标题: "甲", 备注: EMPTY })];

  // ① 渲染（三视图共用出口 formatCell）：empty 值与 null 同显示 —
  const r = run('**FROM** "E" **SELECT** 标题, 备注', data);
  const raw = rowRawValues(r, r.rows[0], false);
  assert.equal(raw[2], EMPTY, "SELECT 裸字段应原样透出 empty 值（不经求值抹平）");
  assert.equal(formatCell(raw[2], 4), "—");
  // 搜索文本同样不得外露内部形态
  assert.ok(!rowSearchText(r, r.rows[0], 4).includes("Symbol"));

  // ② WHERE：empty 值与 null 同一性（stripEmpty 归 null）
  const hit = run('**FROM** "E" **WHERE** 备注 %==% null **SELECT** 标题', data);
  assert.equal(hit.rows.length, 1);

  // ③ JSON 导出：空值 → null（保留键，不丢键、不写出 "Symbol(...)"）
  const jr = run('**FROM** "E" **SELECT** 备注', data);
  const records = JSON.parse(toJSON(jr, jr.rows, true)) as Record<string, unknown>[];
  assert.ok("备注" in records[0], "键必须保留");
  assert.equal(records[0]["备注"], null);

  // ④ CSV 导出：走 formatCell → 对应字段为 —
  const cr = run('**FROM** "E" **SELECT** 备注', data);
  const csv = toCSV(cr, cr.rows, true, 4);
  assert.equal(csv, "备注\r\n—\r\n");
});

/* ---------- 载荷分派 ---------- */

test("[分派] buildExport 按格式产出对应载荷", () => {
  const asJson = buildExport("json", RESULT, RESULT.rows, false, 4);
  assert.equal(asJson.format, "json");
  assert.equal(typeof asJson.data, "string");
  assert.doesNotThrow(() => JSON.parse(asJson.data));

  const asCsv = buildExport("csv", RESULT, RESULT.rows, false, 4);
  assert.equal(asCsv.format, "csv");
  assert.ok(asCsv.data.startsWith("文件,状态,负责人,级别,优先级\r\n"));
});

test("[分派] 导出仅含搜索命中行（与结果区所见一致）", () => {
  const hit = filterRows(RESULT, "任务B", 4);
  const csv = buildExport("csv", RESULT, hit, false, 4).data;
  assert.equal(csv, "文件,状态,负责人,级别,优先级\r\n任务B,已完成,李四,WARN,1\r\n");
  const json = JSON.parse(buildExport("json", RESULT, hit, false, 4).data) as Record<string, unknown>[];
  assert.equal(json.length, 1);
  assert.equal(json[0]["文件"], "任务B");
});

/* ---------- 列表视图列分组（纯函数） ---------- */

test("[列表] 内容列 / 辅助列两分，两组合并即全部投影列（不丢弃任何列）", () => {
  const r = run(`**TABLE_VIEW** **SELECT**
  owner **AS** 负责人,
  status,
  priority %+% 1 **AS** $下一级$,
  $下一级$ %*% 2 **AS** 折扣,
  file.name,
  **TOTAL** priority **AS** $总优先级$
**FROM** "N"`);
  const { primary, derived } = splitListColumns(r.columns);
  // 内容列：裸字段 / 裸标识符别名的表达式列
  assert.deepEqual(primary.map((c) => c.alias), ["负责人", "status", "折扣"]);
  // 辅助列：变量池列（expr AS $变量$ / TOTAL 槽位）、虚拟列 file.*
  assert.deepEqual(derived.map((c) => c.alias), ["下一级", "file.name", "总优先级"]);
  assert.equal(primary.length + derived.length, r.columns.length);
  // 两组各自保持投影顺序
  assert.deepEqual([...primary, ...derived].map((c) => c.alias).sort(), r.columns.map((c) => c.alias).sort());
});

test("[列表] 变量池列一律归入辅助列：expr **AS** $变量$ / 裸 $槽位$ / TOTAL", () => {
  const r = run(`**SELECT** status, priority %+% 1 **AS** $升级$, $过滤数$ **FROM** "N" **COUNT** true %==% true **AS** $过滤数$`);
  const { primary, derived } = splitListColumns(r.columns);
  assert.deepEqual(primary.map((c) => c.alias), ["status"]);
  assert.deepEqual(derived.map((c) => c.alias), ["升级", "过滤数"]);
});

test("[列表] 虚拟列 file.* / this.* 归入辅助列", () => {
  const r = run(`**SELECT** status, file.name, file.outlinks, this.状态 **FROM** "N"`);
  const { primary, derived } = splitListColumns(r.columns);
  assert.deepEqual(primary.map((c) => c.alias), ["status"]);
  assert.deepEqual(derived.map((c) => c.alias), ["file.name", "file.outlinks", "this.状态"]);
});

test("[列表] 域扩展合成列（readonly）归入辅助列", () => {
  const r = run(`**TABLE_VIEW** **SELECT** <人物>, $有装备$
{
  { **SELECT** name, wolf **FROM** "N" } **AS** <人物>
  **YIELD** <人物>::name **IN** <人物>::wolf **AS** $有装备$
}`);
  const { primary, derived } = splitListColumns(r.columns);
  assert.deepEqual(primary, []);
  assert.deepEqual(derived.map((c) => c.alias), ["<人物>", "有装备"]);
});

if (failures.length > 0) {
  console.error(`\n导出测试：${passed} 通过，${failures.length} 失败`);
  process.exitCode = 1;
} else {
  console.log(`\n导出测试：全部 ${passed} 个通过`);
}
