/**
 * @module dsql/parser
 * @description DSQL 解析器（递归下降）：子句前件校验（含 WHILE / SEARCH）、SELECT 列表与表达式优先级
 *
 * 子句按前件关系解析：各子句至多出现一次，书写顺序不限；
 * WHERE / COUNT / SORT / LIMIT / WHILE 以 **FROM** 为前件，**SEARCH** 以 **WHILE** 为前件
 * （必须在其之后），SELECT 可省略（默认全部字段）。
 * **WHILE** 与 **SEARCH** 必须同时出现：只写其一 → parse 期致命。
 * 表达式优先级：OR < AND < NOT < 比较 < 连接 < 加减 < 乘除取模 < 乘方（右结合）< 一元。
 *
 * view 产生式：（**TABLE_VIEW** | **LIST_VIEW** | **CARD_VIEW**）?（缺省 TABLE_VIEW）
 * 旧 **TABLE** / **LIST** 已被词法器废除，落到"未知关键词"分支抛 LexError。
 */

import type { BinOp, ColumnSel, CountItemNode, Expr, Query, SearchItemNode, SortClause, SortKey, Source, WhileNode } from "./ast";
import { FUNCTIONS, LexError, Lexer, type Token } from "./lexer";
import type { FieldValue, ViewType } from "./types";

/** [ext] 内容 → 后缀列表：`[]` → 空数组（ALL 语义）；其余按逗号切、逐段 trim、去空段，原样保留不归一化 */
function parseExts(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  return raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
}

/**
 * `[起始, 结束]` 内文本 → 两侧边界片段（WHILE 边界用）。
 * 词法层把 `[` 到 `]` 之间的原文整体收进 extfilter token，故在此按**首个逗号**二次切分后
 * 交给子解析器。边界只接受 NUMBER 字面量（无括号 / 引号 / 嵌套逗号），故不做深度与引号感知——
 * 出现第二个逗号即「需两个边界」，多出的内容不进子解析器。
 *
 * @param raw - extfilter token 的原文（未归一化）
 * @returns 两侧片段及其在 raw 中的起始下标（错误列号偏移用）；逗号数不为 1 时返回 null
 */
function splitWhileBounds(raw: string): { text: string; offset: number }[] | null {
  const cut = raw.indexOf(",");
  if (cut < 0 || raw.indexOf(",", cut + 1) >= 0) return null;
  return [
    { text: raw.slice(0, cut), offset: 0 },
    { text: raw.slice(cut + 1), offset: cut + 1 },
  ];
}

/**
 * SEARCH 正则编译（parse 期一次，运行期复用）。
 * \p{ 检测：连续反斜杠个数为奇数且其后紧接 p{ / P{ → 未转义的 \p（非 u 模式下是
 * identity escape，静默退化为字面 p，用户写的 CJK 断言永远匹配不上且不报错）→ 致命错误；
 * 偶数个反斜杠后跟 p{ 是字面文本，不报错。
 */
function compileSearchRegex(raw: string): { regex: RegExp } | { error: string } {
  let run = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\") {
      run++;
      continue;
    }
    if (run % 2 === 1 && (raw[i] === "p" || raw[i] === "P") && raw[i + 1] === "{") {
      return { error: "SEARCH 正则不支持 \\p{…}（无 u flag），CJK 请用字符范围 [一-鿿]" };
    }
    run = 0;
  }
  try {
    return { regex: new RegExp(raw) };
  } catch (err) {
    return { error: `SEARCH 正则非法：${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 查询解析错误：message 已格式化为「[DSQL] 第 x 行第 y 列：原因」。 */
export class QueryParseError extends Error {
  /** 未附加行列前缀的原始原因（片段子解析重定位错误时重组消息用） */
  readonly reason: string;

  constructor(
    message: string,
    public line: number,
    public col: number,
  ) {
    super(`[DSQL] 第 ${line} 行第 ${col} 列：${message}`);
    this.reason = message;
  }
}

/**
 * 解析 DSQL 源文本 → AST。
 *
 * @param source - DSQL 源文本
 * @returns 查询 AST
 * @throws QueryParseError 语法错误（带行列号）
 */
export function parseQuery(source: string): Query {
  return new Parser(new Lexer(source).tokenize()).parseQuery();
}

class Parser {
  private pos = 0;
  /** 是否处于 SELECT 列表内（DSQL 1.4：$变量$ 仅在 SELECT 中可引用） */
  private inSelect = false;
  /** 是否处于 WHERE 表达式内（[ext] 后缀过滤仅在此合法） */
  private inWhere = false;
  private variableTokens = new Map<string, Token>();
  /**
   * AS 列标签（裸标识符）→ 首次定义的 token。
   * 仅收录行字段池的裸标识符标签；`$变量$` 标签是变量池名称，走 varAliasTokens，
   * 不与裸标签跨池判重（两池隔离，见 §6.7）。用于：裸标签互不相同校验、SEARCH 别名 vs 裸标签冲突检查。
   */
  private aliasTokens = new Map<string, Token>();
  private totalToken: Token | null = null;

  constructor(private tokens: Token[]) {}

  parseQuery(): Query {
    // v2.0：[TABLE_VIEW | LIST_VIEW | CARD_VIEW]（可省略，默认 TABLE_VIEW）
    let view: ViewType = "TABLE_VIEW";
    if (this.isMarked("TABLE_VIEW")) {
      this.advance();
      view = "TABLE_VIEW";
    } else if (this.isMarked("LIST_VIEW")) {
      this.advance();
      view = "LIST_VIEW";
    } else if (this.isMarked("CARD_VIEW")) {
      this.advance();
      view = "CARD_VIEW";
    }

    let select: ColumnSel[] | "*" = "*";
    let from: Source | null = null;
    let where: Expr | null = null;
    let search: SearchItemNode[] | null = null;
    let whileNode: WhileNode | null = null;
    let whileToken: Token | null = null;
    let count: CountItemNode[] | null = null;
    let sort: SortClause | null = null;
    let limit: number | null = null;
    const seen = new Set<string>();

    // 子句循环：书写顺序不限，每条至多一次，前件必须已出现
    for (;;) {
      if (this.isMarked("SELECT")) {
        this.expectOnce(seen, "SELECT");
        this.advance();
        select = this.parseSelectList();
      } else if (this.isMarked("FROM")) {
        this.expectOnce(seen, "FROM");
        this.advance();
        from = this.parseSource();
      } else if (this.isMarked("COUNT")) {
        this.expectOnce(seen, "COUNT");
        this.requirePrerequisite(seen, "COUNT", "FROM");
        this.advance();
        count = this.parseCountClause();
      } else if (this.isMarked("WHILE")) {
        this.expectOnce(seen, "WHILE");
        this.requirePrerequisite(seen, "WHILE", "FROM");
        whileToken = this.peek();
        this.advance();
        whileNode = this.parseWhileClause(whileToken);
      } else if (this.isMarked("SEARCH")) {
        this.expectOnce(seen, "SEARCH");
        this.requirePrerequisite(seen, "SEARCH", "WHILE");
        this.advance();
        search = this.parseSearchClause();
      } else if (this.isMarked("WHERE")) {
        this.expectOnce(seen, "WHERE");
        this.requirePrerequisite(seen, "WHERE", "FROM");
        this.advance();
        this.inWhere = true;
        try {
          where = this.parseExpr();
        } finally {
          this.inWhere = false;
        }
      } else if (this.isMarked("SORT")) {
        this.expectOnce(seen, "SORT");
        this.requirePrerequisite(seen, "SORT", "FROM");
        this.advance();
        sort = this.parseSortClause();
      } else if (this.isMarked("LIMIT")) {
        this.expectOnce(seen, "LIMIT");
        this.requirePrerequisite(seen, "LIMIT", "FROM");
        this.advance();
        const tok = this.peek();
        if (tok.type !== "number") throw this.err(tok, "**LIMIT** 后应为数字");
        if (!Number.isInteger(parseFloat(tok.value))) {
          throw this.err(tok, "**LIMIT** 应为整数（小数为语法错误）");
        }
        this.advance();
        limit = parseInt(tok.value, 10);
      } else if (this.isMarked("WITHOUT")) {
        this.expectOnce(seen, "WITHOUT ID");
        this.advance();
        this.expectKw("ID");
      } else {
        break;
      }
    }

    if (from === null) {
      const tok = this.peek();
      throw this.err(tok, `缺少 **FROM** 子句（数据源），实际为 ${describe(tok)}`);
    }

    // WHILE 与 SEARCH 必须同时出现：SEARCH 侧由前件校验拦截，此处拦 WHILE 侧
    if (whileNode !== null && search === null) {
      throw this.err(
        whileToken ?? this.peek(),
        "**WHILE** 需 **SEARCH** 配合（两者必须同时出现，只写其一为 parse 期致命错误）",
      );
    }

    // SEARCH 别名（行字段池）vs SELECT 的裸标识符列标签（同行字段池）→ 同名即冲突；
    // **AS** $变量$ 是变量池名称，与行字段池互不校验（两池隔离，§6.7）。
    // parse 期静态可判定，无论子句书写顺序。
    if (search !== null) {
      for (const item of search) {
        // aliasTokens 仅含裸标识符标签，故此处即为行字段池内冲突
        if (this.aliasTokens.has(item.alias)) {
          throw this.err(
            this.searchAliasTokens.get(item.alias) ?? this.tokens[0],
            `SEARCH 别名 '${item.alias}' 与 SELECT 列标签冲突，请改用其他别名`,
          );
        }
      }
    }

    // COUNT 填充目标必须是 SELECT 声明的裸槽位（TOTAL 项自声明自填充，不受此限）；
    // 输出别名（expr AS $x$）不是可填充槽位；SELECT 已解析完整，槽位声明位置不限
    for (const [name, tok] of this.countFillTokens) {
      if (this.varAliasTokens.has(name)) {
        throw this.err(tok, `$${name}$ 非槽位声明，不可被聚合填充`);
      }
      if (!this.slotTokens.has(name)) {
        throw this.err(tok, `映射名 $${name}$ 未在 SELECT 声明`);
      }
    }

    const trailing = this.peek();
    if (trailing.type !== "eof") {
      throw this.err(trailing, `多余的查询子句「${describe(trailing)}」（子句：SELECT / FROM / WHERE / WHILE / SEARCH / COUNT / SORT / LIMIT / WITHOUT ID，每条至多一次）`);
    }

    return { view, withoutId: seen.has("WITHOUT ID"), select, from, where, search, while: whileNode, count, sort, limit };
  }

  /* ---------- COUNT（DSQL 2.3 分类计数） ---------- */

  /** 聚合填充目标（TOTAL 自声明自填充；COUNT 须指向 SELECT 声明的裸槽位） */
  private fillTokens = new Map<string, Token>();
  /** TOTAL 填充目标（自声明自投影；与裸槽位声明同名 → 重复声明） */
  private totalFillTokens = new Map<string, Token>();
  /** COUNT 填充目标（严格校验子集：必须在 SELECT 声明裸槽位） */
  private countFillTokens = new Map<string, Token>();
  /** 裸 $x$ 槽位声明（SELECT 内；COUNT 填充的前提，未填充静默忽略） */
  private slotTokens = new Map<string, Token>();
  /** expr AS $x$ 输出别名（变量池：与槽位共用命名空间，不可被聚合填充） */
  private varAliasTokens = new Map<string, Token>();

  /**
   * count_clause = **COUNT** , count_item , { "," , count_item } ;
   * count_item   = comparison , **AS** , variable（槽位）；
   * 必须显式比较符（裸操作数致命）；比较内引用聚合变量 → 循环依赖致命。
   */
  private parseCountClause(): CountItemNode[] {
    const items: CountItemNode[] = [];
    do {
      const start = this.peek();
      const expr = this.parseComparison();
      if (expr.kind !== "binary" || !["==", "!=", ">", "<", ">=", "<="].includes(expr.op)) {
        throw this.err(start, "**COUNT** 需比较语句（显式比较符：%==% / %!=% / %>% / %<% / %>=% / %<=%）");
      }
      const hasVar = (e: Expr): boolean =>
        e.kind === "variable" ||
        (e.kind === "binary" && (hasVar(e.left) || hasVar(e.right))) ||
        (e.kind === "unary" && hasVar(e.expr)) ||
        (e.kind === "call" && e.args.some(hasVar));
      if (hasVar(expr)) {
        throw this.err(start, "聚合项内不得引用聚合变量（循环依赖）");
      }
      this.expectKw("AS");
      const t = this.peek();
      if (t.type !== "variable") {
        throw this.err(t, "**COUNT** 别名必须为槽位（$变量$，在 **SELECT** 中声明）");
      }
      this.advance();
      if (this.fillTokens.has(t.value)) {
        throw this.err(t, `槽位 $${t.value}$ 已被填充`);
      }
      this.fillTokens.set(t.value, t);
      this.countFillTokens.set(t.value, t);
      items.push({ cmp: expr, slot: t.value, line: t.line, col: t.col });
    } while (this.matchPunct(","));
    return items;
  }

  /* ---------- WHILE（DSQL 2.4 循环驱动） ---------- */

  /**
   * while_clause = **WHILE** , "[" , NUMBER , "," , NUMBER , "]" ;
   * 形态唯一（两个 NUMBER 字面量、方括号包裹、逗号分隔）；无嵌套 / 无 BY / 无方向词。
   * 两边界须为非负整数且 起始 < 结束——均为 parse 期静态校验（违反即致命），
   * 迭代次数 = 结束 - 起始 亦在 parse 期算出；字段 / 函数 / 算术等表达式不再是合法形态。
   * 词法层把 `[` 到 `]` 的原文整体收进 extfilter token，故此处二次切分后逐段校验。
   */
  private parseWhileClause(kw: Token): WhileNode {
    const bracket = this.peek();
    if (bracket.type !== "extfilter") {
      throw this.err(
        bracket,
        `**WHILE** 后应为 [起始, 结束]（方括号包裹两个非负整数字面量，如 [0, 3]），实际为 ${describe(bracket)}`,
      );
    }
    this.advance();
    const parts = splitWhileBounds(bracket.value);
    if (parts === null) {
      throw this.err(bracket, "**WHILE** 需两个边界（形如 [起始, 结束]，逗号分隔）");
    }
    const start = this.parseWhileBound(parts[0], bracket, "起始");
    const end = this.parseWhileBound(parts[1], bracket, "结束");
    if (start >= end) {
      throw this.err(
        bracket,
        `**WHILE** 起始边界须小于结束边界（当前 [${start}, ${end}]，迭代次数须为正）`,
      );
    }
    return { start, end, line: kw.line, col: kw.col };
  }

  /**
   * WHILE 单侧边界：仅接受 NUMBER 字面量，且须为非负整数——
   * 非 NUMBER（字段 / 函数 / 算术 / 字符串 / `$变量$` / null）与小数（NUMBER 允许小数）两处
   * 报错文案区分，便于定位是哪一类越界；均 parse 期致命。
   */
  private parseWhileBound(part: { text: string; offset: number }, bracket: Token, which: "起始" | "结束"): number {
    if (part.text.trim() === "") throw this.err(bracket, `**WHILE** ${which}边界不能为空`);
    let tokens: Token[];
    try {
      tokens = new Lexer(part.text).tokenize();
    } catch (err) {
      throw this.relocateLex(err as Error, bracket, part.offset);
    }
    const only = tokens[0];
    if (tokens.length !== 2 || only.type !== "number") {
      throw this.err(
        bracket,
        `**WHILE** ${which}边界须为 NUMBER 字面量（非负整数，如 [0, 3]），实际为「${part.text.trim()}」`,
      );
    }
    if (!/^\d+$/.test(only.value)) {
      throw this.err(bracket, `**WHILE** ${which}边界须为非负整数（实际为 ${only.value}）`);
    }
    return Number(only.value);
  }

  /** 片段内的词法错误按 `[` 的位置重定位列号（片段内换行已被词法层折叠为空格，行偏移恒为 0） */
  private relocateLex(err: Error, bracket: Token, offset: number): QueryParseError {
    if (err instanceof LexError) {
      return new QueryParseError(err.message, bracket.line, bracket.col + offset + err.col);
    }
    throw err;
  }

  /* ---------- SEARCH（DSQL 2.2 正文抽取） ---------- */

  /** SEARCH 别名 → 别名 token（parse 期冲突错误定位用） */
  private searchAliasTokens = new Map<string, Token>();

  /**
   * search_clause = SEARCH , search_item , { "," , search_item } ;
   * search_item   = STRING , **AS** , ident（裸标识符，不接受 $变量$）；
   * 正则 parse 期编译一次（非法 / 未转义 \p{ 致命错误），运行期复用。
   */
  private parseSearchClause(): SearchItemNode[] {
    const items: SearchItemNode[] = [];
    do {
      const strTok = this.peek();
      if (strTok.type !== "string") {
        throw this.err(strTok, `SEARCH 模板应为单引号字符串（正则），实际为 ${describe(strTok)}`);
      }
      this.advance();
      if (!this.matchKw("AS")) {
        throw this.err(this.peek(), `SEARCH 模板后应为 **AS** 别名，实际为 ${describe(this.peek())}`);
      }
      const aliasTok = this.peek();
      if (aliasTok.type === "variable") {
        throw this.err(aliasTok, `SEARCH 别名应为裸标识符，不接受 $变量$（$${aliasTok.value}$）`);
      }
      if (aliasTok.type !== "ident") {
        throw this.err(aliasTok, `SEARCH 别名应为裸标识符，实际为 ${describe(aliasTok)}`);
      }
      this.advance();
      if (this.searchAliasTokens.has(aliasTok.value)) {
        throw this.err(aliasTok, `SEARCH 别名 '${aliasTok.value}' 重复（SEARCH 内别名互不相同）`);
      }
      this.searchAliasTokens.set(aliasTok.value, aliasTok);
      const compiled = compileSearchRegex(strTok.value);
      if ("error" in compiled) throw this.err(strTok, compiled.error);
      items.push({
        pattern: strTok.value,
        regex: compiled.regex,
        alias: aliasTok.value,
        line: aliasTok.line,
        col: aliasTok.col,
      });
    } while (this.matchPunct(","));
    return items;
  }

  /** 子句重复出现报错 */
  private expectOnce(seen: Set<string>, name: string): void {
    if (seen.has(name)) {
      throw this.err(this.peek(), `**${name}** 子句重复出现（每条子句至多一次）`);
    }
    seen.add(name);
  }

  /** 前件校验：子句 clause 要求 prerequisite 已在其之前出现 */
  private requirePrerequisite(seen: Set<string>, clause: string, prerequisite: string): void {
    if (!seen.has(prerequisite)) {
      throw this.err(this.peek(), `**${clause}** 需要 **${prerequisite}** 作为前件（**${prerequisite}** 必须在其之前）`);
    }
  }

  /* ---------- SELECT ---------- */

  private parseSelectList(): ColumnSel[] | "*" {
    const tok = this.peek();
    if (tok.type === "punct" && tok.value === "*") {
      this.advance();
      return "*";
    }
    const items: ColumnSel[] = [];
    this.inSelect = true;
    try {
      do {
        if (this.isMarked("TOTAL")) {
          items.push(this.parseTotalItem());
          continue;
        }
        const itemTok = this.peek();
        const expr = this.parseExpr();
        let alias: string | null = null;
        let aliasVar = false;
        if (this.matchKw("AS")) {
          const parsed = this.parseAlias();
          alias = parsed.name;
          aliasVar = parsed.isVar;
        }
        // 裸 $x$ 槽位声明（expr 为变量引用且无别名）：由 COUNT 填充；
        // 与 TOTAL 填充名同名 → 重复声明（TOTAL 自声明自投影，裸槽位冗余且致命）
        if (alias === null && expr.kind === "variable") {
          if (this.slotTokens.has(expr.name) || this.varAliasTokens.has(expr.name) ||
              this.totalFillTokens.has(expr.name)) {
            throw this.err(itemTok, `槽位 $${expr.name}$ 重复声明`);
          }
          this.slotTokens.set(expr.name, itemTok);
          items.push({ expr, alias: null, slot: true });
          continue;
        }
        // expr AS $x$：输出别名，与槽位声明撞名 → 重复声明（统一命名空间）
        if (aliasVar && this.slotTokens.has(alias!)) {
          throw this.err(itemTok, `槽位 $${alias}$ 重复声明`);
        }
        items.push({ expr, alias, ...(aliasVar ? { aliasVar: true as const } : {}) });
      } while (this.matchPunct(","));
    } finally {
      this.inSelect = false;
    }
    this.validateVariables(items);
    return items;
  }

  /** **TOTAL** 聚合项：操作数限字段/数字，**AS** 强制 $槽位$（DSQL 1.4 引入；自声明自投影，见 §6.7） */
  private parseTotalItem(): ColumnSel {
    const start = this.advance(); // TOTAL
    this.totalToken = start;
    const tok = this.peek();
    let expr: Expr;
    if (tok.type === "variable") {
      throw this.err(tok, "聚合项内不得引用聚合变量（循环依赖）");
    }
    if (tok.type === "ident") {
      const lower = tok.value.toLowerCase();
      if (lower === "true" || lower === "false" || lower === "null") {
        throw this.err(tok, "**TOTAL** 操作数应为字段名或数字");
      }
      this.advance();
      expr = { kind: "field", path: tok.value };
    } else if (tok.type === "number") {
      this.advance();
      expr = { kind: "lit", value: parseFloat(tok.value) || 0 };
    } else {
      throw this.err(tok, "**TOTAL** 操作数应为字段名或数字（如 **TOTAL** 薪资 / **TOTAL** 1）");
    }
    if (!this.matchKw("AS")) {
      throw this.err(start, "**TOTAL** 必须带 **AS** 槽位（如 **TOTAL** 成绩 **AS** $总成绩$）");
    }
    const t = this.peek();
    if (t.type !== "variable") {
      throw this.err(t, "**TOTAL** 别名必须为槽位（$变量$，在 **SELECT** 中声明）");
    }
    this.advance();
    if (this.varAliasTokens.has(t.value)) {
      throw this.err(t, `$${t.value}$ 非槽位声明，不可被聚合填充`);
    }
    if (this.slotTokens.has(t.value)) {
      throw this.err(t, `槽位 $${t.value}$ 重复声明`);
    }
    if (this.fillTokens.has(t.value)) {
      throw this.err(t, `槽位 $${t.value}$ 已被填充`);
    }
    this.fillTokens.set(t.value, t);
    this.totalFillTokens.set(t.value, t);
    // aliasVar：TOTAL 别名恒为 $变量$（变量池名称），不参与行字段池校验（§6.7）
    return { expr, alias: t.value, total: true, aliasVar: true };
  }

  /**
   * **AS** 别名（列标签）：裸标识符或 `$变量$`。
   * 标签互不相同（两者都产出同名列）；裸标识符标签另需在行字段池内唯一（§6.7），
   * `$变量$` 形态是变量池名称，只受变量池规则约束。
   *
   * @returns 别名的裸名，以及是否为 `$变量$` 形态
   */
  private parseAlias(): { name: string; isVar: boolean } {
    const tok = this.peek();
    const isVar = tok.type === "variable";
    let name: string;
    if (isVar) {
      this.advance();
      name = tok.value;
      if (this.varAliasTokens.has(name)) {
        throw this.err(tok, `别名 '$${name}$' 重复定义（SELECT 内 **AS** 别名互不相同）`);
      }
      this.varAliasTokens.set(name, tok);
      // `$变量$` 别名属变量池，不与裸标识符标签跨池判重（两池隔离，§6.7）
      return { name, isVar };
    }
    name = this.expectIdent("**AS** 后应为别名（标识符或 $变量$）").value;
    if (this.aliasTokens.has(name)) {
      throw this.err(tok, `别名 '${name}' 重复定义（SELECT 内 **AS** 别名互不相同）`);
    }
    this.aliasTokens.set(name, tok);
    return { name, isVar };
  }

  /** 静态校验：$变量$ 引用须指向槽位/聚合填充名或更早的输出别名；聚合项（TOTAL）内引用变量 → 循环依赖 */
  private validateVariables(items: ColumnSel[]): void {
    const slots = new Set([...this.slotTokens.keys(), ...this.fillTokens.keys()]);
    const declared = new Set<string>();
    const check = (expr: Expr, inAgg: boolean): void => {
      switch (expr.kind) {
        case "variable":
          if (inAgg) {
            throw this.err(this.totalToken ?? this.tokens[0], "聚合项内不得引用聚合变量（循环依赖）");
          }
          if (!slots.has(expr.name) && !declared.has(expr.name)) {
            throw this.err(
              this.variableTokens.get(expr.name) ?? this.tokens[0],
              `变量 $${expr.name}$ 未声明（在 **SELECT** 中以裸 $${expr.name}$ 声明槽位，或先以 **AS** $${expr.name}$ 定义）`,
            );
          }
          return;
        case "binary":
          check(expr.left, inAgg);
          check(expr.right, inAgg);
          return;
        case "unary":
          check(expr.expr, inAgg);
          return;
        case "call":
          for (const arg of expr.args) check(arg, inAgg);
          return;
        default:
          return;
      }
    };
    for (const item of items) {
      check(item.expr, item.total === true);
      if (item.alias && this.varAliasTokens.has(item.alias)) declared.add(item.alias);
    }
  }

  /* ---------- FROM（AND 优先于 OR） ---------- */

  private parseSource(): Source {
    return this.parseSourceOr();
  }

  private parseSourceOr(): Source {
    let left = this.parseSourceAnd();
    while (this.matchKw("OR")) {
      left = { kind: "op", op: "or", left, right: this.parseSourceAnd() };
    }
    return left;
  }

  private parseSourceAnd(): Source {
    let left = this.parseSourcePrimary();
    while (this.matchKw("AND")) {
      left = { kind: "op", op: "and", left, right: this.parseSourcePrimary() };
    }
    return left;
  }

  private parseSourcePrimary(): Source {
    if (this.matchPunct("(")) {
      const inner = this.parseSource();
      this.expectPunct(")");
      return inner;
    }
    const tok = this.peek();
    if (tok.type === "extfilter") {
      throw this.err(tok, "[ext] 后缀过滤仅可在 **WHERE** 表达式中使用（**FROM** 数据源应为 \"文件夹路径\" 或 #标签）");
    }
    if (tok.type === "path") {
      this.advance();
      return { kind: "folder", path: tok.value.replace(/[\\/]+$/, "") };
    }
    if (tok.type === "punct" && tok.value === "#") {
      this.advance();
      return { kind: "tag", tag: this.expectIdent("# 后应为标签名").value };
    }
    throw this.err(tok, '数据源应为 "文件夹路径" 或 #标签');
  }

  /* ---------- SORT ---------- */

  private parseSortClause(): SortClause {
    // SORT [BY] 排序键, ...（每个键可带 [ASC|DESC] 与 BY (优先级)）[各 modifier 至多一次]
    this.matchKw("BY"); // 首个 BY 可选（SORT **BY** 状态 ...）

    const keys: SortKey[] = [];
    do {
      const expr = this.parseExpr();
      let dir: SortKey["dir"] = null;
      let priority: FieldValue[] | null = null;
      // 方向与 BY 优先级的书写顺序不限定
      for (;;) {
        const t = this.peek();
        if (t.type === "marked" && (t.value === "DESC" || t.value === "ASC")) {
          if (dir !== null) {
            throw this.err(t, "方向修饰符重复（每个排序键至多一个 **ASC**/**DESC**）");
          }
          this.advance();
          dir = t.value === "DESC" ? "desc" : "asc";
          continue;
        }
        if (priority === null && this.matchKw("BY")) {
          this.expectPunct("(");
          priority = [];
          if (!this.matchPunct(")")) {
            do {
              priority.push(this.parseLiteral("**BY** 列表中应为字面量（'字符串'/数字/true/false）"));
            } while (this.matchPunct(","));
            this.expectPunct(")");
          }
          continue;
        }
        break;
      }
      keys.push({ expr, dir, priority });
    } while (this.matchPunct(","));

    return { keys };
  }

  /* ---------- 表达式（优先级从低到高） ---------- */

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.matchKw("OR")) {
      left = { kind: "binary", op: "or", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.matchKw("AND")) {
      left = { kind: "binary", op: "and", left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.matchKw("NOT")) {
      return { kind: "unary", op: "not", expr: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const first = this.parseConcat();
    // [ext] 并置简写（规范 §3 定稿示例）：[txt] status %==% 'x' ≡ [txt] **AND** status %==% 'x'；
    // 右侧经 parseNot() 解析（与显式 **AND** 的 parseAnd→parseNot 同构，**NOT** 亦可用），
    // 隐式 AND 与显式 **AND** 同优先级
    if (first.kind === "extFilter" && this.startsPrimary()) {
      let left: Expr = first;
      while (left.kind === "extFilter" && this.startsPrimary()) {
        left = { kind: "binary", op: "and", left, right: this.parseNot() };
      }
      return left;
    }
    const left = first;
    const tok = this.peek();
    if (tok.type === "op" && ["==", "!=", ">", "<", ">=", "<="].includes(tok.value)) {
      this.advance();
      return { kind: "binary", op: tok.value as BinOp, left, right: this.parseConcat() };
    }
    return left; // 裸操作数：真值判断（如 **contains**(...)、布尔字段）
  }

  /** 当前 token 是否能开启一个 primary（并置简写的右端判定；**NOT** 开头的表达式也算） */
  private startsPrimary(): boolean {
    const tok = this.peek();
    if (tok.type === "extfilter" || tok.type === "ident" || tok.type === "string" ||
        tok.type === "path" || tok.type === "number") {
      return true;
    }
    if (tok.type === "marked" && (FUNCTIONS.has(tok.value) || tok.value === "NOT")) return true;
    return tok.type === "punct" && tok.value === "(";
  }

  private parseConcat(): Expr {
    let left = this.parseAdd();
    while (this.matchOp("||")) {
      left = { kind: "binary", op: "||", left, right: this.parseAdd() };
    }
    return left;
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    for (;;) {
      if (this.matchOp("+")) left = { kind: "binary", op: "+", left, right: this.parseMul() };
      else if (this.matchOp("-")) left = { kind: "binary", op: "-", left, right: this.parseMul() };
      else return left;
    }
  }

  private parseMul(): Expr {
    let left = this.parsePow();
    for (;;) {
      if (this.matchOp("*")) left = { kind: "binary", op: "*", left, right: this.parsePow() };
      else if (this.matchOp("/")) left = { kind: "binary", op: "/", left, right: this.parsePow() };
      else if (this.matchOp("%")) left = { kind: "binary", op: "%", left, right: this.parsePow() };
      else return left;
    }
  }

  /** 乘方：右结合 */
  private parsePow(): Expr {
    const base = this.parseUnary();
    if (this.matchOp("^")) {
      return { kind: "binary", op: "^", left: base, right: this.parsePow() };
    }
    return base;
  }

  private parseUnary(): Expr {
    if (this.matchOp("+")) return this.parseUnary();
    if (this.matchOp("-")) {
      return { kind: "unary", op: "-", expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const tok = this.peek();

    if (tok.type === "extfilter") {
      if (!this.inWhere) {
        throw this.err(tok, "[ext] 后缀过滤仅可在 **WHERE** 表达式中使用");
      }
      this.advance();
      return { kind: "extFilter", exts: parseExts(tok.value) };
    }
    if (tok.type === "string" || tok.type === "path") {
      this.advance();
      return { kind: "lit", value: tok.value };
    }
    if (tok.type === "variable") {
      if (!this.inSelect) {
        throw this.err(tok, `变量 $${tok.value}$ 仅可在 **SELECT** 中引用（WHERE / **SORT** 无法看到每行派生变量）`);
      }
      this.advance();
      this.variableTokens.set(tok.value, tok);
      return { kind: "variable", name: tok.value };
    }
    if (tok.type === "number") {
      this.advance();
      const num = parseFloat(tok.value);
      return { kind: "lit", value: Number.isNaN(num) ? null : num };
    }
    if (tok.type === "ident") {
      const lower = tok.value.toLowerCase();
      if (lower === "true" || lower === "false" || lower === "null") {
        this.advance();
        return { kind: "lit", value: lower === "true" ? true : lower === "false" ? false : null };
      }
      this.advance();
      return { kind: "field", path: tok.value };
    }
    if (tok.type === "marked" && FUNCTIONS.has(tok.value)) {
      this.advance();
      this.expectPunct("(");
      const args: Expr[] = [];
      if (!this.matchPunct(")")) {
        do {
          args.push(this.parseExpr());
        } while (this.matchPunct(","));
        this.expectPunct(")");
      }
      return { kind: "call", name: tok.value, args };
    }
    if (tok.type === "punct" && tok.value === "(") {
      this.advance();
      const inner = this.parseExpr();
      this.expectPunct(")");
      return inner;
    }
    throw this.err(tok, `应为表达式（字面量/字段/**函数**/括号），实际为 ${describe(tok)}`);
  }

  /* ---------- 词法辅助 ---------- */

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private isMarked(word: string): boolean {
    const tok = this.peek();
    return tok.type === "marked" && tok.value === word;
  }

  private matchKw(word: string): boolean {
    if (this.isMarked(word)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private matchOp(op: string): boolean {
    const tok = this.peek();
    if (tok.type === "op" && tok.value === op) {
      this.pos++;
      return true;
    }
    return false;
  }

  private matchPunct(value: string): boolean {
    const tok = this.peek();
    if (tok.type === "punct" && tok.value === value) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expectKw(word: string): void {
    if (!this.matchKw(word)) {
      const tok = this.peek();
      throw this.err(tok, `预期 **${word}**，实际为 ${describe(tok)}`);
    }
  }

  private expectPunct(value: string): void {
    if (!this.matchPunct(value)) {
      const tok = this.peek();
      throw this.err(tok, `预期 ${value}，实际为 ${describe(tok)}`);
    }
  }

  private expectIdent(what: string): Token {
    const tok = this.peek();
    if (tok.type !== "ident") {
      throw this.err(tok, `${what}，实际为 ${describe(tok)}`);
    }
    return this.advance();
  }

  private parseLiteral(what: string): FieldValue {
    const tok = this.peek();
    if (tok.type === "string" || tok.type === "path") {
      this.advance();
      return tok.value;
    }
    if (tok.type === "number") {
      this.advance();
      const num = parseFloat(tok.value);
      return Number.isNaN(num) ? null : num;
    }
    if (tok.type === "ident") {
      const lower = tok.value.toLowerCase();
      if (lower === "true") { this.advance(); return true; }
      if (lower === "false") { this.advance(); return false; }
    }
    throw this.err(tok, what);
  }

  private err(tok: Token, message: string): QueryParseError {
    return new QueryParseError(message, tok.line, tok.col);
  }
}

function describe(tok: Token): string {
  if (tok.type === "eof") return "文件结束";
  if (tok.type === "marked") return `**${tok.value}**`;
  if (tok.type === "op") return `%${tok.value}%`;
  if (tok.type === "extfilter") return `[${tok.value.trim()}]`;
  return `「${tok.value}」`;
}
