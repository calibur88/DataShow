// 一次性脚本：追加 sr7 演示看板（TOTAL 全量分母 + 布尔参与算术）到两个演示库
import fs from "node:fs";

const sr7 = {
  id: "sr7-total-denominator",
  name: "求值·TOTAL 全量分母与布尔算术",
  type: "search示例",
  description: "TOTAL 1 = 全部分母（含 [ext] txt，恒忽略 WHERE）；$文件总数$ 逐行引用，布尔 (类型 %!=% '记录') 经 Number() 转 0/1 参与减法：追更记录行 = 6，其余行（含类型缺失行按 null 同一性）= 5",
  sql: '**SELECT**\n  **TOTAL** 1 **AS** $文件总数$,\n  类型,\n  $文件总数$ %-% (类型 %!=% \'记录\') **AS** 非记录文件数\n**FROM** "示例/文章示例"\n**WHERE** [txt, md]\n**SORT** file.name **ASC**',
  viewType: ""
};

for (const [path, isFlat] of [
  ["E:/DataShow/test-vault/.obsidian/plugins/data-show/data.json", true],
  ["E:/DataShow/test-vault-local/.obsidian/plugins/data-show/data.json", false],
]) {
  const d = JSON.parse(fs.readFileSync(path, "utf8"));
  const list = isFlat ? d.boards : d.settings.boards;
  const kept = list.filter((b) => b.id !== sr7.id);
  kept.push(sr7);
  if (isFlat) d.boards = kept;
  else d.settings.boards = kept;
  fs.writeFileSync(path, JSON.stringify(d, null, 2));
  console.log(path.split("/")[1], "->", kept.length, "boards");
}
