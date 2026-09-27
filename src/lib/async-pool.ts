// ── 有界并发的任务池（唯一出口，规范 §12.18 / §12.12）───────────────────────
//
// 按**形态**收的账：工坊的三个批量循环（镜头生图 / 视频生成 / 分镜批量）此前
// 都是「await 一条到底再提交下一条」的纯串行——本地 ComfyUI 本来就按队列连续
// 吃任务，串行等于在「上一条落定 → 提交下一条」之间白等一段空转；API 通道
// 则是纯粹的吞吐浪费。`Promise.all(items.map(worker))` 是另一极端（无界并发，
// 几十条一起打出去）；这里给的是中间那一档：**最多 limit 条在途，落定一条
// 补位一条**，全部落定后 resolve。

/**
 * 以最多 `limit` 条在途的节奏依次消费 `items`，全部处理完后 resolve。
 *
 * 语义：
 *   • `limit` 被夹到 `[1, items.length]`：0 / 负数按 1 处理（退化串行），
 *     超出条数不空转；
 *   • worker 抛错会**立即短路**整个池（`Promise.all` 语义，其余 runner 会在
 *     后台跑完各自队列但不被等待）——批量调用方的 worker 应当自行兜错
 *     （工坊的 generateShot / generateClip 就是这么写的：单条失败置 failed、
 *     不中断批量）；
 *   • `items` 里不允许出现 `undefined` 条目（内部用它做索引守卫）。
 */
import { clamp } from "~/lib/clamp";

export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  /* 并发宽度夹到 [1, 条数]：夹取走统一出口（P59）。 */
  const width = clamp(limit, 1, items.length);
  let next = 0;
  const runners = Array.from({ length: width }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      /* noUncheckedIndexedAccess 下索引访问返回 `T | undefined`；
       * `index < items.length` 时不会发生，守卫只为过判据。 */
      const item = items[index];
      if (item === undefined) return;
      await worker(item, index);
    }
  });
  await Promise.all(runners);
}
