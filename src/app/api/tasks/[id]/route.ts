import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: { images: { orderBy: { sortIndex: "asc" } } },
  });
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Delete image files on disk as well.
    const task = await prisma.task.findUnique({
      where: { id },
      include: { images: true },
    });
    if (task) {
      const fsPromises = await import("fs/promises");
      const path = await import("path");
      for (const img of task.images) {
        const full = path.join(process.cwd(), "public", img.localPath.replace(/^\//, ""));
        fsPromises.unlink(full).catch(() => {});
      }
      const dir = path.join(process.cwd(), "public", "generated", id);
      fsPromises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    await prisma.task.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "删除失败" }, { status: 500 });
  }
}
