import { prisma } from "@/lib/db";
import { defineRoute, NotFoundError, ConflictError } from "@/lib/core";
import { startFilm } from "@/lib/film/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 迁移说明：手写 getServerUser + 404/409 {error:string} → defineRoute +
// NotFoundError / ConflictError；legacyError:true 保持旧信封；成功体 {ok:true} 不变。

export const POST = defineRoute(async ({ params, user }) => {
  const { id } = params;
  const film = await prisma.filmProject.findFirst({ where: { id, userId: user.id } });
  if (!film) throw new NotFoundError("影片不存在");
  if (film.status === "GENERATING" || film.status === "COMPOSING") {
    throw new ConflictError("影片正在生成中");
  }
  await startFilm(id);
  return { ok: true };
}, { legacyError: true });
