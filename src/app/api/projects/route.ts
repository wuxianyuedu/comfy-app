/**
 * `GET /api/projects`    —— 列出当前用户全部项目（按更新时间倒序）
 * `POST /api/projects`   —— Upsert 一个项目（客户端生成稳定 `proj_*` 主键）
 *
 * 本路由采用**核心层驱动**写法：认证、错误归一化、JSON 解析全部收敛到
 * {@link defineRoute} / {@link requireJsonBody}，本文件只剩纯粹的业务意图，
 * 不再散落 `try/catch`。持久化访问走 {@link ProjectRepository}，且**通过 DI 容器
 * `container.resolve("projectRepository")` 取得**，不直接 import 单例、不直接碰 Prisma
 * （依赖倒置，便于替换/测试）。
 *
 * 响应形态与旧实现保持一致（GET 返回数组、POST 返回对象），前端无需改动。
 */
import { defineRoute, requireJsonBody, container, ValidationError } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列出当前用户的所有项目（最新在前）。 */
export const GET = defineRoute(async ({ user }) => {
  const projectRepository = container.resolve("projectRepository");
  return projectRepository.listByUser(user.id);
});

/**
 * Upsert 项目。客户端生成稳定 `proj_*` id（同时用作 `Task.projectId`），
 * 首次写入建行并归属当前用户，之后仅更新 name/nodes/edges。
 */
export const POST = defineRoute(async ({ req, user }) => {
  const projectRepository = container.resolve("projectRepository");
  const body = await requireJsonBody(req);

  const id = body.id;
  const name = body.name;
  if (typeof id !== "string" || id.length === 0) {
    throw new ValidationError("id 必须为非空字符串");
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new ValidationError("name 必须为非空字符串");
  }

  return projectRepository.upsertForUser(user.id, {
    id,
    name,
    nodes: body.nodes,
    edges: body.edges,
  });
});
