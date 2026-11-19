/**
 * `content-write-lock.ts` — production 内容列的按项目写锁（ISSUE #3864）。
 *
 * `production` 的内容列（shots / characters / scriptReview / scriptMarkdown）
 * 是 JSON 整列存储，多个服务端写者（run 引擎、评审器、人工裁决路由、成片回写）
 * 都是「读整列 → 改 → 整列写回」。SQLite 单写者只保证**单条语句**原子；把每个
 * 写者的「锁内重读最新列 → 合并本次产出 → 写回」整段用**按项目**的进程内互斥
 * 串行化，正好补上跨语句读改写的缺口（写入方全在同一个 Next server 进程内）。
 *
 * 与事务的分工（同 `src/lib/async-mutex.ts` 头注）：纯 DB 的多语句序列优先开
 * `db.transaction(…, { behavior: "immediate" })`；这里的锁管的是「读列 → 内存
 * 合并 → 写列」这种夹着内存计算的序列。慢 IO（LLM / 生图）**必须留在锁外**，
 * 锁内只做重读与落库，否则会长时间占住同一项目的全部写者。
 *
 * 跨进程的写者（工坊 MCP 在独立进程）不归这层管——那侧靠字段级 patch / 版本
 * CAS（ISSUE #3852 的口径），别用这层冒充。
 */
import "server-only";

import { KeyedAsyncMutex } from "~/lib/async-mutex";

const locks = new KeyedAsyncMutex();

/** 在 `projectId` 的内容写锁内执行 `fn`；返回值 / 异常原样透传。 */
export function withProductionContentLock<T>(
  projectId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  return locks.run(projectId, () => Promise.resolve(fn()));
}
