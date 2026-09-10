/**
 * @module dsql/parser
 * @description DSQL v2.0 解析器（递归下降）：子句前件校验、SELECT 列表与表达式优先级
 *
 * 子句按前件关系解析：各子句至多出现一次，书写顺序不限；
 * WHERE / SORT / LIMIT 以 **FROM** 为前件（必须在其之后），SELECT 可省略（默认全部字段）。
 * 表达式优先级：OR < AND < NOT < 比较 < 连接 < 加减 < 乘除取模 < 乘方（右结合）< 一元。
 *
 * v2.0 view 产生式：（**TABLE_VIEW** | **LIST_VIEW** | **CARD_VIEW**）?（缺省 TABLE_VIEW）
 * 旧 **TABLE** / **LIST** 已被词法器废除，落到"未知关键词"分支抛 LexError。
 */

import type { BinOp, ColumnSel, Expr, Query, SortClause, SortKey, Source } from "./ast";
import { FUNCTIONS, Lexer, type Token } from "./lexer";
import type { FieldValue, ViewType } from "./types";

/** 查询解析错误：message 已格式化为「[DSQL] 第 x 行第 y 列：原因」。 */
export class QueryParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
  ) {
    super(`[DSQL] 第 ${line} 行第 ${col} 列：${message}`);
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
  private variableTokens = new Map<string, Token>();
  /** DSQL 1.5：AS 别名 → 首次定义的 token（重复定义校验用） */
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
      } else if (this.isMarked("WHERE")) {
        this.expectOnce(seen, "WHERE");
        this.requirePrerequisite(seen, "WHERE", "FROM");
        this.advance();
        where = this.parseExpr();
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

    const trailing = this.peek();
    if (trailing.type !== "eof") {
      throw this.err(trailing, `多余的查询子句「${describe(trailing)}」（子句：SELECT / FROM / WHERE / SORT / LIMIT / WITHOUT ID，每条至多一次）`);
    }

    return { view, withoutId: seen.has("WITHOUT ID"), select, from, where, sort, limit };
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
        const expr = this.parseExpr();
        let alias: string | null = null;
        if (this.matchKw("AS")) alias = this.parseAlias();
        items.push({ expr, alias });
      } while (this.matchPunct(","));
    } finally {
      this.inSelect = false;
    }
    this.validateVariables(items);
    return items;
  }

  /** **TOTAL** 聚合项：操作数限字段/数字，**AS** 别名强制（DSQL 1.4） */
  private parseTotalItem(): ColumnSel {
    const start = this.advance(); // TOTAL
    this.totalToken = start;
    const tok = this.peek();
    let expr: Expr;
    if (tok.type === "variable") {
      throw this.err(tok, `**TOTAL** 不支持引用变量（$${tok.value}$ 看不到当前行）`);
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
      throw this.err(start, "**TOTAL** 必须带 **AS** 别名（如 **TOTAL** 成绩 **AS** $总成绩$）");
    }
    return { expr, alias: this.parseAlias(), total: true };
  }

  /** AS 别名：接受裸标识符或 $变量$ 写法，统一归一化为裸名；SELECT 内别名互不相同（DSQL 1.5） */
  private parseAlias(): string {
    const tok = this.peek();
    let name: string;
    if (tok.type === "variable") {
      this.advance();
      name = tok.value;
    } else {
      name = this.expectIdent("**AS** 后应为别名（标识符或 $变量$）").value;
    }
    if (this.aliasTokens.has(name)) {
      throw this.err(tok, `别名 '$${name}$' 重复定义（SELECT 内 **AS** 别名互不相同）`);
    }
    this.aliasTokens.set(name, tok);
    return name;
  }

  /** 静态校验：$变量$ 引用必须匹配更早定义的别名；TOTAL 操作数内禁止引用变量 */
  private validateVariables(items: ColumnSel[]): void {
    const defined = new Set<string>();
    const check = (expr: Expr, inTotal: boolean): void => {
      switch (expr.kind) {
        case "variable":
          if (inTotal) {
            throw this.err(this.totalToken ?? this.tokens[0], `**TOTAL** 不支持引用变量（$${expr.name}$ 看不到当前行）`);
          }
          if (!defined.has(expr.name)) {
            throw this.err(
              this.variableTokens.get(expr.name) ?? this.tokens[0],
              `变量 $${expr.name}$ 未定义（引用前需在 **SELECT** 中以 **AS** 定义，且不能引用其后定义的变量）`,
            );
          }
          return;
        case "binary":
          check(expr.left, inTotal);
          check(expr.right, inTotal);
          return;
        case "unary":
          check(expr.expr, inTotal);
          return;
        case "call":
          for (const arg of expr.args) check(arg, inTotal);
          return;
        default:
          return;
      }
    };
    for (const item of items) {
      if (item.alias) defined.add(item.alias);
      check(item.expr, item.total === true);
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
    // SORT [BY] 排序键, ...（每个键可带 [ASC|DESC] 与 BY (优先级)）[ASC|DESC]
    this.matchKw("BY"); // 首个 BY 可选（SORT **BY** 状态 ...）

    const keys: SortKey[] = [];
    do {
      const expr = this.parseExpr();
      let dir: SortKey["dir"] = null;
      let priority: FieldValue[] | null = null;
      // 方向与 BY 优先级的书写顺序不限定
      for (;;) {
        if (dir === null && this.matchKw("DESC")) { dir = "desc"; continue; }
        if (dir === null && this.matchKw("ASC")) { dir = "asc"; continue; }
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

    let dir: SortClause["dir"] = null;
    if (this.matchKw("DESC")) dir = "desc";
    else if (this.matchKw("ASC")) dir = "asc";

    return { keys, dir };
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
    const left = this.parseConcat();
    const tok = this.peek();
    if (tok.type === "op" && ["==", "!=", ">", "<", ">=", "<="].includes(tok.value)) {
      this.advance();
      return { kind: "binary", op: tok.value as BinOp, left, right: this.parseConcat() };
    }
    return left; // 裸操作数：真值判断（如 **contains**(...)、布尔字段）
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
  return `「${tok.value}」`;
}
