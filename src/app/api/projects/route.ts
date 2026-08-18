import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List all projects for the current user (newest first). */
export async function GET() {
  const user = await getServerUser();
  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json(projects);
}

/**
 * Upsert a project.  The client generates a stable `proj_...` id (reused as
 * Task.projectId), so we upsert on that id.  The first write creates the row
 * under the current user; subsequent writes just update name/nodes/edges.
 */
export async function POST(req: NextRequest) {
  const user = await getServerUser();
  let body: { id?: unknown; name?: unknown; nodes?: unknown; edges?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const id = body.id;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const data = {
    name: typeof body.name === "string" && body.name ? body.name : "未命名",
    nodes: Array.isArray(body.nodes) ? body.nodes : [],
    edges: Array.isArray(body.edges) ? body.edges : [],
  };
  const project = await prisma.project.upsert({
    where: { id },
    create: { id, userId: user.id, ...data },
    update: data,
  });
  return NextResponse.json(project);
}
