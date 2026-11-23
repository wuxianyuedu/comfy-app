/**
 * `cancel-body-reader.ts` — 「中止路径取消上游流」的共享收口（ISSUE #4796）。
 * @module network/cancel-body-reader — fetch body reader 的取消 + 解锁唯一出口
 *
 * 这份 `finally` 形态此前在四处逐字重复（api-channel 的 safeFetch、
 * media-source.server、workshop comfyui 中继、llm video-task-util），每次都按
 * 「仿照最近一处」抄第 N 份。语义只有一句：**只在 `finally` 里调** —— 超限 /
 * 出错抛出时取消上游流（只 `releaseLock()` 不停上游时，剩余字节会继续进无人
 * 读取的 socket 直到超时，ISSUE #4218）；正常读完时 cancel 是无操作。
 * cancel/close 都做兜底 —— 测试桩与旧环境可能没有这些方法。
 */
export function cancelBodyReader(reader: {
  cancel?: () => unknown;
  releaseLock: () => void;
}): void {
  try {
    void Promise.resolve(reader.cancel?.()).catch(() => undefined);
  } catch {
    /* cancel 不可用时不影响既有的收尾 */
  }
  reader.releaseLock();
}
