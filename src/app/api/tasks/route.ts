import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List the current user's tasks (their "我的作品" gallery).
export async function GET(req: NextRequest) {
  const user = await getServerUser();
  const url = new URL(req.url);
  const take = Math.min(Number(url.searchParams.get("take") ?? 60), 200);

  const tasks = await prisma.task.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      images: { where: { isCover: true }, take: 1 },
    },
  });

  const list = tasks.map((t) => {
    const p = (t.params as Record<string, any>) ?? {};
    return {
      id: t.id,
      type: t.type,
      workflowName: t.workflowName,
      status: t.status,
      prompt: t.prompt,
      createdAt: t.createdAt,
      cover: t.images[0]?.localPath ?? null,
      checkpoint: p.checkpoint ?? null,
    };
  });

  return NextResponse.json({ tasks: list });
}
