/**
 * `repository-row.ts` — Drizzle `returning()` 结果取首行的**唯一出口**
 * @module core/repository-row — Drizzle `returning()` 结果取首行
 *
 * 为什么需要它
 * ------------
 * `noUncheckedIndexedAccess` 打开后，`rows[0]` 的类型恒为 `T | undefined`。
 * 仓储层各处的 `insert(...).returning()` / `update(...).returning()` 之后都
 * 需要「取那一行」，此前一律写成 `rows[0]!` —— 于是**空数组会被静默当成
 * `T` 往下游传**：`update` 匹配 0 行时返回 `undefined` 冒充实体，调用方直到
 * 读字段才炸，栈里早已看不出是哪条 SQL。
 *
 * 这里把「取首行 + 缺席时抛出」收成一处：不写 `!`、也不写 `as T`，
 * 缺席即显式失败。错误类型按**缺席意味着什么**分两档：
 *
 *   · {@link firstRowRequired} —— 写入路径（INSERT / 单例 UPDATE）理论上
 *     **必有行**，缺席属内部故障，抛 `AppError`（500）；
 *   · {@link firstRowOfExisting} —— 按 id 更新，缺席说明**目标行不存在**，
 *     抛 `NotFoundError`（404）—— 与 `DrizzleRepository.update` 的既有惯例
 *     一致（`src/lib/core/repository-base.ts`）。
 */

import { AppError, NotFoundError } from "./errors";

/**
 * 从 `returning()` 结果里取首行；**缺席即抛内部错误**。
 *
 * 用在「写入必然产生一行」的路径：INSERT、以及对已知存在行的 UPDATE。
 *
 * @param rows `returning()` 的结果数组
 * @param what 出错信息里的人读主语（如 `"用户插入"`）
 */
export function firstRowRequired<T>(rows: T[], what: string): T {
  const row = rows.at(0);
  /* 判据是 `=== undefined` 而不是 `!row`：本函数是**泛型**的，`T` 今天是 Drizzle
   * 的行对象（永远真值），但签名上没有任何东西保证这一点 —— 一个 `T = number`
   * 的调用点传进 `[0]` 就会被 `!row` 误判成「缺席」并抛内部错误，而那是**数据错了
   * 却被报成我方故障**。缺席这件事的准确表达就是「有没有元素」。 */
  if (row === undefined) throw new AppError(`${what}未返回记录`);
  return row;
}

/**
 * 从 `returning()` 结果里取首行；**缺席即抛「目标不存在」**。
 *
 * 用在按 id / 唯一键更新的路径：`returning()` 返回空数组正是「没有匹配行」
 * 的信号，不该把它冒充成实体传下去。
 *
 * @param rows `returning()` 的结果数组
 * @param what 出错信息里的人读主语（如 `` `用户不存在: ${id}` ``）
 */
export function firstRowOfExisting<T>(rows: T[], what: string): T {
  const row = rows.at(0);
  /* 同 `firstRowRequired`：判「有没有元素」，不判「值真不真」。这里误判的后果更重
   * —— 把一条真记录报成 404 会让调用方以为它不存在，从而**重写一遍**。 */
  if (row === undefined) throw new NotFoundError(what);
  return row;
}
