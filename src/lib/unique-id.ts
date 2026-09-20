// ── 「给一条新记录分配 id」的唯一口径（规范 16 §16.2.4.36）─────────────────
//
// 按形态扫描时撞出来的账：全库有 **6 处**各自从零写一遍「时间戳 + 进程内
// 计数器」：
//
//   const id = `${Date.now().toString(36)}-${n.toString(36)}`;        // 日志
//   const id = `msg_${Date.now().toString(36)}_${seq.toString(36)}`;  // 消息中心
//   const id = `agent-msg-${Date.now().toString(36)}-${++n}`;         // 工坊对话
//   const id = `${prefix}_${Date.now().toString(36)}_${++n}`;         // 剧本解析
//   const id = `t_${Date.now()}_${Math.random().toString(36)...}`;    // 提示条
//   const id = `n_${Date.now()}_${Math.random().toString(36)...}`;    // 画布节点
//
// 写法看着都对，**判据却各不相同**，而且分三派：
//
//   · **计数器取模**（`entryId = (entryId + 1) % 1_000_000`）—— 转一圈之后
//     同一毫秒内的两条记录会拿到**同一个 id**（React 的 `key` 撞车 → 列表
//     错位复用；日志的 `seen` 集合去重会把新的那条当成旧的丢掉）；
//   · **随机后缀**（`Math.random().toString(36)`）—— 靠概率避重，而且
//     `Math.random()` 的取值范围与长度都写在调用处（`.slice(2, 6)` /
//     `.slice(2, 7)` / `.slice(2, 8)` **三种**），谁也不欠谁一个口径；
//   · **裸 `Date.now()`**（毫秒数直接拼进去）—— 与上面两派的**字典序**
//     完全不同（`36` 进制是定长大致有序，毫秒数是 13 位数字），于是
//     「同前缀的记录按 id 排序」在一半落点成立、另一半不成立。
//
// 也就是说 —— **「两条同一毫秒产生的记录会不会撞 id」取决于它是哪一处生成的**。
// 这类差异没有报错、没有告警，tsc / eslint 也都不看。
//
// ## 口径（三条）
//
// 1. **id = 前缀 + 时间戳（36 进制）+ 严格递增的序号**。计数器**不回绕**：
//    撞 id 的代价（列表错位复用、去重把新记录当成旧的）远高于「序号位数变长」。
//    `now` 由调用处注入（同一批导入的记录要共享同一个时刻，见 `log-store`
//    的 `parsedAt` 兜底），缺省取 `Date.now()`。
// 2. **前缀由调用处给**，出口只负责不许它带分隔符之外的意外字符。
// 3. **序号每前缀一套**（`agent-msg-` 与 `tool-run-` 各自从 1 开始）——
//    否则两个互不相干的列表会互相把对方的号推走。
//
// **不收**：`crypto.randomUUID()`（那是**全局唯一**的 id，与这里「同一时刻、
// 同一前缀内有序」的判据不是同一件事，落点见画布节点与工坊项目）；
// 服务端的 id（归数据库）；`seq`（日志里那个「入库序」是**排序次键**，
// 与 id 的判据不同，见 `log-store`）。

/** 本模块分配过的序号，**按前缀各一套**（见口径 3）。 */
const sequences = new Map<string, number>();

/**
 * 生成一个「同一时刻、同一前缀内唯一且有序」的 id。
 *
 * ```ts
 * const id = nextId("msg_");                    // 例：msg_mk3f1a-1
 * const id = nextId("log-", { now: batchTime }); // 同一批导入共享时刻
 * ```
 *
 * - `prefix` 是这条记录**属于谁**的标记，可带分隔符（`msg_` / `agent-msg-`）。
 * - `now` 由调用处注入：同一批导入的记录要共享同一个时刻，避免「同一批里
 *   前面的记录时间戳反而更晚」；缺省取当前时刻。
 */
export function nextId(prefix: string, options: { now?: number } = {}): string {
  const seq = (sequences.get(prefix) ?? 0) + 1;
  sequences.set(prefix, seq);
  const now = options.now ?? Date.now();
  return `${prefix}${now.toString(36)}-${seq.toString(36)}`;
}

/**
 * 一次性 id：**只取一次时刻**，不占用序号。
 *
 * 与 `nextId` 的判据差别就是这条 —— `nextId` 要的是「同一时刻内多个 id
 * 也能排序且不撞」；而这个用在**一次调用只产出一个 id** 的地方：界面元素 /
 * 消息体的 `key`、镜头列表的本地条目、埋点标记。这类没有「枚举」问题，
 * 但「同一批生成的两条会不会撞」仍然要由出口回答（收口前是
 * `` `shot-${Date.now()}` ``、`` `${Date.now()}_${safe}${ext}` `` 这类手拼）。
 *
 * `prefix` 里带不带分隔符由调用处决定；`now` 同 `nextId`（同一批导入共享时刻）。
 */
export function uniqueStamp(
  prefix = "",
  options: { now?: number } = {},
): string {
  const now = options.now ?? Date.now();
  return `${prefix}${now.toString(36)}-${randomToken(4)}`;
}

/**
 * 只取一个「可读的唯一短标记」（不含前缀与时间戳语义）。
 *
 * 用于**文件名的可读段**：它们只在用户的文件系统里充当标记，不参与任何
 * 判据（去重、排序、引用），所以随机段比递增序号更合适
 *（不引入一个会随刷新重置的模块级状态）。
 */
export function randomToken(bytes = 6): string {
  let out = "";
  while (out.length < bytes) {
    out += Math.random().toString(36).slice(2);
  }
  return out.slice(0, bytes);
}

/** 仅测试用：把序号表清空，让用例之间互不影响。 */
export function __resetIdSequences(): void {
  sequences.clear();
}
