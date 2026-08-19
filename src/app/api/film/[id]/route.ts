import { prisma } from "@/lib/db";
import { defineRoute, NotFoundError } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 迁移说明：原路由手写 getServerUser + 404 返回 {error:"影片不存在"}。
// 现统一到 defineRoute（强制鉴权 + 错误归一化），404 抛 NotFoundError，
// legacyError:true 保持旧错误信封 {error:string}，成功体 {film} 不变。

export const GET = defineRoute(async ({ params, user }) => {
  const { id } = params;
  const film = await prisma.filmProject.findFirst({
    where: { id, userId: user.id },
    include: { shots: { orderBy: { order: "asc" } } },
  });
  if (!film) throw new NotFoundError("影片不存在");
  return { film };
}, { legacyError: true });
