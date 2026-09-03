import "server-only";

import { db } from "~/server/db";
import { auditLog } from "~/server/db/schema";
import { logger } from "~/server/lib/logger";

/**
 * 审计日志（安全事件留痕）：登录失败、提权、删除、导出等敏感操作调用。
 *
 * - 先打结构化日志，再异步落库；审计写入失败绝不阻塞主流程。
 * - 只记录 userId/ip/事件类型/meta，不外泄 PII。
 *
 * 用法：
 *   await audit("login_failed", { session: ctx.session, headers: ctx.headers }, { email });
 */
export type AuditEvent =
  | "login_failed"
  | "role_changed"
  | "post_deleted"
  | "data_exported"
  | "task_deleted"
  | "project_deleted"
  | "settings_changed";

export async function audit(
  event: AuditEvent,
  ctx: {
    session: { user?: { id: string } } | null;
    headers: Headers;
  },
  meta: Record<string, unknown> = {},
): Promise<void> {
  const ip = ctx.headers.get("x-forwarded-for") ?? "unknown";
  const userId = ctx.session?.user?.id ?? null;

  logger.warn({ event, userId, ip, ...meta }, "audit");

  await db
    .insert(auditLog)
    .values({
      event,
      userId,
      ip,
      meta: JSON.stringify(meta),
    })
    .catch((err) => {
      // 审计失败不能影响主流程，只记日志
      logger.error({ err, event }, "audit_write_failed");
    });
}
