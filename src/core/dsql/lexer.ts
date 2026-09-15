/**
 * @module dsql/lexer
 * @description DSQL 分词器：**WORD** / %运算符% / 字符串 / 路径 / [ext] / 裸标识符 / $变量$ / <域> / 块括号
 *
 * 标记体系（按字面实现）：
 * - 关键词/内置函数：**WORD** 包裹（关键词约定全大写，函数约定小写）
 * - 运算符：%op% 包裹（%==% %!=% %>=% %<=% %>% %<% %||% %+% %-% %*% %/% %%% %^%）
 * - 路径："..."（双引号）；字符串：'...'（单引号）
 * - [...] 方括号原子：[...] 原样收集（WHERE 内为 [ext] 后缀过滤、**WHILE** 后为迭代边界，parser 按子句赋予语义）
 * - <域> 域标记（DSQL 2.6）：与 **..** / %..% / '..' / ".." / $..$ / [..] 并列的独立名字空间
 * - :: 跨域引用连接符（<域>::字段，只允许一级）；{ } 块括号
 * - 裸标识符：字段名（支持 Unicode 与带点路径 file.name / this.状态）
 * - 裸字面量：true / false / null
 *
 * 视图关键词：TABLE_VIEW / LIST_VIEW / CARD_VIEW
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
  | "punct"    // ( ) , # * { } ::
  | "extfilter" // [ext] 后缀过滤（value 为括号内原样文本，不做归一化）
  | "domain"   // <域>（DSQL 2.6，value 为域名的裸名）
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
  "SEARCH",
  "WHILE",
  "COUNT",
  "YIELD",
  "IN",
  "DIFF",
]);

/** DSQL 1.4：聚合关键词（仅 SELECT 项合法，parser 单独拦截，不入 KEYWORDS 以免其他子句误吞） */
export const AGG_KEYWORDS = new Set(["TOTAL"]);

/** 内置函数名表：单一事实源在 functions.ts 的 FUNCTIONS 实现表（约定小写） */
import { FUNCTION_NAMES as FUNCTIONS } from "./functions";
export { FUNCTIONS };

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
   * 分词至文件结束，并对整条 token 序列做两项**词法层硬约束**校验
   * （不得下放给 parser，§7「硬约束由词法层拦截」）：
   * `::` 两侧形态（一级跨域引用）与块括号 `{ }` 配对。
   *
   * @returns token 序列（以 eof 结尾）
   */
  tokenize(): Token[] {
    const tokens: Token[] = [];
    for (;;) {
      const tok = this.next();
      tokens.push(tok);
      if (tok.type === "eof") return validateTokens(tokens);
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
    if (ch === "[") return this.readExtFilter(line, col);
    if (ch === "<") return this.readDomain(line, col);
    if (DIGIT.test(ch)) return this.readNumber(line, col);
    if (ch === "$") {
      const variable = this.tryReadVariable(line, col);
      if (variable) return variable;
      // `$` 开头但不成合法变量名（名字非法 / 未闭合）→ 显式报错，
      // 不回退 ident 路径（否则 `$a b$` 会被静默拆成两个怪字段名）
      throw new LexError("非法变量名（$ 与 $ 之间应为标识符，如 $总成绩$）", line, col);
    }
    if (IDENT_START.test(ch)) return this.readIdent(line, col);
    return this.readPunct(line, col);
  }

  /**
   * 跨过空白与 `--` 行注释。
   * 换行语义只认 `\n`：孤立 `\r`（老式 Mac 行尾）在此按**普通空白**处理（col++），
   * 与 readExtFilter 内部把 `\r` 当**换行**（line++）的口径不同——这是有意为之，
   * 非疏漏：[...] 内已无换行结构（原文折成空格），行号必须按换行计才能与括号外对齐；
   * 括号外则遵循「换行 = \n」的既有约定，CRLF 中 `\r` 仅占一列。
   */
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

  /**
   * '字符串' 与 "路径"：逐字符扫描，不可跨行。
   * 转义规则（DSQL 2.2）：遇 \ 读下一字符——\' → 内容加 '；其余情况 \ 与下一字符
   * 都原样入内容（\\ → 两个反斜杠，\d → \d）。未转义的 ' 终止字符串。
   */
  private readString(quote: string, line: number, col: number): Token {
    this.pos++;
    this.col++;
    let value = "";
    for (;;) {
      if (this.pos >= this.src.length) throw new LexError("字符串未闭合", line, col);
      const ch = this.src[this.pos];
      if (ch === "\\") {
        const nxt = this.src[this.pos + 1];
        if (nxt !== undefined && nxt !== "\n") {
          value += nxt === quote ? quote : "\\" + nxt;
          this.pos += 2;
          this.col += 2;
          continue;
        }
        // \ 后无字符或换行：\ 原样入内容，走正常流程（换行触发跨行错误 / EOF 触发未闭合）
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

  /**
   * `[` 到**首个** `]` 之间的内容原样收集（不做归一化），逗号切分与空段处理由 parser 完成。
   * 词法层不区分 `[ext]` 与 `**WHILE**` 的 `[起始, 结束]`，语义由 parser 按所在子句赋予。
   * 换行（LF / CRLF / CR）折为一个空格；未闭合（至 EOF 无 `]`）为词法错误。
   * 注意：此处把 `\r` 当换行（line++），与外层 skipWsAndComments 把孤立 `\r` 当普通空白
   * 的口径不同（见该处注释），同一字符两种语义是有意为之。
   */
  private readExtFilter(line: number, col: number): Token {
    this.pos++;
    this.col++;
    let value = "";
    for (;;) {
      if (this.pos >= this.src.length) {
        throw new LexError("[ 扩展名过滤未闭合（需以 ] 结束，如 [txt, mp4]）", line, col);
      }
      const ch = this.src[this.pos];
      if (ch === "]") {
        this.pos++;
        this.col++;
        break;
      }
      if (ch === "\n" || ch === "\r") {
        // CRLF / CR 视作单个换行：\r 后紧跟 \n 时一并跳过，避免行号双计
        if (ch === "\r" && this.src[this.pos + 1] === "\n") this.pos++;
        this.line++;
        this.col = 1;
        value += " ";
        this.pos++;
        continue;
      }
      value += ch;
      this.pos++;
      this.col++;
    }
    return { type: "extfilter", value, line, col };
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
      // VARIABLE = "$" ident "$"（§2）：名字须为合法 ident，否则回退 ident 路径自然报错
      if (!/^[\p{L}_$][\p{L}\p{N}_$.]*$/u.test(name)) return null;
      this.pos = i + 1;
      this.col += i + 1 - start + 1;
      return { type: "variable", value: name, line, col };
    }
    return null;
  }

  /**
   * `<域>` 域标记（DSQL 2.6）：与 `**..**` / `%..%` / `'..'` / `".."` / `$..$` / `[..]` 并列的独立名字空间。
   * 硬约束（词法层，不下放）：`<` 与 `>` 之间只允许一个 IDENT；未闭合或内容非单个标识符即词法错误。
   * 与 `**` 标记同口径，不接受跨行。
   */
  private readDomain(line: number, col: number): Token {
    this.pos++;
    this.col++;
    let name = "";
    for (;;) {
      if (this.pos >= this.src.length) {
        throw new LexError("域标记未闭合（需以 > 结束，如 <人物>）", line, col);
      }
      const ch = this.src[this.pos];
      if (ch === ">") {
        this.pos++;
        this.col++;
        break;
      }
      if (ch === "\n") throw new LexError("域标记不能跨行", line, col);
      name += ch;
      this.pos++;
      this.col++;
    }
    const IDENT_ONLY = /^[\p{L}_$][\p{L}\p{N}_$]*(\.[\p{L}_$][\p{L}\p{N}_$]*)*$/u;
    if (!IDENT_ONLY.test(name)) {
      throw new LexError(`域标记 <${name}> 内应为单个标识符（如 <人物>）`, line, col);
    }
    return { type: "domain", value: name, line, col };
  }

  private readPunct(line: number, col: number): Token {
    const ch = this.src[this.pos];
    if (ch === ".") {
      // DSQL 1.5：NUMBER 小数点后必须至少一位数字，.5 为词法错误
      throw new LexError("数字不能以小数点开头（\".5\" 是词法错误）", line, col);
    }
    if (ch === ":" && this.src[this.pos + 1] === ":") {
      this.pos += 2;
      this.col += 2;
      return { type: "punct", value: "::", line, col };
    }
    if ("(),.#{}".includes(ch)) {
      this.pos++;
      this.col++;
      return { type: "punct", value: ch, line, col };
    }
    throw new LexError(
      `无法识别的字符「${ch}」（关键词需 ** 包裹、运算符需 % 包裹、域需 <域> 包裹）`,
      line,
      col,
    );
  }
}

/**
 * 词法层硬约束校验（整条 token 序列，见 §7「硬约束由词法层拦截」）：
 * - `::` 左侧须为 `<域>`、右侧须为裸 IDENT —— `<域>::<域>` 与 `<域>::<域>::字段` 在此层拦截，
 *   保证跨域引用只允许一级；
 * - `{` / `}` 必须配对（未闭合 / 多余即词法错误）。
 *
 * @param tokens - 完整 token 序列（含结尾 eof）
 * @returns 原序列（校验通过）
 * @throws LexError 违反上述任一约束
 */
function validateTokens(tokens: Token[]): Token[] {
  let depth = 0;
  let open: Token | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === "punct" && tok.value === "::") {
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      if (!prev || prev.type !== "domain") {
        throw new LexError(":: 左侧须为域标记（如 <人物>::名字）", tok.line, tok.col);
      }
      if (!next || next.type === "domain") {
        const shown = next ? `<${next.value}>` : "行尾";
        throw new LexError(
          `:: 右侧须 IDENT，${shown} 非法（跨域引用只允许一级 <域>::字段）`,
          tok.line,
          tok.col,
        );
      }
      if (next.type !== "ident") {
        throw new LexError(`:: 右侧须 IDENT（如 <人物>::名字），实际为「${next.value}」`, tok.line, tok.col);
      }
    } else if (tok.type === "punct" && tok.value === "{") {
      if (depth === 0) open = tok;
      depth++;
    } else if (tok.type === "punct" && tok.value === "}") {
      depth--;
      if (depth < 0) throw new LexError("多余的 }（块括号 { } 不配对）", tok.line, tok.col);
    }
  }
  if (depth > 0) {
    const at = open ?? tokens[0];
    throw new LexError("块 { 未闭合（需与 } 配对）", at.line, at.col);
  }
  return tokens;
}
