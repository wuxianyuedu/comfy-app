import { prisma } from "@/lib/db";
import { defineRoute, NotFoundError } from "@/lib/core";
import { cancelFilm } from "@/lib/film/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 迁移说明：手写 getServerUser + 404 返回 {error:"影片不存在"} → defineRoute +
// NotFoundError；legacyError:true 保持 {error:string}；成功体 {ok:true} 不变。

export const POST = defineRoute(async ({ params, user }) => {
  const { id } = params;
  const film = await prisma.filmProject.findFirst({ where: { id, userId: user.id } });
  if (!film) throw new NotFoundError("影片不存在");
  await cancelFilm(id);
  return { ok: true };
}, { legacyError: true });
