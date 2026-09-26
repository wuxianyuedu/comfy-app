/**
 * `repository-task-impl-types.ts` — impl 工厂的**共享类型**。
 *
 * 单独一个文件的原因：`repository-task-impl.ts` 需要 `TaskRepoDb` 类型、
 * `repository-task-impl.test.ts` 也需要用它做 `as unknown as TaskRepoDb` 断言
 * （把 better-sqlite3 内存测试库塞给本应吃 libsql 客户端的 impl 工厂）。把
 * 类型抽出来一处，实现文件与测试都从这里 import，避免两边各自定义漂移。
 *
 * 本文件只有 type export、无运行时。
 */
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import type * as appSchema from "~/server/db/schema";

/**
 * 13 个 exec-chain 方法需要的 drizzle 客户端形状。
 *
 * 为什么写成 `LibSQLDatabase<typeof appSchema>`：Next 侧 (`src/server/db.ts`)
 * 与未来的 executor host（P3 §5 ADR 附录 §11.1）都用 `@libsql/client` +
 * `drizzle-orm/libsql` 同一条链，返回类型即此。测试层用
 * `drizzle-orm/better-sqlite3` 造内存实例，与本类型在结构上不匹配——
 * **测试文件里**做一次 `as unknown as TaskRepoDb` 的窄断言即可；这不是
 * 「实现层的抽象妥协」，而是「测试基建选型与运行时的差异」，锁在测试文件
 * 里更诚实。
 *
 * 不锁 `.query` relational：本文件服务的 13 方法全部走 `.select/.update/.insert`
 * builder；relational 的三个方法（`findById` / `listByUser` / `findByProject`）
 * 留在 `repository-task.ts`，host 不加载。
 */
export type TaskRepoDb = LibSQLDatabase<typeof appSchema>;
