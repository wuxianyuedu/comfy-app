/**
 * `sqlite-error.ts` — SQLite 写失败的「原因」提取与可重试判定（纯叶子，ISSUE #1250）
 *
 * 现场：桌包（standalone + host）的宿主日志里只有一句
 *   `[comfyui] fail(pkg…) 缺解释器收口异常：Failed query: update "task" set … params: FAILED,…`
 * 这是 drizzle 的**包装**消息，真正的原因挂在 `error.cause` 上（libsql / node:sqlite 给的是
 * `SQLITE_BUSY: database is locked` 一类）。原因不落到日志，现场就只能猜「是没这张表，还是
 * 库被锁了」—— 而这两者的处置完全相反：前者要改代码，后者等一等就过。
 *
 * 只做三件事，且都不碰 IO / 不引驱动：
 *   ①  {@link describeSqliteWriteError} 把 cause 链上的 code / message 拼回一句可读文本；
 *   ②  {@link isSqliteBusyError} 判「这类错误等一等就能过」，供调用处决定要不要重试；
 *   ③  {@link sqliteAwareErrorText} 给**所有**库写失败的捕获点取日志文案 —— 是库失败就
 *      带上驱动码，不是就交回 `~/lib/error-message` 的 `errorText`（ISSUE #1262 的前置）。
 *
 * 为什么不并进 `~/lib/error-message` 的 `errorText`：那条是「unknown → 可读」的通用兜底
 * （还要照顾网络错的翻译表），而这几条的判据是 **SQLite 的错误码族**，语义与生命周期都
 * 不同；③ 就是两边之间那层薄封装，方向是「库 → 通用」，通用那侧不认识库。
 */
import { errorText } from "~/lib/error-message";
import { LOG_DETAIL_MAX, clampText } from "~/lib/text-clamp";

/** cause 链最多走几层：drizzle → libsql → native 实际只有一两层，留出余量即可，
 *  再深就当作循环引用停手（抛值可以是任何东西，`unknown` 的纪律在这里同样成立）。 */
const CAUSE_CHAIN_LIMIT = 5;

/** SQLite 里「等一等就有锁」的那一族错误码。 */
const TRANSIENT_LOCK_CODES = [
  "SQLITE_BUSY",
  "SQLITE_LOCKED",
  "SQLITE_PROTOCOL",
];

/** 同上，但有些驱动版本只在消息里给这句话、不给 `code`。 */
const TRANSIENT_LOCK_PHRASES = [
  "database is locked",
  "database table is locked",
];

function fieldOf(value: unknown, key: "code" | "message" | "name"): string {
  if (typeof value !== "object" || value === null) return "";
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : "";
}

/** 沿 cause 链收集 code / message（去重、保序）。 */
function collect(error: unknown): { codes: string[]; messages: string[] } {
  const codes: string[] = [];
  const messages: string[] = [];
  let node: unknown = error;
  for (let depth = 0; depth < CAUSE_CHAIN_LIMIT && node != null; depth++) {
    const code = fieldOf(node, "code");
    if (code && !codes.includes(code)) codes.push(code);
    const message = fieldOf(node, "message");
    if (message && !messages.includes(message)) messages.push(message);
    node =
      typeof node === "object"
        ? (node as { cause?: unknown }).cause
        : undefined;
  }
  return { codes, messages };
}

/**
 * 一条带原因的失败文本：`基础消息（SQLite: CODE / cause 消息）`。
 *
 * 基础消息取原错误的 message（drizzle 的 `Failed query: …` 保留了 SQL 与参数，
 * 复现现场要用它），后括号里是给**人**看的原因。找不到任何 cause 信息时退化成
 * 原 message 或 fallback —— 与本仓「失败路径必须有可读文案」（硬规则 4）同口径。
 *
 * **预算先给原因，再给 head**（ISSUE #1262 复演读数逼出来的顺序）：drizzle 的 head 里
 * 连着 `params:`，参数一长就能吃掉整个 `LOG_DETAIL_MAX` —— dev 那一格实测 655 字的一行里
 * 「工作流校验未通过…」的模型清单把 `（SQLite: SQLITE_BUSY…）` 挤成了省略号，
 * 于是这一条改造刚承诺的「原因看得见」在长 head 下又失效。原因才是判「锁 vs 没表」的那一半，
 * 永远不能被现场细节挤掉。
 */
export function describeSqliteWriteError(
  error: unknown,
  fallback = "SQLite 写失败",
): string {
  const { codes, messages } = collect(error);
  const head = messages[0] ?? fallback;
  const reason = [
    codes.join(","),
    ...messages
      .slice(1)
      .map((m) => clampText(m, { maxLength: 120, marker: "…" })),
  ]
    .filter(Boolean)
    .join(" / ");
  if (!reason)
    return clampText(head, { maxLength: LOG_DETAIL_MAX, marker: "…" });
  const reasonPart = `（SQLite: ${reason}）`;
  /* 原因自身超预算时先保原因（它更短也更要紧），head 让位到零也要留省略号。 */
  const headBudget = Math.max(0, LOG_DETAIL_MAX - reasonPart.length);
  return clampText(
    `${clampText(head, { maxLength: headBudget, marker: "…" })}${reasonPart}`,
    { maxLength: LOG_DETAIL_MAX, marker: "…" },
  );
}

/**
 * 这一看就是一次 **SQLite 失败**吗？
 *
 * 两个证据任一即算：cause 链上带错误码，或者头一句就是 drizzle 的包装文案
 * （`Failed query: … params: …` —— 它只可能来自库操作）。第二个证据是必须的：
 * 「码取不到」恰恰是最需要标注的时刻（见 {@link sqliteAwareErrorText}），
 * 只认错误码的话，那种现场会被当成「不是库的错」而继续用通用文案，原因就又丢了。
 */
export function isSqliteFailure(error: unknown): boolean {
  const { codes, messages } = collect(error);
  if (codes.length > 0) return true;
  return messages.some(
    (m) =>
      /^Failed query:/i.test(m) ||
      TRANSIENT_LOCK_CODES.some((c) => m.includes(c)) ||
      TRANSIENT_LOCK_PHRASES.some((p) => m.toLowerCase().includes(p)),
  );
}

/** 那条「原因没落地」的固定尾巴：明说取不到，而不是让空白被读成「没有原因」。 */
const NO_CAUSE_TAIL = "（SQLite: 原因未取到 —— cause 链里没有错误码）";

/**
 * 捕获到的失败要写进日志时用它：**是库失败就把驱动码与原因带上，其余一律走通用文案**。
 *
 * 为什么要有这一层，而不是让每处 catch 自己判断（ISSUE #1262 的直接起因）：
 * `errorText` 的本职是「动作：详情」那一行字，它只取 `message`，
 * 而 drizzle 把真实原因挂在 `error.cause` 上 —— 于是执行链上那些**库写失败**的捕获点
 * （领取、等待提示、回收器对账、续跑、收口异常）到今天为止都只打出一句
 * `Failed query: update "task" set …`，看现场的人分不清是锁、是没表、还是别的东西。
 * #1250 只把「终态那一次写」那一条修好了；剩下的路都还是瞎的。
 *
 * 参数与 `errorText(e, action, fallback)` **逐位同形**（换过去不改任何一处调用语义）：
 * `action` 是动作名、一定会出现在结果里，`fallback` 只兜「详情取不到」那一半。
 *
 * 三条分支：
 *   · 认得出码 ⇒ `动作：原句（SQLite: CODE / cause 消息）`；
 *   · 是库失败但链上没码 ⇒ 同一句 + **明说取不到**的尾巴 —— 空白会被读成「没有原因」，
 *     而真实情况是「原因在链路里丢了」，这两件事必须区分开写；
 *   · 不是库失败 ⇒ 原样交给 `errorText`（网络错翻译那些本领一条不丢）。
 */
export function sqliteAwareErrorText(
  error: unknown,
  action: string,
  fallback = "未知错误",
): string {
  if (!isSqliteFailure(error)) return errorText(error, action, fallback);
  const detail = describeSqliteWriteError(error, fallback);
  /* 描述里已经带上了「（SQLite: …）」就用它自己那份；否则补那句明说的尾巴。
   * 两种情况都不动 action 前缀 —— 同一块面板上「哪个动作失败了」永远要在。 */
  return `${action}：${detail.includes("（SQLite:") ? detail : `${detail}${NO_CAUSE_TAIL}`}`;
}

/**
 * 这一类错误「等一等就有锁」吗？
 *
 * 只认上面那一族错误码，**不看 message 里有没有 timeout 字样**：drizzle 的
 * `Failed query` 消息本身不含驱动错误码以外的信息，而「查询超时」在本项目里是
 * 另一条已经明确处置过的路径（comfy-cli 看门狗），混进来会让一次不该重试的失败
 * 被重试三次。认不出原因 ⇒ 判 false（不重试，直接走穷尽路径），宁可少重试一次
 * 也不要把一个真故障拖成三次。
 */
export function isSqliteBusyError(error: unknown): boolean {
  const { codes, messages } = collect(error);
  if (codes.some((c) => TRANSIENT_LOCK_CODES.some((t) => c.startsWith(t)))) {
    return true;
  }
  // 兜底：个别驱动只在 message 里给 `database is locked` / `SQLITE_BUSY`。
  return messages.some(
    (m) =>
      TRANSIENT_LOCK_PHRASES.some((p) => m.toLowerCase().includes(p)) ||
      TRANSIENT_LOCK_CODES.some((c) => m.includes(c)),
  );
}
