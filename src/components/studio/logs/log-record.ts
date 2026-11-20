/**
 * log-record — 把「一条日志记录」从物理行里还原出来（纯逻辑，无 React/DOM）。日志文件是行式的，但记录
 * 正文可以是多行（典型是 pretty-print 的 JSON payload）；按 `\n` 切分后每行成了独立一条、读不到时刻与
 * 级别（ISSUE #609）。判据只认**结构**：正文里未闭合的 `{` / `[` 才让后续行并入，独立裸文本行不会被误并；
 * 深度靠扫描字符、引号内括号不计入（见 {@link bracketDepthDelta}）；窗口从文件中间开始时另有续接兜底。 */

import { stripPartialSgr } from "~/lib/log/log-ansi";

/**
 * 一行里的括号净增量（`{`/`[` 记 +1，`}`/`]` 记 −1）。**必须跳过字符串字面量内的括号**：把 `"path": "a[b"` 里的 `[` 算成未闭合，会让后面所有无关行被吸进这条记录；扫描器只处理两种引号状态（普通串 / 转义符），不做 JSON 语法校验。
 * **引号状态按行重置**：日志正文里的引号经常不成对，带进下一行会让整段 JSON 的括号一个都数不到；JSON 本身也不允许字符串跨裸换行，按行重置既安全又符合语法。
 * **ANSI 转义序列不计括号**（ISSUE #4567：壳日志要带着原始颜色进面板，切分前不再剥 SGR）：`\x1b[31m` 里的 `[` 会被算成深度 +1，把后续行误并进上一条记录——扫描进转义序列后跳到终止字节（SGR 的 `m` / 其他 CSI 的终止字母 / BEL）再恢复计数。
 */
export function bracketDepthDelta(line: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inAnsi = false;
  for (const ch of line) {
    if (inAnsi) {
      /* CSI 序列以字母（SGR 的 `m` 等）终止；OSC 以 BEL 或 `\x1b\\` 终止——
       * BEL 是单字符、`\x1b` 会重新进入本分支，两个终止形态都覆盖。 */
      if (/[A-Za-z]/.test(ch) || ch === "\u0007") {
        inAnsi = false;
      }
      continue;
    }
    if (ch === "\u001b") {
      inAnsi = true;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
    }
  }
  return depth;
}

/**
 * 切分前只剥**残缺颜色码**（转义符丢失后剩下的 `[90m` / `[0m`），完整 SGR 保留给渲染层上色
 * （ISSUE #4567：壳日志的原始颜色此前被整体剥掉、面板全灰）。残缺码必须剥——它们会以
 * `[90m` 的形状混进正文被原样显示，且搅乱后续的 JSON 片段判据。
 */
export const stripSgr = (text: string) => stripPartialSgr(text);

/**
 * 该行是否**看起来是 JSON 片段**（窗口截断后的续接兜底）：只认引号、`}`/`]`、`{`/`[` 及缩进后的这些
 * 形状。刻意**不**认普通中英文句子——`npm notice …`、`----- 应用服务输出 -----` 这类独立行不该被吸进上一条记录。
 */
const JSON_FRAGMENT_RE = /^\s*(?:["\]}{[]|"[^"]*"\s*:)/;

export function looksLikeJsonFragment(line: string): boolean {
  return JSON_FRAGMENT_RE.test(line);
}

/** 一条「记录」= 起始物理行 + 后续并入的物理行。 */
export type RawRecord = {
  /** 记录起始行（解析层用它认时刻 / 级别）。 */
  head: string;
  /** 续行（无续行时为空串）。解析层把它拼回正文尾巴。 */
  rest: string;
  /** 记录全文（head + 续行，行之间保留 `\n`）。 */
  text: string;
};

/** 明显缩进的行（`"inputs",` 这类数组元素在 pretty-print 里至少缩两格）。 */
const INDENTED_RE = /^\s{2,}/;

/**
 * 「正文另起一行才开始打印 payload」的形态：整行只有一个 `{` 或 `[`。单独成行的裸 `{` / `[` 不可能是
 * 独立的一条日志行，因此这个判据不会误吞内容；反过来它正是「消息一行、JSON 从下一行顶格开始」的入口。
 */
const PAYLOAD_START_RE = /^\s*[{[]\s*$/;

/**
 * 物理行 → 记录序列。`isRecordStart` 由调用方注入（解析层知道哪三种形态算「带时刻的记录头」）：
 * 只要一行是记录头，它就**无条件**开启新记录——包括括号仍开着的时候，保证「上一条没闭合」不会吞掉下一条日志。
 */
export function splitLogRecords(
  text: string,
  isRecordStart: (line: string) => boolean,
): Array<RawRecord> {
  const records: Array<RawRecord> = [];
  let head = "";
  let lines: Array<string> = [];
  let depth = 0;
  let jsonish = false;

  /* 记录头是不是「带时刻的日志行」：它决定了裸 JSON 片段（窗口从记录中间
   * 开始时那些行）能否被后续缩进行续接——带时刻的头自带完整语义，不该把
   * 紧跟在它后面的任意缩进行都吸进来。 */
  let headIsLogLine = false;

  const flush = () => {
    if (head === "") {
      return;
    }
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
    /* 续接判据：仅当**已有一条记录**、且它还没结束。depth > 0 是多行 JSON / 数组的正常形态；
     * PAYLOAD_START_RE 是正文另起一行才打印 payload（真实报错就是「消息一行、`{` 顶格下一行」）；
     * jsonish 是尾窗从记录中间开始、开盘括号不在窗口内——只接 JSON 片段或明显缩进的行。 */
    const continues =
      head !== "" &&
      (depth > 0 ||
        (headIsLogLine && PAYLOAD_START_RE.test(line)) ||
        (!headIsLogLine && jsonish && (looksLikeJsonFragment(line) || INDENTED_RE.test(line))));
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
