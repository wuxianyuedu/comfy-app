import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth";
import { createFilm, isFFmpegAvailable } from "@/lib/film/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  title: z.string().min(1).max(160).default("未命名影片"),
  script: z.string().min(1, "请先输入剧本或创意"),
  type: z.string().max(40).optional(),
  styleSlug: z.string().max(120).nullable().optional(),
  size: z.string().max(20).optional(),
  fps: z.number().int().min(1).max(60).optional(),
  framesPerShot: z.number().int().min(9).max(241).optional(),
  subtitleOn: z.boolean().optional(),
  bgmName: z.string().max(200).nullable().optional(),
});

export async function GET() {
  const user = await getServerUser();
  const films = await prisma.filmProject.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      status: true,
      progress: true,
      finalVideo: true,
      createdAt: true,
      _count: { select: { shots: true } },
    },
  });
  return NextResponse.json({
    films: films.map((f) => ({
      id: f.id,
      title: f.title,
      status: f.status,
      progress: f.progress,
      finalVideo: f.finalVideo,
      shotCount: (f._count as any).shots,
      createdAt: f.createdAt,
    })),
    ffmpegAvailable: await isFFmpegAvailable(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }
  const d = parsed.data;
  const user = await getServerUser();

  const { id, shots } = await createFilm({
    userId: user.id,
    title: d.title,
    script: d.script,
    type: d.type,
    styleSlug: d.styleSlug,
    size: d.size,
    fps: d.fps,
    framesPerShot: d.framesPerShot,
    subtitleOn: d.subtitleOn,
    bgmName: d.bgmName,
  });

  return NextResponse.json({ id, shotCount: shots });
}
