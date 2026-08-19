import { NextRequest } from "next/server";
import {
  container,
  defineRoute,
  requireJsonBody,
  ValidationError,
  NotFoundError,
  ConflictError,
} from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Workflow model-tag library (user-level global) ─────────────────────────
// A single user owns a flat, de-duplicated set of model-name tags
// (e.g. "z-image", "wan2.2").  Tags are referenced by many workflows via an
// implicit many-to-many relation (WorkflowTemplate.modelTags).  These routes
// let the UI list / create / delete tags — the library is shared across all
// of a user's workflows so the same model name need only be typed once.
//
// 本文件已迁移到 core 的 `defineRoute` + `WorkflowModelTagRepository`：
// - 认证、错误归一化、JSON 信封由框架统一处理；
// - 数据访问收口到仓储，路由只描述业务（不再裸写 prisma）；
// - `legacyError: true` 保持旧客户端契约：错误信封为 `{ error: string }`。

/** GET /api/workflow-models → 该用户全部标签，附各自被引用次数，按名称字母序。 */
export const GET = defineRoute(async ({ user }) => {
  const repo = container.resolve("workflowModelTagRepository");
  const tags = await repo.listByUser(user.id);
  // 保持原响应体 `{ tags: [...] }` 不变（defineRoute 原样下发 handler 返回值）。
  return { tags };
}, { legacyError: true });

/** POST /api/workflow-models → 新增标签（幂等：同名已存在则返回原记录）。
 *  Body: { name: string }。 */
export const POST = defineRoute(async ({ req, user }) => {
  const repo = container.resolve("workflowModelTagRepository");
  const body = await requireJsonBody(req);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new ValidationError("标签名称不能为空");
  if (name.length > 64) throw new ValidationError("标签名称过长（最多 64 字符）");
  const tag = await repo.upsertByName(user.id, name);
  return { tag };
}, { legacyError: true });

/** PATCH /api/workflow-models → 重命名标签（绑定关系按 tag id 保留，改名不破坏）。
 *  Body: { oldName, newName }。
 *  错误：空/超长 → 400；oldName 不存在 → 404；newName 冲突 → 409。 */
export const PATCH = defineRoute(async ({ req, user }) => {
  const repo = container.resolve("workflowModelTagRepository");
  const body = await requireJsonBody(req);
  const oldName = typeof body.oldName === "string" ? body.oldName.trim() : "";
  const newName = typeof body.newName === "string" ? body.newName.trim() : "";
  if (!oldName || !newName) {
    throw new ValidationError("原名称和新名称都不能为空");
  }
  if (newName.length > 64) {
    throw new ValidationError("标签名称过长（最多 64 字符）");
  }
  // 同名视为幂等成功，不报错（保持原行为 ok:false / reason:"same-name"）。
  if (oldName === newName) {
    return { ok: true, renamed: false, reason: "same-name" };
  }
  const existing = await repo.findByUserAndName(user.id, oldName);
  if (!existing) {
    throw new NotFoundError(`标签「${oldName}」不存在`);
  }
  const collision = await repo.findByUserAndName(user.id, newName);
  if (collision) {
    throw new ConflictError(`标签「${newName}」已存在，请换一个名字`);
  }
  const tag = await repo.rename(existing.id, newName);
  return { ok: true, renamed: true, tag };
}, { legacyError: true });

/** DELETE /api/workflow-models → 删除标签（及其工作流关联，级联清理）。
 *  Body: { name: string }。不存在时返回 ok:true / deleted:false（幂等）。 */
export const DELETE = defineRoute(async ({ req, user }) => {
  const repo = container.resolve("workflowModelTagRepository");
  const body = await requireJsonBody(req);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new ValidationError("标签名称不能为空");
  const existing = await repo.findByUserAndName(user.id, name);
  // 不存在 → 视为幂等成功，保持原 `{ ok: true, deleted: false }`。
  if (!existing) return { ok: true, deleted: false };
  await repo.deleteById(existing.id);
  return { ok: true, deleted: true };
}, { legacyError: true });
