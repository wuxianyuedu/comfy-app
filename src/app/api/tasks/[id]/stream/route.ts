import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { subscribe, type TaskEvent } from "@/lib/comfyui/runner";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      // Initial state (covers tasks already finished before subscribe).
      prisma.task
        .findUnique({ where: { id } })
        .then((t) => {
          if (t) {
            send({ type: "state", status: t.status, progress: t.progress, error: t.error });
            const existing = (t.logs as any[]) ?? [];
            existing.forEach((entry) => send({ type: "log", entry }));
          }
        })
        .catch(() => {});

      const unsub = subscribe(id, (e: TaskEvent) => {
        send(e);
        if (e.type === "done" || e.type === "error") {
          try {
            controller.close();
          } catch {}
          unsub();
        }
      });

      req.signal.addEventListener("abort", () => {
        try {
          controller.close();
        } catch {}
        unsub();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
