/**
 * `executor-write-retry.ts` — 「终态那一次库写」的重试与穷尽后的自处（ISSUE #1250）
 *
 * 补的是执行链上最后一个「静默失效」口：终态写失败此前只留下一行 WARN
 * （`fireAndForget(fail(…), e => cliWarn(…))`），既不重试也没有人接管 ⇒ 那一行
 * 永久停在 `RUNNING`，`pendingDispatch` 还占着槽位（并发上限 1）把整条队列卡住，
 * 界面上是「一直在生成」，而回收器每 30s 数到它却只打一句 `checked`。
 *
 * 为什么是「重试 + 摘掉本进程足迹」而不是「把失败写进库里让别人接管」：**写库正是失败的那件事**
 * —— 任何依赖再写一行的接管信号在同一次故障里都不可靠。而摘足迹不需要写库：
 * {@link forgetTaskClaimEntirely} 把 `reaper.ts` 的 `isTaskClaimedInProcess` 读的**四样**
 * 一次清空（槽位、`executedWorkflow`、`settled`、comfy-cli 之外都在它管范围内），下一轮对账
 * 就把这行判掉。**只归还槽位是不够的**（桌包实演量到：那一行在 `RUNNING` 上停了 11 分钟、
 * 22 轮回收全打 `checked` 空转，因为 `fail()` 在抛出后再没机会清 `executedWorkflow`）。
 *
 * 只重试**锁族**错误（`isSqliteBusyError`）：认不出原因就判不可重试，宁可少试一次，
 * 也不要把一个真故障（例如 `no such table`）拖成四次同样的写入。
 *
 * @module comfyui/executor-write-retry — 终态库写的重试与穷尽处置
 */
import { TERMINAL_DB_WRITE } from "~/lib/retry-policy";
import { describeSqliteWriteError } from "~/lib/sqlite-error";
import { runWithSqliteBusyRetry } from "~/lib/sqlite-busy-retry";
import { kickQueue } from "./executor-continuation";
import { forgetTaskClaimEntirely, log } from "./runner-state";

/**
 * 跑一次终态库写，撞锁就按预算重试。
 *
 * 循环体在 `~/lib/sqlite-busy-retry`（ISSUE #2586 收的那一份），这里只留域逻辑：
 * 撞锁时念一行、穷尽后摘足迹、抛出时带上 SQLite 的原因。
 *
 * @param label 给人看的分支名（「成功收口」/「失败收口」），同时进行日志与抛错文案。
 * @throws 穷尽（或本就不可重试）后抛出**带 SQLite 原因**的错误 —— 调用处的
 *         `fireAndForget(…, onError)` 因此第一次能在日志里看到 `SQLITE_BUSY`，
 *         而不是只有 drizzle 的 `Failed query`。
 */
export async function writeTerminal<T>(
  taskId: string,
  label: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await runWithSqliteBusyRetry(write, {
      policy: TERMINAL_DB_WRITE,
      onBusy: (attempt) => {
        if (attempt === 0) {
          // 只在第一次重试时写一行：撞锁是同一件事，逐次写会把行日志刷成噪音。
          log(
            taskId,
            "warn",
            `终态${label}写库撞锁，按预算重试（最多 ${TERMINAL_DB_WRITE.maxAttempts} 次）`,
          );
        }
      },
      onGiveUp: (err, tries) => {
        giveUp(taskId, label, err, tries);
      },
    });
  } catch (error) {
    throw new Error(describeSqliteWriteError(error, `终态${label}写库失败`), {
      cause: error,
    });
  }
}

/**
 * 穷尽（或不可重试）之后的自处：**先摘干净本进程的账，再留痕，最后推队列**。
 *
 * 顺序有意：摘足迹放在最前，这样即使后面那行日志也写不出去，这一行在回收器眼里
 * 已经是孤儿了（接管只依赖库里的状态与本进程的足迹，不依赖那行日志）。
 */
function giveUp(taskId: string, label: string, err: unknown, tried: number): void {
  forgetTaskClaimEntirely(taskId);
  log(
    taskId,
    "error",
    `终态${label}写库失败（已试 ${tried} 次）：${describeSqliteWriteError(err, "原因未取到")}；` +
      "本进程不再认领这一行，队列继续推进，未收口的行由回收器下一轮对账判定。",
  );
  kickQueue();
}
