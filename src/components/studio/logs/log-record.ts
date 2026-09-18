/**
 * log-record — 把「一条日志记录」从物理行里还原出来（纯逻辑，无 React/DOM）。
 *
 * ── 为什么需要它 ─────────────────────────────────────────────────────
 * 日志文件是**行式**的：一行一条记录，解析层因此按 `\n` 切分。但记录的正文
 * 本身可以是多行的——最典型的是**结构化 payload 被打印成多行 JSON**：
 *
 * ```
 * 形如 [YYYY-MM-DD HH:mm:ss.mmm] [ERROR] [server] 的文本行
 * {
 *   "path": [
 *     "inputs",
 *     1
 *   ],
 *   "message": "…"
 * } 后接 {"ns":"server","level":"error"} 这样的 JSON 尾缀
 * ```
 *
 * 按 `\n` 切分后，`{` / `"path": [` / `"inputs",` … 每一行都成了**独立的一条
 * 日志**，且都读不到时刻与级别，只能落进「裸文本」兜底（级别一律显示 info）。
 * 用户读到的就是「一个 json 被拆成十几条、每条都是 INFO」（ISSUE #609）。
 *
 * ── 判据：括号深度，不是「看起来像 JSON」 ──────────────────────────────
 * 合并规则只认**结构**：记录正文里未闭合的 `{` / `[` 才让后续物理行继续并入
 * 同一条记录。这样：
 *   - 多行 JSON / 多行数组被人读成一条（用户诉求）；
 *   - 真正独立的两条裸文本行（横幅、`npm notice …`）**不会**被误合并——
 *     它们的上一条记录括号是闭合的；
 *   - 深度靠扫描字符得出，`"a{b"` 这类引号内的括号不计入（实现见
 *     {@link bracketDepthDelta}），所以一行正文里出现 `{` 字样也不会误判。
 *
 * 尾部兜底：窗口从文件中间开始读时（尾窗/字节游标），首行可能落在记录中间，
 * 于是「开头那几行碎片」前面的 `{` 已经在窗口之外。此时只要**上一条记录本身
 * 就是 JSON payload 记录**，且当前行也是 JSON 片段形状，就仍然并入——否则
 * 用户看到的是一开头就是几条散落的 `"mask",`。
 *
 * @module logs/log-record — log-record — 把「一条日志记录」从物理行里还原出来（纯逻辑，无 React/DOM）
 */

/**
 * 一行里的括号净增量（`{`/`[` 记 +1，`}`/`]` 记 −1）。
 *
 * **必须跳过字符串字面量内的括号**：日志正文里出现 `"path": "a[b"` 时把它算成
 * 一个未闭合的 `[`，会让后面所有无关的行都被吸进这条记录。扫描器只处理两种
 * 引号状态（普通串 / 转义符），不做 JSON 语法校验——它只需要「深度」这一个量。
 *
 * **引号状态按行重置**（不跨物理行延续）：日志正文里的引号经常就是不成对的
 * （`expected one of "prompt"|"negative"` 是配对的反例，而截断的消息只剩一个
 * 开引号），把它带进下一行会让整段 JSON 的括号一个都数不到。JSON 本身也不允许
 * 字符串跨裸换行，所以按行重置既安全又符合语法。
 */
export function bracketDepthDelta(line: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
  }
  return depth;
}

/**
 * 该行是否**看起来是 JSON 片段**（用于窗口截断后的续接兜底）。
 *
 * 只认四种开头：引号、`}`/`]`、`{`/`[`、以及缩进后的这些形状。刻意**不**认
 * 普通中文/英文句子——`npm notice …`、`----- 应用服务输出 -----` 这类独立行
 * 不该被吸进上一条记录。
 */
const JSON_FRAGMENT_RE = /^\s*(?:["\]}{[]|"[^"]*"\s*:)/;

export function looksLikeJsonFragment(line: string): boolean {
  return JSON_FRAGMENT_RE.test(line);
}

/** 一条「记录」= 起始物理行 + 后续并入的物理行。 */
export interface RawRecord {
  /** 记录起始行（解析层用它认时刻 / 级别）。 */
  head: string;
  /** 记录全文（head + 续行，行之间保留 `\n`）。 */
  text: string;
  /** 续行（无续行时为空串）。解析层把它拼回正文尾巴。 */
  rest: string;
}

/**
 * 剥掉行内残留的 ANSI SGR。
 *
 * 必须在**切记录之前**做：颜色码残缺时（`\x1b` 丢失、只剩 `[90m` / `[0m`）它们
 * 会留在正文里，按 SGR 形状整段剥掉才不会在面板上显示成 `[[OK]【[90m[OK[0m] …`；
 * 若只在记录头上剥，续行上的颜色码会被当成 JSON 正文，拼回去时把结构搅乱。
 */
export function stripSgr(text: string): string {
  return text.replace(/\x1b\[[0-9;:]*m/g, "").replace(/\[[0-9;:]*m/g, "");
}

/**
 * 物理行 → 记录序列。
 *
 * `isRecordStart` 由调用方注入（解析层知道哪三种形态算「带时刻的记录头」）：
 * 只要一行是记录头，它就**无条件**开启新记录——包括括号仍开着的时候。这条
 * 保证了「上一条记录括号没闭合」绝不会吞掉下一条真正的日志。
 */
export function splitLogRecords(
  text: string,
  isRecordStart: (line: string) => boolean,
): RawRecord[] {
  const records: RawRecord[] = [];
  let head = "";
  let lines: string[] = [];
  let depth = 0;
  let jsonish = false;

  /* 记录头是不是「带时刻的日志行」：它决定了裸 JSON 片段（窗口从记录中间
   * 开始时那些行）能否被后续缩进行续接——带时刻的头自带完整语义，不该把
   * 紧跟在它后面的任意缩进行都吸进来。 */
  let headIsLogLine = false;

  const flush = () => {
    if (head === "") return;
    const text = lines.join("\n");
    records.push({
      head,
      text,
      rest: lines.length > 1 ? text.slice(head.length + 1) : "",
    });
    head = "";
    lines = [];
    depth = 0;
    jsonish = false;
    headIsLogLine = false;
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (isRecordStart(line)) {
      flush();
      head = line;
      lines = [line];
      depth = bracketDepthDelta(line);
      jsonish = false;
      headIsLogLine = true;
      continue;
    }
    /* 续接判据：仅当**已有一条记录**、且它还没结束。
     *   depth > 0        —— 多行 JSON / 数组的正常形态（开盘括号在本条记录里）；
     *   PAYLOAD_START_RE —— 正文**另起一行**才开始打印结构化 payload（真实报错
     *                       现场就是「消息一行、`{` 顶格写在下一行」）；
     *   jsonish          —— 尾窗从记录中间开始、开盘括号不在窗口内；只接 JSON
     *                       片段形状或明显缩进的行，好让独立裸文本行仍各算一条。 */
    const continues =
      head !== "" &&
      (depth > 0 ||
        (headIsLogLine && PAYLOAD_START_RE.test(line)) ||
        (!headIsLogLine &&
          jsonish &&
          (looksLikeJsonFragment(line) || INDENTED_RE.test(line))));
    if (continues) {
      lines.push(line);
      depth += bracketDepthDelta(line);
      jsonish = jsonish || depth > 0;
      continue;
    }
    flush();
    /* 裸文本行也可以是一条记录的**头**：它可能是窗口截断后残留的 JSON
     * 片段，后续片段要能并进来（见上面的 `jsonish` 判据）。 */
    head = line;
    lines = [line];
    depth = bracketDepthDelta(line);
    headIsLogLine = false;
    jsonish = looksLikeJsonFragment(line);
  }
  flush();
  return records;
}

/** 明显缩进的行（`"inputs",` 这类数组元素在 pretty-print 里至少缩两格）。 */
const INDENTED_RE = /^\s{2,}/;

/**
 * 「正文另起一行才开始打印 payload」的形态：整行只有一个 `{` 或 `[`。
 *
 * 单独成行的裸 `{` / `[` 不可能是独立的一条日志行，因此这个判据不会误吞内容；
 * 反过来它正是「消息一行、JSON 从下一行顶格开始」这一真实形态的入口。
 */
const PAYLOAD_START_RE = /^\s*[{[]\s*$/;
