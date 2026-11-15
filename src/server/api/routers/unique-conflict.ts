/**
 * `unique-conflict.ts` — 把 SQLite 唯一约束冲突翻译成 tRPC 业务 409 的共享出口。
 *
 * 背景（ISSUE #3849「唯一性检测」）：先查后写的入口必须有唯一索引兜底（§8.9 ②），
 * 而兜底命中时后到者原先拿到的是裸 `SQLITE_CONSTRAINT`（500）。有了唯一索引，
 * 冲突就是**业务语义的重复**（同名 / 同号 / 同镜头已在跑），应当按 409 CONFLICT
 * 回给调用方，而不是 500。多个 router 共用同一份翻译，列名 → 文案的映射由
 * 调用方给（它最清楚自己的业务键）。
 */
import { TRPCError } from "@trpc/server";
import { isSqliteUniqueViolation, sqliteUniqueColumns } from "~/lib/sqlite-error";

/**
 * @param error 捕获到的写库错误
 * @param mappings 列名 → 文案。`columns` 全部命中 `sqliteUniqueColumns` 的
 *   `table.column` 后缀即认为撞的是那条业务键（同表多条唯一索引各给各的话）。
 * @returns 永远返回一个 TRPCError，调用方 `throw uniqueConflict(error, […])`：
 *   不是唯一冲突时原样包成 500（不吞真故障），是唯一冲突但认不出列时给通用冲突话。
 */
export function uniqueConflict(
  error: unknown,
  mappings: Array<{ columns: Array<string>; message: string }>,
): TRPCError {
  const hit = sqliteUniqueColumns(error);
  for (const m of mappings) {
    if (m.columns.every((c) => hit.some((name) => name.endsWith(c)))) {
      return new TRPCError({ code: "CONFLICT", message: m.message });
    }
  }
  if (!isSqliteUniqueViolation(error)) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "写入失败",
      cause: error,
    });
  }
  return new TRPCError({ code: "CONFLICT", message: "数据冲突，请刷新后重试" });
}
