/* ── 日志行里「可打开的本机路径」的识别（纯函数，跨端复用）──────────────
 *
 * 用户反馈（ISSUE #1365）：面板里那一列路径（项目根、编排脚本、启动状态文件、
 * 日志路径…）**只是紫字**，看得见却点不动 —— 要打开得自己把整串抄进资源管理器，
 * 而启动排障时正是最需要「点一下就到现场」的时候。
 *
 * 本模块只回答「这一串文本里哪几段长得像本机路径」，不碰 IO，也不决定点开之后
 * 做什么（那是 `~/lib/shell/reveal-path` 与它的端点）。分层的理由与
 * `log-session-scope.ts` 同源：识别要在**浏览器**里跑（决定怎么画这一行），
 * 打开要在**本机**做（spawn 文件管理器）—— 一份实现放错侧就是把 `node:*` 拖进
 * 浏览器图，报 `does not support external modules` 并让整页 500。
 *
 * ## 为什么按形状扫描，而不是「让写日志的人标出来」
 * 这些行由壳（Rust）、编排器（`.mjs`）、PowerShell 工具脚本三处写盘，且**跨进程**
 * —— 没有一条通道能让它们把「这段是路径」传进来。面板能拿到的只有最终文本，所以
 * 判据只能建立在文本形状上。反过来说，这也是本模块唯一说得清的边界：它会**漏**
 * （别的路径形态不认）也会**误判**（恰好长成路径的普通词），所以调用处必须把
 * 「打开失败」当成一等出口（硬规则 4），不许静默。
 *
 * ## 认哪几种形状
 *
 * | 形状                 | 例                                            | 判据要点                                  |
 * | -------------------- | --------------------------------------------- | ----------------------------------------- |
 * | Windows 盘符绝对路径 | `F:\AI\Other\comfy-app-t3\scripts\dev.mjs`    | `[A-Za-z]:\` 起，段间 `\` 或 `/`           |
 * | UNC 路径             | `\\server\share\dir`                          | `\\` 起                                    |
 * | POSIX 绝对路径       | `/workspace/log/launcher/shell-launch.log`    | `/` 起且**至少两段**（排除 `/ 0 / 3` 这类） |
 *
 * **刻意不认相对路径**（`log/launcher/dev-launcher.log`、`./src/x.ts`）：面板判不了
 * 它是相对**谁**的（项目根？编排器的 cwd？用户主目录？），猜错的代价是「点了打开到
 * 一个不是那里的文件夹」—— 比不可点更糟。日志里要打开的现场（启动报告、各来源的
 * 绝对路径、错误堆栈里的源码位置）本来就是绝对的。
 *
 * ## 尾巴怎么收（判据里最容易写错的一半）
 *
 * 路径在行里后面常跟着标点与说明，必须切干净：带着 `）` 或 `:` 去找文件永远 ENOENT。
 *   - **行尾标点**：`。`、`，`、`；`、`、`、全角括号引号、落单的 `)` / `]` / `}`；
 *   - **`(` 与 `)` 的不对称**：Windows 文件名真能带成对括号（`Program Files (x86)`），
 *     所以只丢**落单的右括号** —— 先各数一遍，多出来的才裁；
 *   - **尾随命令行开关**：`…\dev-launcher.mjs --mode prebuilt` 要把开关裁掉。
 *
 * ## 空格：只对 Windows 形态吃进来（实测撞出来的取舍）
 *
 * Windows 路径带空格极常见且**必须**吃（`C:\Program Files\PowerShell\7\pwsh.EXE`
 * 按空格切会切出 `C:\Program`，一段「看着像路径、点开什么都不是」的片段，
 * 比不可点更糟）。但若 POSIX 形态也吃空格，行里由空格分隔的并列路径与散文会被连成
 * 一段 —— 实测两条假阳性：`/a/b.log and /d/e.log` 变一条、`计数 1769 / 0 / 3`
 * 被认成路径 `/ 0 / 3`。POSIX 侧带空格的现场在这套日志里不存在（要打开的都是应用
 * 自己的目录），所以按「宁可漏」收窄：**只有盘符 / UNC 起点才允许空格在候选里**。
 *
 * ## 判据的最终形态是「磁盘上真有这个东西」
 * 文本切分只能做到「像」，定案在端点侧（`~/lib/shell/reveal-path` 按最长存在前缀
 * 解析），因为「`F:\…\dev-launcher.mjs` 到底存不存在」只有文件系统答得准。
 */

/** 命中一段路径时回的区间（半开区间 `[start, end)`，便于 `slice` 与拼装片段）。 */
export interface LogPathToken {
  /** 在原文里的起点（含）。 */
  start: number;
  /** 在原文里的终点（**不含**）。 */
  end: number;
  /** 切干净的路径文本（不含尾部标点 / 开关）。 */
  text: string;
}

/**
 * 行尾允许被丢掉、且**不属于路径**的标点。
 *
 * 只收「明显是句子标点」的那几个：`-` `.` `_` 不在其中 —— 它们是真实文件名的
 * 一部分（`dev-launcher.mjs`、`comfy-app-t3-branch4`），收掉一个字符就是另一个东西。
 */
const TRAILING_PUNCT = new Set([
  "。",
  "，",
  "；",
  "、",
  "）",
  "】",
  "》",
  "”",
  "’",
  "…",
]);

/** 只在**数量不配平**时才可以丢的一对标点（`(` `)` `[` `]` `{` `}` `"` `'`）。 */
const PAIRED_PUNCT: [left: string, right: string][] = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ['"', '"'],
  ["'", "'"],
];

/** Windows 盘符绝对路径的起始判据（`C:\` 或 `C:/`）。 */
const WIN_DRIVE_RE = /^[A-Za-z]:[\\/]/;

/** UNC 的起始判据（`\\server\…`）。 */
const UNC_RE = /^\\\\[^\\/]+[\\/]/;

/**
 * 一段文本是否「至少像一条本机绝对路径」。
 *
 * 三个分支分别对应三种起点。**POSIX 分支要求至少两段**：`/` 后面还有一段，
 * 且那段里还有 `/`（即 `/a/b`）。只写 `/x` 判不了它是路径还是「除以 x」，
 * 而真实日志里 `1769 / 0 / 3` 这种分片写法并不少见 —— 不认比认错好。
 */
function looksLikeAbsolutePath(text: string): boolean {
  if (UNC_RE.test(text)) return true;
  if (WIN_DRIVE_RE.test(text)) return true;
  if (!text.startsWith("/")) return false;
  const rest = text.slice(1);
  return rest.length > 0 && !rest.startsWith("/") && rest.includes("/");
}

/** 统计文本里某个字符出现的次数（括号配平判据用）。 */
function countChar(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n += 1;
  return n;
}

/**
 * 从候选里收掉不属于路径的尾巴。
 *
 * 循环而不是一次性：`（见 §1.1）。` 的尾巴是「全角括号 + 句号」两层，一轮只切
 * 一层会留下 `）`，而它同样会让打开失败。
 */
function trimCandidate(raw: string): string {
  let text = trimFlagTail(raw);
  for (;;) {
    const before = text;
    while (text.length > 0 && (text.endsWith(" ") || text.endsWith("\t"))) {
      text = text.slice(0, -1);
    }
    if (text.length > 0 && TRAILING_PUNCT.has(text.slice(-1))) {
      text = text.slice(0, -1);
    }
    for (const [left, right] of PAIRED_PUNCT) {
      /* **数量不配平**才丢：Windows 文件名真能带成对括号
       * （`C:\Program Files (x86)\…`），一刀切会把合法路径削掉一半。 */
      if (
        text.endsWith(right) &&
        countChar(text, left) < countChar(text, right)
      ) {
        text = text.slice(0, -1);
      }
    }
    if (text === before) return text;
  }
}

/**
 * 把尾随的**命令行开关**一次次裁掉（`…\dev-launcher.mjs --mode prebuilt`）。
 *
 * 为什么需要它：Windows 形态会把空格吃进候选（见模块头），于是「路径 + 空格 +
 * 开关」连成一段。裁掉开关之后剩下的才是那条真的路径。
 *
 * 只裁**开关形状**（`-x` / `--xxx`，含 `=取值` 与「空格 + 取值」两种写法），
 * 不裁任意空格后的词：`C:\Program Files` 的后半段 `Files` 不是开关形状，必须留着。
 * 裁错了最多是少显示一个可点入口，不会指向别处 —— 这是这条判据敢宽的理由。
 *
 * 收尾空白与裁开关要交替进行：候选常常是「路径 + 开关 + 空格 + 下一个词」，
 * 而 `$` 匹配不到 `prebuilt ` 的末尾。
 */
function trimFlagTail(raw: string): string {
  let text = raw.replace(/[ \t]+$/, "");
  for (;;) {
    const trimmed = text
      .replace(/\s+-{1,2}[A-Za-z][\w-]*(?:=[\w.,:/-]*|\s+[^-\s][^\s]*)?$/, "")
      .replace(/[ \t]+$/, "");
    if (trimmed === text) return text;
    text = trimmed;
  }
}

/**
 * 从这个起点起的候选允不允许把空格吃进来（见模块头「空格」一节）。
 */
function allowsSpacesAt(text: string, start: number): boolean {
  const head = text.slice(start, start + 4);
  return UNC_RE.test(head) || WIN_DRIVE_RE.test(text.slice(start, start + 3));
}

/**
 * 路径内部允许的字符。
 *
 * 比「文件名合法字符」宽（`@` `+` `%` `$` `#` `~` `&` 都是真实路径里的常客，例如
 * `C:\Users\a@b\…`、`node_modules\@tauri-apps\…`），但把硬分隔符与**所有非 ASCII
 * 字符**挡在外面：中文在这一层是硬分隔符，那样 `项目根：F:\AI\…` 这类行才不会把
 * 中文吃进候选（代码点比较在 `ch <= " "` 那一条之外由「非 ASCII 一律 false」兜住）。
 */
function isPathChar(ch: string): boolean {
  if (ch === "\\" || ch === "/") return true;
  if (ch === ":") return true;
  if (ch === "." || ch === "-" || ch === "_") return true;
  if (ch <= " ") return false;
  if (ch >= "0" && ch <= "9") return true;
  if (ch >= "A" && ch <= "Z") return true;
  if (ch >= "a" && ch <= "z") return true;
  if (ch >= "\u0080") return false;
  return "@+%$#~!()[]{}&=*".includes(ch);
}

/**
 * 候选扫描到某个字符时能不能继续吃。
 *
 * 空格单独判而不是塞进 `isPathChar`：它**取决于是哪种形态的路径**
 * （见模块头「空格」一节）—— 盘符 / UNC 吃，POSIX 不吃。放进 `isPathChar`
 * 会让「谁来判形态」这件事无处安放。
 */
function inCandidate(ch: string, spacesInside: boolean): boolean {
  if (ch === " ") return spacesInside;
  return isPathChar(ch);
}

/**
 * 起点**左侧**紧贴的字符会不会和起点连成同一个词。
 *
 * 与 `isPathChar` 分开是必须的：那里把空格算作 Windows 候选的路径内字符
 * （`Program Files`），而这里若照用，`node F:\AI\…` 这种「空格 + 路径」的常见
 * 写法会被判成「左侧紧贴路径字符」而整条丢掉 —— 实测撞出来的正是这一条。
 *
 * 空格只做分隔、不做连接：`D:/x`（盘符前的字母）与 `http://x/y`（URL 里的斜杠）
 * 都由它挡住。
 */
function leftJoinsWord(text: string, at: number): boolean {
  if (at <= 0) return false;
  /* `charAt` 而不是 `text[i]`：越界回空串，`isPathChar("")` 为 false，
   * 于是「左邻不存在」与「左邻是空格」归入同一档而**不需要非空断言**。 */
  const prev = text.charAt(at - 1);
  if (prev === " " || prev === "\t") return false;
  return isPathChar(prev);
}

/**
 * 在下标 `at` 处能不能起一段路径；能则回它的起点，不能回 -1。
 *
 * 三种起点各有自己的形态判据，见模块头的表。`\\`（UNC）优先于单个 `\`：
 * 后者根本不起段 —— Windows 路径一定以盘符或 UNC 开头，单独的 `\x` 判不了归属。
 */
function pathStartAt(text: string, at: number): number {
  const ch = text.charAt(at);
  if (ch === "\\") {
    return text[at + 1] === "\\" ? at : -1;
  }
  if (ch !== "/") {
    if (!/[A-Za-z]/.test(ch)) return -1;
    /* 盘符形态：`X:\` / `X:/`。左侧紧贴词字符说明这个是词的一部分
     * （`abc:/` 不是盘符）—— 直接跳过。 */
    if (leftJoinsWord(text, at)) return -1;
    return WIN_DRIVE_RE.test(text.slice(at, at + 3)) ? at : -1;
  }
  /* `/` 起段：左侧紧贴词字符 → 这是 URL 或相对路径的中段，不是新段起点
   * （`https://x/y` 只该从行里那段完整形态起判，不该切出 `/y`）。 */
  if (leftJoinsWord(text, at)) return -1;
  return at;
}

/**
 * 扫描一段文本，回所有「像本机绝对路径」的片段（**按出现顺序**，区间不重叠）。
 *
 * 实现是单趟扫描而不是「按分隔符切词再判词」：路径里包含空格（`Program Files`）
 * 与标点（`-`、`@`、`+`），切词会把长路径切碎成几段、每段都不像路径而整条丢掉。
 * 这里改成「找到起点就一路吃到不可再吃的字符」，再回头收尾巴。
 */
export function findLogPathTokens(text: string): LogPathToken[] {
  const tokens: LogPathToken[] = [];
  let i = 0;
  while (i < text.length) {
    const start = pathStartAt(text, i);
    /* 这一步**必须 `i += 1` 往前挪**，不能用 `break` —— 绝大多数下标都不是路径
     * 起点（一行的第一个字符往往就是中文或字母），`break` 会让扫描在第一个字符
     * 上原地结束、整行一段也认不出来（实测撞出来的）。 */
    if (start < 0) {
      i += 1;
      continue;
    }
    const spacesInside = allowsSpacesAt(text, start);
    let end = start;
    while (end < text.length && inCandidate(text.charAt(end), spacesInside)) {
      end += 1;
    }
    const cleaned = trimCandidate(text.slice(start, end));
    /* 收完尾巴仍要过一次形状判据：`C:\`（盘符后什么都没有）这类候选只剩个壳，
     * 认了就是给用户一个点不动的入口。 */
    if (cleaned.length > 0 && looksLikeAbsolutePath(cleaned)) {
      tokens.push({ start, end: start + cleaned.length, text: cleaned });
    }
    /* 从**候选的原始末尾**继续扫（不是从 `start + cleaned.length`）：被裁掉的
     * 尾巴里可能还藏着下一段路径（`F:\a\b, F:\c\d` 的逗号与空格由下一轮
     * `pathStartAt` 跳过），从干净末尾继续会把它们漏掉。 */
    i = Math.max(end, start + 1);
  }
  return tokens;
}
