import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { cancelTraining } from "@/lib/comfyui/trainer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getServerUser();
  const job = await prisma.loraTrainingJob.findFirst({
    where: { id, userId: user.id },
    select: { id: true, status: true },
  });
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  await cancelTraining(job.id);
  return NextResponse.json({ ok: true });
}
