/**
 * `sqlite-error.ts` — SQLite 写失败的「原因」提取与可重试判定（纯叶子，ISSUE #1250）
 *
 * 现场：桌包（standalone + host）的宿主日志里只有一句
 *   `[comfyui] fail(pkg…) 缺解释器收口异常：Failed query: update "task" set … params: FAILED,…`
 * 这是 drizzle 的**包装**消息，真正的原因挂在 `error.cause` 上（libsql / node:sqlite 给的是
 * `SQLITE_BUSY: database is locked` 一类）。原因不落到日志，现场就只能猜「是没这张表，还是
 * 库被锁了」—— 而这两者的处置完全相反：前者要改代码，后者等一等就过。
 *
 * 只做两件事，且都不碰 IO / 不引驱动：
 *   ①  {@link describeSqliteWriteError} 把 cause 链上的 code / message 拼回一句可读文本；
 *   ②  {@link isSqliteBusyError} 判「这类错误等一等就能过」，供调用处决定要不要重试。
 *
 * 为什么不并进 `~/lib/error-message` 的 `errorText`：那条是「unknown → 可读」的通用兜底
 * （还要照顾网络错的翻译表），而这两条的判据是 **SQLite 的错误码族**，语义与生命周期都
 * 不同；两边各自收口，调用处按需要用。
 */
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
  const text = reason ? `${head}（SQLite: ${reason}）` : head;
  return clampText(text, { maxLength: LOG_DETAIL_MAX, marker: "…" });
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
