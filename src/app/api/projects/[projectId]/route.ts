import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read a single project (must belong to the current user). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const user = await getServerUser();
  const project = await prisma.project.findFirst({
    where: { id: params.projectId, userId: user.id },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(project);
}

/** Patch name / nodes / edges (partial updates allowed). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const user = await getServerUser();
  const existing = await prisma.project.findFirst({
    where: { id: params.projectId, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let body: { name?: unknown; nodes?: unknown; edges?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const data: { name?: string; nodes?: unknown; edges?: unknown } = {};
  if (typeof body.name === "string") data.name = body.name;
  if (Array.isArray(body.nodes)) data.nodes = body.nodes;
  if (Array.isArray(body.edges)) data.edges = body.edges;
  const project = await prisma.project.update({
    where: { id: params.projectId },
    data,
  });
  return NextResponse.json(project);
}

/** Hard-delete a project (mirrors canvas-store deleteProject). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const user = await getServerUser();
  await prisma.project.deleteMany({
    where: { id: params.projectId, userId: user.id },
  });
  return NextResponse.json({ ok: true });
}
