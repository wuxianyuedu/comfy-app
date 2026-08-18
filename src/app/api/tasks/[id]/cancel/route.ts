import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { cancelTask } from "@/lib/comfyui/runner";

/** R-ardot114 (2026-08-17): escape hatch for a Task stuck in QUEUED /
 *  RUNNING with no visible progress.  Until this landed the user had
 *  no way to recover a raw-UI-format workflow whose runner slot got
 *  stuck (s.active not released) — the only option was restart the
 *  dev server.  After this endpoint, anyone (UI or curl) can
 *  cancel-and-recover a single task without touching the server.
 *
 *  Idempotent: cancelling a non-running task is a no-op and returns 200.
 *  Race-safe: cancelTask() does its own interrupt() + DB update so
 *  even if the runner wakes up concurrently and finalises the task,
 *  the final status is whichever lands last — both are terminal.
 *
 *  Reason codes in the cancel body are surfaced into `Task.error`
 *  so the canvas node's `d.error` field shows context like "用户取消"
 *  vs "stuck-queue reset". */
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ ok: false, error: "missing taskId" }, { status: 400 });
  }

  let body: { reason?: string } = {};
  try {
    body = (await req.json()) as { reason?: string };
  } catch {
    /* allow empty body */
  }
  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim().slice(0, 200)
    : "用户取消";

  try {
    const before = await prisma.task.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!before) {
      return Response.json({ ok: false, error: "task not found" }, { status: 404 });
    }
    if (before.status !== "RUNNING" && before.status !== "QUEUED") {
      /* already terminal — just report and exit idempotently */
      return Response.json({ ok: true, status: before.status, changed: false });
    }
    /* Stash reason into `error` BEFORE cancelTask wipes it; cancelTask
     * sets status=CANCELLED but doesn't touch `error`, so we'll set it
     * here first via a brief update, then call cancelTask for the
     * runner-side cleanup. */
    await prisma.task.update({
      where: { id },
      data: { error: reason },
    });
    await cancelTask(id);
    const after = await prisma.task.findUnique({
      where: { id },
      select: { status: true },
    });
    return Response.json({
      ok: true,
      status: after?.status ?? "CANCELLED",
      changed: true,
    });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "cancel failed",
      },
      { status: 500 }
    );
  }
}
