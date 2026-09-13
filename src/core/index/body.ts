/**
 * @module index/body
 * @description 正文抽取（SEARCH 用，纯函数）：md 剥 frontmatter、非 md 剥围栏块
 *
 * body 只在查询含 SEARCH 时按需读取，随行临时携带、不缓存不常驻（规范 §6.1）：
 * - md：有 frontmatter → text.slice(frontmatterPosition.end.offset)，去掉一个前导 \n
 *   （它是 frontmatter 与 body 的分隔符，不属 body）；无 frontmatter → body = 全文，
 *   不去前导 \n；其余字符原样保留，不 trim，末尾 \n 不规范化；
 * - 非 md：剥掉全部 trim() === "---" 的独立行及其之间的内容（与自研解析器围栏语义一致），
 *   围栏行成对翻转 in/out 状态；未闭合 / 奇数个围栏 → 其后内容剥到 EOF；
 *   只认这一种围栏，``` / ~~~ / 缩进围栏原样保留。
 */

/** md 正文：按 metadataCache 的 frontmatter 结束偏移剥离；无 frontmatter 时 body = 全文。 */
export function extractMdBody(text: string, frontmatterEnd: number | null): string {
  if (frontmatterEnd === null) return text;
  let body = text.slice(frontmatterEnd);
  if (body.startsWith("\n")) body = body.slice(1); // 分隔符 \n 不属 body，只去一个
  return body;
}

/** 非 md 正文：剥掉全部 --- 围栏行及其之间的内容；未闭合 / 奇数个围栏剥到 EOF。 */
export function stripFenceBlocks(text: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "---") {
      inside = !inside; // 成对翻转；奇数个时最后一个之后全部视为围栏内
      continue;
    }
    if (!inside) out.push(line);
  }
  return out.join("\n");
}
