import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getServerUser();
  const film = await prisma.filmProject.findFirst({
    where: { id, userId: user.id },
    include: { shots: { orderBy: { order: "asc" } } },
  });
  if (!film) return NextResponse.json({ error: "影片不存在" }, { status: 404 });
  return NextResponse.json({ film });
}
