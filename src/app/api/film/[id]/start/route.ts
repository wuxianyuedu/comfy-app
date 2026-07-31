import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { startFilm } from "@/lib/film/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getServerUser();
  const film = await prisma.filmProject.findFirst({ where: { id, userId: user.id } });
  if (!film) return NextResponse.json({ error: "影片不存在" }, { status: 404 });
  if (film.status === "GENERATING" || film.status === "COMPOSING") {
    return NextResponse.json({ error: "影片正在生成中" }, { status: 409 });
  }
  await startFilm(id);
  return NextResponse.json({ ok: true });
}
