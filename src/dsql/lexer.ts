/**
 * @module dsql/lexer
 * @description DSQL v2.0 分词器：**WORD** / %运算符% / 字符串 / 路径 / 裸标识符 / $变量$
 *
 * 标记体系（按字面实现）：
 * - 关键词/内置函数：**WORD** 包裹（关键词约定全大写，函数约定小写）
 * - 运算符：%op% 包裹（%==% %!=% %>=% %<=% %>% %<% %||% %+% %-% %*% %/% %%% %^%）
 * - 路径："..."（双引号）；字符串：'...'（单引号）
 * - 裸标识符：字段名（支持 Unicode 与带点路径 file.name / this.状态）
 * - 裸字面量：true / false / null
 *
 * v2.0 视图关键词：TABLE_VIEW / LIST_VIEW / CARD_VIEW
 * （旧 TABLE / LIST 已废除，词法器不再收录，落到"未知关键词"分支抛 LexError）
 */

export type TokenType =
  | "marked"   // **WORD**（关键词或函数名）
  | "variable" // $变量$（DSQL 1.4 派生变量引用，value 为裸名）
  | "ident"    // 字段名（可含点）
  | "string"   // '字符串'
  | "path"     // "路径"
  | "number"
  | "op"       // %op%
  | "punct"    // ( ) , # *
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

/** 词法错误：携带出错位置的行号与列号。 */
export class LexError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
  ) {
    super(message);
  }
}

/** 子句关键词全集（词法层校验 **WORD** 用） */
export const KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "SORT", "BY", "AND", "OR", "NOT", "AS",
  "LIMIT", "ASC", "DESC", "TABLE_VIEW", "LIST_VIEW", "CARD_VIEW", "WITHOUT", "ID",
]);

/** DSQL 1.4：聚合关键词（仅 SELECT 项合法，parser 单独拦截，不入 KEYWORDS 以免其他子句误吞） */
export const AGG_KEYWORDS = new Set(["TOTAL"]);

/** 内置函数名表（词法层校验用，函数名约定小写） */
export const FUNCTIONS = new Set([
  "sqrt", "cbrt", "root", "contains", "length", "lower", "upper", "empty",
]);

/** 运算符表（按长度降序匹配，%%%（取模）与单字符运算符共存） */
const OPS = [
  "%==%", "%!=%", "%>=%", "%<=%", "%||%",
  "%+%", "%-%", "%*%", "%/%", "%%%", "%^%", "%>%", "%<%",
].sort((a, b) => b.length - a.length);

const IDENT_START = /[\p{L}_$]/u;
const IDENT_PART = /[\p{L}\p{N}_$]/u;
const DIGIT = /[0-9]/;

/**
 * 分词器：将 DSQL 源文本切分为 token 序列，维护行列号（1 起）。
 * 遇无法识别的 token 抛 LexError。
 */
export class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(private src: string) {}

  /**
   * 分词至文件结束。
   *
   * @returns token 序列（以 eof 结尾）
   */
  tokenize(): Token[] {
    const tokens: Token[] = [];
    for (;;) {
      const tok = this.next();
      tokens.push(tok);
      if (tok.type === "eof") return tokens;
    }
  }

  private next(): Token {
    this.skipWsAndComments();
    const { line, col } = this;
    if (this.pos >= this.src.length) return { type: "eof", value: "", line, col };

    const ch = this.src[this.pos];

    if (ch === "'") return this.readString("'", line, col);
    if (ch === '"') return this.readString('"', line, col);
    if (ch === "%") return this.readOp(line, col);
    if (ch === "*") return this.readStar(line, col);
    if (DIGIT.test(ch)) return this.readNumber(line, col);
    if (ch === "$") {
      const variable = this.tryReadVariable(line, col);
      if (variable) return variable;
    }
    if (IDENT_START.test(ch)) return this.readIdent(line, col);
    return this.readPunct(line, col);
  }

  private skipWsAndComments(): void {
    for (;;) {
      const ch = this.src[this.pos];
      if (ch === "\n") {
        this.pos++;
        this.line++;
        this.col = 1;
      } else if (ch === " " || ch === "\t" || ch === "\r") {
        this.pos++;
        this.col++;
      } else if (ch === "-" && this.src[this.pos + 1] === "-") {
        while (this.pos < this.src.length && this.src[this.pos] !== "\n") {
          this.pos++;
          this.col++;
        }
      } else {
        return;
      }
    }
  }

  /** '字符串' 与 "路径"：支持 \' \" \\ 转义，不可跨行 */
  private readString(quote: string, line: number, col: number): Token {
    this.pos++;
    this.col++;
    let value = "";
    for (;;) {
      if (this.pos >= this.src.length) throw new LexError("字符串未闭合", line, col);
      const ch = this.src[this.pos];
      if (ch === "\\") {
        const nxt = this.src[this.pos + 1];
        if (nxt === quote || nxt === "\\") {
          value += nxt;
          this.pos += 2;
          this.col += 2;
          continue;
        }
      }
      if (ch === quote) {
        this.pos++;
        this.col++;
        return {
          type: quote === "'" ? "string" : "path",
          value,
          line,
          col,
        };
      }
      if (ch === "\n") throw new LexError("字符串不能跨行", line, col);
      value += ch;
      this.pos++;
      this.col++;
    }
  }

  private readOp(line: number, col: number): Token {
    const rest = this.src.slice(this.pos);
    for (const op of OPS) {
      if (rest.startsWith(op)) {
        this.pos += op.length;
        this.col += op.length;
        return { type: "op", value: op.slice(1, -1), line, col }; // 去掉两侧 % → "=="
      }
    }
    throw new LexError("无法识别的运算符（运算符需 % 包裹，如 %==% %+%）", line, col);
  }

  /** **WORD**（关键词/函数）或裸 *（SELECT 的全部字段） */
  private readStar(line: number, col: number): Token {
    if (this.src[this.pos + 1] !== "*") {
      this.pos++;
      this.col++;
      return { type: "punct", value: "*", line, col };
    }
    this.pos += 2;
    this.col += 2;
    let word = "";
    for (;;) {
      if (this.pos >= this.src.length) throw new LexError("** 标记未闭合", line, col);
      const ch = this.src[this.pos];
      if (ch === "*" && this.src[this.pos + 1] === "*") {
        this.pos += 2;
        this.col += 2;
        break;
      }
      if (ch === "\n") throw new LexError("** 标记不能跨行", line, col);
      word += ch;
      this.pos++;
      this.col++;
    }
    const upper = word.toUpperCase();
    const lower = word.toLowerCase();
    if (AGG_KEYWORDS.has(upper)) {
      return { type: "marked", value: upper, line, col };
    }
    if (KEYWORDS.has(upper)) {
      return { type: "marked", value: upper, line, col };
    }
    if (FUNCTIONS.has(lower)) {
      return { type: "marked", value: lower, line, col };
    }
    throw new LexError(
      `未知关键词 **${word}**（关键词全大写，函数名小写：sqrt/cbrt/root/contains/length/lower/upper/empty）`,
      line,
      col,
    );
  }

  private readNumber(line: number, col: number): Token {
    let value = "";
    while (this.pos < this.src.length && /[0-9.]/.test(this.src[this.pos])) {
      value += this.src[this.pos];
      this.pos++;
      this.col++;
    }
    // DSQL 1.5：小数点后必须至少一位数字（"1." / "1.2.3" 均为词法错误）
    if (!/^\d+(\.\d+)?$/.test(value)) {
      throw new LexError(`非法数字「${value}」（小数点后必须至少一位数字："1." 是词法错误）`, line, col);
    }
    return { type: "number", value, line, col };
  }

  /** 字段名（支持 Unicode；带点路径合并为单 token：file.name / this.状态） */
  private readIdent(line: number, col: number): Token {
    let value = "";
    for (;;) {
      while (this.pos < this.src.length && IDENT_PART.test(this.src[this.pos])) {
        value += this.src[this.pos];
        this.pos++;
        this.col++;
      }
      if (this.src[this.pos] === "." && IDENT_START.test(this.src[this.pos + 1] ?? "")) {
        value += ".";
        this.pos++;
        this.col++;
        continue;
      }
      break;
    }
    return { type: "ident", value, line, col };
  }

  /** $变量$（DSQL 1.4）：读到闭合 $ 产出 variable token（裸名）；否则返回 null 回退 ident */
  private tryReadVariable(line: number, col: number): Token | null {
    const start = this.pos + 1;
    let i = start;
    while (i < this.src.length && this.src[i] !== "$" && this.src[i] !== "\n") {
      i++;
    }
    if (i >= start && this.src[i] === "$") {
      const name = this.src.slice(start, i);
      this.pos = i + 1;
      this.col += i + 1 - start + 1;
      return { type: "variable", value: name, line, col };
    }
    return null;
  }

  private readPunct(line: number, col: number): Token {
    const ch = this.src[this.pos];
    if (ch === ".") {
      // DSQL 1.5：NUMBER 小数点后必须至少一位数字，.5 为词法错误
      throw new LexError("数字不能以小数点开头（\".5\" 是词法错误）", line, col);
    }
    if ("(),.#".includes(ch)) {
      this.pos++;
      this.col++;
      return { type: "punct", value: ch, line, col };
    }
    throw new LexError(
      `无法识别的字符「${ch}」（关键词需 ** 包裹、运算符需 % 包裹）`,
      line,
      col,
    );
  }
}
