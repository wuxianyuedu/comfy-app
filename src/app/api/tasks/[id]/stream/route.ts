import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { taskRepository } from "@/lib/core/repository";
import { subscribe, type TaskEvent } from "@/lib/comfyui/runner";
import { parseValidationErrors } from "@/lib/comfyui/validation";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const params = await ctx.params;
  const id = params.id;

  // R-T3-phase4: native Route Handler — replaces the legacy `defineRoute`
  // wrapper.  Auth contract is kept identical (401 structured envelope).
  const user = await getServerUser();
  if (!user?.id) {
    return NextResponse.json(
      { error: { code: "auth.required", message: "未登录或会话已失效" } },
      { status: 401 }
    );
  }

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
      taskRepository
        .findById(id)
        .then((task) => {
          if (task) {
            // R-Next (2026-08-17): forward structured validation errors so
            //  consumers (CreatePanel) can render a per-field list instead of
            //  the English summary in `error`.
            send({
              type: "state",
              status: task.status,
              progress: task.progress,
              error: task.error,
              validationErrors: parseValidationErrors(task.validationErrors),
              /* R-ardot121 (2026-08-18): forward workflowName so the
               *  GlobalStepLogPanel task-switcher can label the entry
               *  ("<name> · STATUS") instead of a bare 14-char id. */
              workflowName: task.workflowName,
            });
            lastSent.status = task.status;
            lastSent.progress = task.progress ?? 0;
            // logs 是 Prisma Json 列(运行时为 LogEntry[];send 收 unknown,无需断言)。
            const existing: unknown[] = Array.isArray(task.logs) ? task.logs : [];
            existing.forEach((entry) => send({ type: "log", entry }));
          }
        })
        .catch(() => {
          /* 初始回放失败可忽略 — 订阅与轮询随后仍会推送状态 */
        });

      const unsub = subscribe(id, (e: TaskEvent) => {
        send(e);
        if (e.type === "done" || e.type === "error") {
          try {
            controller.close();
          } catch {
            /* SSE already closed — ignore */
          }
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
        taskRepository
          .findById(id)
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
        } catch {
          /* interval already cleared — ignore */
        }
        try {
          clearInterval(pollId);
        } catch {
          /* interval already cleared — ignore */
        }
        try {
          controller.close();
        } catch {
          /* stream already closed — ignore */
        }
        unsub();
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
