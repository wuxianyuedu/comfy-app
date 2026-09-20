// ── 「把一段文本按最大长度截断」的唯一出口（规范 16 §16.2.4.48）────────────
//
// 此前全库有十余处各自写一遍「超长就切一刀」，而**长度上限、截断方向、
// 省略标记**三件事各写各的：
//
//   · 上限：600 / 400 / 900 / 2000 / 4000 / 8000 …（还散着 200 / 240 / 500）
//   · 方向：绝大多数保留头部（`slice(0, n)`），日志会话那一路保留**尾部**
//     （`slice(-n)`）—— 两者在界面上看不出区别，改错了也没人会发现
//   · 标记：`…` / `\n…(truncated)` / `…(truncated, 原始 N 字符)` / **什么都不加**
//     —— 最后一档最危险：用户看到一段被腰斩的内容，却不知道它被切过
//
// 关键认识：**上限取值并不该统一**。它们被不同的东西约束：
//
//   · `error-message` 的 600  —— 日志 detail 字段的**可读预算**（人读的一行）
//   · `executor-errors` 的 4000 —— **DB 列体积**（`task.error` 是 text，
//     但要避免一个巨大 traceback 把行撑到 MB 级）
//   · `trace` 的 8000 —— **诊断文件体积**（trace 是排查用的，不是给人读的一行）
//   · `app-runtime` 的 2000 —— **落盘日志文件体积**
//   · 各处 200/240/500 —— **界面/反馈文案预算**（塞进一句话里的截断）
//
// 收口方式与 §16.2.4.9 的滚动条同款：**只搬定义、不动取值** —— 每个上限
// 本文件显式命名并注明它被什么约束，调用处 import 具名常量，不再自己写数字。
// 判据是「**同一件事的定义只有一处**」，不是「把数字都改成一样大」。
//
// 「为什么不把上限也收成一个」：那会把「DB 列体积」与「人读一行的预算」
// 压成同一个数 —— 而它们本来就该不同，这正是本条账要**显式说出来**的那一层。
// 本文件给的是一处**能说清差异**的落点。

/** 截断时附在尾部/头部的省略标记。 */
export const ELLIPSIS = "…";

/** 截断方向。 */
export type ClampDirection = "head" | "tail";

export interface ClampOptions {
  /** 上限（字符数）。必填 —— 本条账的判据就是「上限必须显式」。 */
  maxLength: number;
  /**
   * 保留哪一头（默认 `"head"`）。
   *
   * 绝大多数诊断文本保留头部（报错原因在前几行、stack 越往下越没用）；
   * 但**日志会话**这类「最新的在最后」的内容必须保留尾部，否则截出来的
   * 全是无关的上古内容。两者在界面上看不出差别，只有显式声明才说得清。
   */
  direction?: ClampDirection;
  /**
   * 省略标记（默认 `{@link ELLIPSIS}`）。传 `""` 表示**不标记** ——
   * 只用于「截断后仍是完整单元」的场景（如按行取整），
   * 一般不该用它：不标记的截断会让用户把腰斩内容当成全部。
   */
  marker?: string;
  /**
   * 标记的**圆括号内容**（如 `"truncated"` / `"truncated, 原始 12345 字符"`）。
   *
   * 与 {@link marker} 二选一：给了它，标记即由出口拼成 `…(内容)`；
   * 没给则用 {@link marker}（默认 `…`）。给诊断通道用 ——
   * 「被切了多少」是排查时最想知道的那一个数，而它只能由调用处算出来。
   */
  annotation?: string;
}

/**
 * 超出 `maxLength` 时截断，否则原样返回。
 *
 * 标记的拼法是**本条账最容易写岔的地方**：正文与标记都算在结果里，
 * `slice(0, maxLength)` 之后再拼标记会让返回值比上限长。这里统一为
 * 「标记占掉自己的额度」—— `maxLength` 是**返回值**的上限，不是正文本数的上限。
 */
export function clampText(text: string, opts: ClampOptions): string {
  const { maxLength, direction = "head", marker, annotation } = opts;
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  const mark =
    marker ??
    (annotation !== undefined ? `${ELLIPSIS}(${annotation})` : ELLIPSIS);
  /* 标记比上限还长时**不留标记**（只裁到上限）—— 否则返回值反而变长。 */
  if (mark.length >= maxLength) {
    return direction === "tail"
      ? text.slice(text.length - maxLength)
      : text.slice(0, maxLength);
  }
  const budget = maxLength - mark.length;
  const body =
    direction === "tail"
      ? text.slice(text.length - budget)
      : text.slice(0, budget);
  return direction === "tail" ? mark + body : body + mark;
}

/* ── 具名上限：每个数字都注明了它被什么约束 ──────────────────────────────
 *
 * 这些常量**不是在统一取值**，而是把「为什么是这个数」从散落的字面量
 * 收成一处能读懂的定义。改动某一个时，读它的注释就知道动的是哪条约束。
 */

/** 日志 detail 字段：给人读的**一行**预算。 */
export const LOG_DETAIL_MAX = 600;

/** 落库的任务错误文本：受 **DB 列体积**约束（避免单行撑到 MB 级）。 */
export const TASK_ERROR_MAX = 4000;

/** 诊断 trace 的单行上限：受**诊断文件体积**约束（trace 是排查用的）。 */
export const TRACE_LINE_MAX = 8000;

/** 落盘运行日志的单条消息上限：受**日志文件体积**约束。 */
export const RUNTIME_LOG_MESSAGE_MAX = 2000;

/** 界面上一句反馈里嵌的片段（上游响应体 / stderr）：**文案预算**（一行）。 */
export const INLINE_SNIPPET_MAX = 200;

/** 界面上一句反馈里嵌的**结构化**片段（JSON 响应体转文本）：同上，留宽一档。 */
export const INLINE_JSON_SNIPPET_MAX = 240;

/** 界面上一句反馈里嵌的**多行**片段（子进程 stderr / 运行时日志行）。 */
export const INLINE_STDERR_MAX = 500;

/** 界面上一句反馈里嵌的**结构化环境**片段（诊断用 env dump，比反馈句长）。 */
export const INLINE_DUMP_MAX = 900;

/** 便签卡标题：正文 30 + 标记 1 = 31（**保持收口前的取值** —— 原来写成
 *  「`length > 32` 就 `slice(0, 30)` + `…`」，等价于「上限 31」）。 */
export const TITLE_MAX = 31;

/** 历史卡标题（提示词摘要）：正文 40 + 标记 1 = 41（同上，保持原取值）。 */
export const PROMPT_TITLE_MAX = 41;

/** 一句**动作摘要**里嵌的用户输入（长文本只留开头，剩下交给完整视图）。 */
export const SUMMARY_MAX = 80;
