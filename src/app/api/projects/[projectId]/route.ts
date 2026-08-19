/**
 * `/api/projects/[projectId]` —— 单项目读 / 改 / 删
 *
 * 与列表路由一致，本文件只表达业务意图，认证、错误归一化、JSON 解析由
 * {@link defineRoute} / {@link requireJsonBody} 统一处理；持久化走
 * {@link ProjectRepository}，且通过 DI 容器 `container.resolve("projectRepository")`
 * 取得。所有查询按 `userId` 隔离，杜绝越权访问。
 *
 * 响应形态与旧实现一致（GET/PATCH 返回对象或 404，DELETE 返回 `{ ok: true }`），
 * 前端无需改动。
 */
import { defineRoute, requireJsonBody, container, NotFoundError, ValidationError } from "@/lib/core";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 读取单条项目；不属于当前用户或不存在 → 404。 */
export const GET = defineRoute(async ({ user, params }) => {
  const projectRepository = container.resolve("projectRepository");
  const project = await projectRepository.findById(params.projectId);
  if (!project || project.userId !== user.id) {
    throw new NotFoundError("项目不存在");
  }
  return project;
});

/** 部分更新 name / nodes / edges。 */
export const PATCH = defineRoute(async ({ req, user, params }) => {
  const projectRepository = container.resolve("projectRepository");
  const existing = await projectRepository.findById(params.projectId);
  if (!existing || existing.userId !== user.id) {
    throw new NotFoundError("项目不存在");
  }

  const body = await requireJsonBody(req);
  const patch: { name?: string; nodes?: Prisma.JsonValue; edges?: Prisma.JsonValue } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      throw new ValidationError("name 必须为字符串");
    }
    patch.name = body.name;
  }
  if (body.nodes !== undefined) {
    if (!Array.isArray(body.nodes)) {
      throw new ValidationError("nodes 必须为数组");
    }
    patch.nodes = body.nodes as Prisma.JsonValue;
  }
  if (body.edges !== undefined) {
    if (!Array.isArray(body.edges)) {
      throw new ValidationError("edges 必须为数组");
    }
    patch.edges = body.edges as Prisma.JsonValue;
  }

  return projectRepository.update(params.projectId, patch);
});

/** 删除项目（仅当归属当前用户）。 */
export const DELETE = defineRoute(async ({ user, params }) => {
  const projectRepository = container.resolve("projectRepository");
  await projectRepository.deleteForUser(user.id, params.projectId);
  return { ok: true };
});
