/**
 * `sqlite-busy-retry.ts` — 「撞锁就按预算重试」这一半的唯一实现（ISSUE #2586）
 *
 * 为什么现在要收这一份：同一段八行循环此前在 `sqlite-pragmas.ts`（开机那几条
 * PRAGMA 切 WAL）与 `comfyui/executor-write-retry.ts`（终态那一次库写）里各写过
 * 一遍，而 `repository-user.ts` 的事务站点是第三处。三处的**域逻辑**确实各不相干
 * （一处要逐条 PRAGMA、一处在穷尽后摘掉本进程足迹、一处是用户点的一次保存），
 * 所以这里抽的**不是** `retryAsync` 那种「把循环体塞进回调」的通用件——
 * `retry-policy.ts` 文件头明确反对的就是那一种。这里只收三处**逐字相同**的那一半：
 *   ① 只认锁族错误（复用 `~/lib/sqlite-error` 沿 `cause` 取驱动码的那条判据）；
 *   ② 按具名策略退避（数字仍只有一份，在 `~/lib/retry-policy`）；
 *   ③ 穷尽或不可重试 ⇒ **原样抛出**（不吞、不改写消息——包装文案是调用处的事）。
 *
 * 只认锁族这一条是三处共同的纪律：认不出原因就判不可重试，宁可少试一次，
 * 也不把「没这张表 / 只读挂载 / 磁盘满」一类真故障拖成四次同样的写入。
 *
 * @module sqlite-busy-retry — 撞锁重试的唯一循环体
 */
import { backoffDelayMs, type BackoffShapeOptions } from "~/lib/retry-policy";
import { isSqliteBusyError } from "~/lib/sqlite-error";
import { sleep } from "~/lib/with-timeout";

/**
 * 一份具名策略去掉 `attempt` 之后的形状——`retry-policy` 里那几条
 * （`TERMINAL_DB_WRITE` / `SQLITE_PRAGMA_BOOT` / 本仓新增的那些）都是它。
 * `maxAttempts` 是**含首次尝试**的总次数：循环边界在这里，退避算法仍在那一份里。
 */
export type SqliteBusyRetryPolicy = BackoffShapeOptions & {
  maxAttempts: number;
};

export interface SqliteBusyRetryOptions {
  /**
   * 每次「还要再试」之前回调一次（`attempt` 从 0 起）。
   * 只用来念一行给人看的话，**不参与判决**——所以回调的返回值被忽略。
   */
  onBusy?: (attempt: number, error: unknown) => void;
  /**
   * 穷尽（或本就不可重试）之后、抛出之前回调一次；`tries` 是实际尝试次数。
   * `executor-write-retry` 那侧要在这里摘掉本进程足迹，顺序是既有纪律：
   * **先摘账再留痕**，这样即使那行日志也写不出去，回收器已经能把这一行判掉。
   */
  onGiveUp?: (error: unknown, tries: number) => void;
  policy: SqliteBusyRetryPolicy;
}

/**
 * 跑一次可能撞锁的操作，撞锁就按预算重试。
 *
 * @param op 那一次操作本身。**每次重试都重新调用它**——所以它必须是可重入的：
 *        带写事务的调用方要知道，撞锁失败的那一次已经整体回滚，不会留下半态
 *        （这正是 #2586 把三条语句收进一个事务之后才成立的性质）。
 * @throws 非锁族错误、或重试穷尽后**原样抛出原错误**（调用方据此决定文案与善后）。
 */
export async function runWithSqliteBusyRetry<T>(
  op: () => Promise<T>,
  { policy, onBusy, onGiveUp }: SqliteBusyRetryOptions,
): Promise<T> {
  const { maxAttempts, ...backoff } = policy;
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (error) {
      const lastTry = attempt + 1 >= maxAttempts;
      if (!isSqliteBusyError(error) || lastTry) {
        onGiveUp?.(error, attempt + 1);
        throw error;
      }
      onBusy?.(attempt, error);
      await sleep(backoffDelayMs({ ...backoff, attempt }));
    }
  }
}
