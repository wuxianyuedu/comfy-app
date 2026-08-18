import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { subscribe, type TaskEvent } from "@/lib/comfyui/runner";
import { parseValidationErrors } from "@/lib/comfyui/validation";

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

      /* R-ardot114 (2026-08-17): shared by the initial replay send
       *  below and the DB-poller below.  Both must read/write
       *  through the same variable so the poller doesn't re-fire
       *  the same status immediately after the initial send. */
      const lastSent: { status: string; progress: number } = {
        status: "",
        progress: 0,
      };

      // Initial state (covers tasks already finished before subscribe).
      prisma.task
        .findUnique({ where: { id } })
        .then((t) => {
          if (t) {
            // R-Next (2026-08-17): forward structured validation errors so
            //  consumers (CreatePanel) can render a per-field list instead of
            //  the English summary in `error`.
            send({
              type: "state",
              status: t.status,
              progress: t.progress,
              error: t.error,
              validationErrors: parseValidationErrors(t.validationErrors),
              /* R-ardot121 (2026-08-18): forward workflowName so the
               *  GlobalStepLogPanel task-switcher can label the entry
               *  ("<name> · STATUS") instead of a bare 14-char id. */
              workflowName: t.workflowName,
            });
            lastSent.status = t.status;
            lastSent.progress = t.progress ?? 0;
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

      /* R-ardot114 (2026-08-17): SSE heartbeat.  Without periodic
       *  bytes the OS / load balancer / proxy can silently close the
       *  socket after 30-60s of apparent idle (common for tasks in
       *  QUEUED where no `log` event fires for minutes), and the
       *  browser-side EventSource then auto-reconnects — flooding the
       *  UI with 📡 / ⚪ "已订阅 / 任务状态" client logs while
       *  nothing actually changed.  An SSE comment line `: hb\n\n`
       *  is invisible to the EventSource onmessage handler but
       *  refreshes the kernel TCP idle timer.  15s is well under most
       *  proxy idle timeouts (typically 30-60s).  Cleared on abort. */
      const hbId = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`));
        } catch {
          /* controller closed — clear and bail */
          clearInterval(hbId);
        }
      }, 15000);

      /* R-ardot114 (2026-08-17): DB truth-poller.  The runner's
       *  in-memory `emitter` only fires for events *the runner
       *  itself produces* (progress/log/done/error).  External
       *  status changes — cancelTask() (which only wrote the DB
       *  before this commit), instrumentation.ts reconciling a
       *  zombie RUNNING task, or any other code path that mutates
       *  Task.status — never reach the SSE subscriber.  Polling
       *  every 3s re-emits a `state` event when the DB's status /
       *  progress changes since the last sent snapshot, so the
       *  frontend's d.status cannot get stuck even if a code path
       *  forgets to call emitter.emit().  Closed on abort; capped
       *  to one poll in-flight to avoid pile-up. */
      let polling = false;
      const pollId = setInterval(() => {
        if (polling) return;
        polling = true;
        prisma.task
          .findUnique({
            where: { id },
            // R-ardot116 (2026-08-18): include `error` + `validationErrors`
            // in the polling snapshot so a status transition can deliver
            // the structured diagnostic *as part of the same state event*.
            // Without this, if the runner's finalizeFailure ever forgot to
            // emit a `state` event, the client would only see the bare
            // status flip and would have to wait for a manual SSE
            // reconnect to fetch the diagnostic from the initial state
            // snapshot — which is exactly the stuck-generated bug we just
            // patched in the runner's finalizeFailure.
            select: {
              status: true,
              progress: true,
              error: true,
              validationErrors: true,
              /* R-ardot121 (2026-08-18): poll workflowName too so the
               *  dropdown label survives status transitions (e.g. a
               *  QUEUED task finally flipping to RUNNING). */
              workflowName: true,
            },
          })
          .then((cur) => {
            if (!cur) return;
            if (
              cur.status !== lastSent.status ||
              cur.progress !== lastSent.progress
            ) {
              lastSent.status = cur.status;
              lastSent.progress = cur.progress ?? 0;
              send({
                type: "state",
                status: cur.status,
                progress: cur.progress ?? 0,
                error: cur.error,
                validationErrors: parseValidationErrors(cur.validationErrors),
                workflowName: cur.workflowName,
              });
              if (
                cur.status === "SUCCEEDED" ||
                cur.status === "FAILED" ||
                cur.status === "CANCELLED"
              ) {
                try {
                  controller.close();
                } catch {
                  /* ignore */
                }
                clearInterval(pollId);
                clearInterval(hbId);
                unsub();
              }
            }
          })
          .catch(() => {
            /* DB blip — try again next tick */
          })
          .finally(() => {
            polling = false;
          });
      }, 3000);

      req.signal.addEventListener("abort", () => {
        try {
          clearInterval(hbId);
        } catch {}
        try {
          clearInterval(pollId);
        } catch {}
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
