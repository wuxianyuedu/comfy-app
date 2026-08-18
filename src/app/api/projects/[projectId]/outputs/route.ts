import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/* ── 项目级产出列表 ──
 * 给定画布项目 id（localStorage CanvasProject.id），返回该项目下所有生成任务
 * 及其元数据 + 产出文件，供「产出 tab」与右侧元数据抽屉消费。
 * 兼容 Next 15 的 async params。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  if (!projectId) {
    return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
  }
  try {
    const tasks = await prisma.task.findMany({
      where: { projectId },
      include: { images: { orderBy: { sortIndex: "asc" } } },
      orderBy: { createdAt: "desc" },
    });

    const outputs = tasks.map((t) => {
      const params = (t.params ?? {}) as Record<string, any>;
      return {
        id: t.id,
        type: t.type,
        status: t.status,
        workflowName: t.workflowName,
        prompt: t.prompt,
        negativePrompt: t.negativePrompt,
        seed: typeof params.seed === "number" || typeof params.seed === "string"
          ? String(params.seed)
          : null,
        size: typeof params.size === "string" ? params.size : null,
        sampler: params.sampler ?? null,
        steps: params.steps ?? null,
        cfg: params.cfg ?? null,
        checkpoint: params.checkpoint ?? null,
        referenceImages: (t.referenceImages as string[] | null) ?? [],
        createdAt: t.createdAt,
        images: t.images.map((img) => ({
          id: img.id,
          localPath: img.localPath,
          mediaType: img.mediaType,
          seed: img.seed,
          width: img.width,
          height: img.height,
          isCover: img.isCover,
        })),
      };
    });

    return NextResponse.json({ outputs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "查询失败" }, { status: 500 });
  }
}
