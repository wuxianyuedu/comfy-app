import { type NextRequest, NextResponse } from "next/server";
import { currentServerUser } from "~/server/auth/request-user";
import { taskRepository } from "~/lib/core/repository";
import { getLogs, subscribe } from "~/lib/comfyui/enqueue";
import type { TaskEvent } from "~/lib/comfyui/runner-state";
import { parseValidationErrors } from "~/lib/comfyui/validation";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params;
  const id = params.id;

  // 原生 Route Handler —— 取代了旧的 `defineRoute` 包装器。
  // 鉴权契约保持一致（未登录时返回结构化的 401 信封）。
  const user = await currentServerUser();
  if (!user?.id) {
    return unauthorizedResponse();
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      /* 下面「初始回放」与「数据库实情轮询」两处共用。
       * 两者必须读写同一个变量，否则轮询会在初始发送之后
       * 立刻把同一个状态再发一遍。 */
      const lastSent: { status: string; progress: number } = {
        status: "",
        progress: 0,
      };

      // 初始状态（覆盖「订阅之前任务就已经结束」的情形）。
      taskRepository
        .findById(id)
        .then((task) => {
          if (task) {
            // logs 是 Prisma Json 列(运行时为 LogEntry[];send 收 unknown,无需断言)。
            const existing: unknown[] = Array.isArray(task.logs)
              ? task.logs
              : [];
            // 优先回放 runner 内存日志（state().logs），它是每次 log() 写入的完整
            // 现场、也是持久化到 DB 的源，恒为 DB 日志的超集。enqueue()/processQueue()
            // 在 startGenerate 返回前、前端 EventSource 尚未订阅时就会输出
            // 「任务已加入执行队列」「输入参数（workflowInputs，N 项）」等行；这些行
            // 落库走 200ms 防抖，若 SSE 在防抖窗口内连接，只读 DB 会漏掉它们，
            // 表现为「第二次执行（WS 已开，processQueue 同步发日志）没有显示执行参数」。
            // 这里改读内存日志兜底：内存为空（如服务器重启）时回落 DB 日志。
            const inMemory = getLogs(id);
            const replaySrc = inMemory.length > 0 ? inMemory : existing;
            // 回放顺序必须「先日志、后终态 state」：前端 watchTask 在处理 state 的
            // 终态（FAILED/CANCELLED/ERROR）分支时会立即 settle 并关闭 EventSource，
            // 若把 state 排在日志前面，后续 log 帧会被丢弃，用户只看到「等待日志…」
            // 而看不到失败原因（任务在 SSE 建立前就已终态时必现）。
            replaySrc.forEach((entry) => send({ type: "log", entry }));
            // 把结构化校验错误透出去，好让消费方（CreatePanel）
            // 渲染出精确到字段的列表，而不是 `error` 里那句英文摘要。
            send({
              type: "state",
              status: task.status,
              progress: task.progress,
              error: task.error,
              validationErrors: parseValidationErrors(task.validationErrors),
              /* 把 workflowName 透出去，好让 GlobalStepLogPanel 的任务切换器
               * 用「<名称> · 状态」给条目打标签，而不是一个光秃秃的 14 字符 id。 */
              workflowName: task.workflowName,
            });
            lastSent.status = task.status;
            lastSent.progress = task.progress ?? 0;
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
            /* SSE 已关闭 —— 忽略 */
          }
          unsub();
        }
      });

      /* SSE 心跳。若长时间没有字节流动，操作系统 / 负载均衡 / 代理会在看似空闲
       * 30–60s 后悄悄掐掉这个 socket（QUEUED 中的任务很常见：可能几分钟都没有
       * `log` 事件），随后浏览器侧的 EventSource 会自动重连 ——
       * 于是界面被「📡 / ⚪ 已订阅 / 任务状态」这类客户端日志刷屏，
       * 而实际上什么都没变。SSE 注释行 `: hb\n\n` 对 EventSource 的
       * onmessage 处理器不可见，却能刷新内核的 TCP 空闲计时器。
       * 15s 远小于多数代理的空闲超时（通常 30–60s）。abort 时清除。 */
      const hbId = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`));
        } catch {
          /* controller 已关闭 —— 清掉定时器并退出 */
          clearInterval(hbId);
        }
      }, 15000);

      /* 数据库「实情」轮询。执行器内存里的 `emitter` 只为
       * **执行器自己产生**的事件发消息（progress / log / done / error）。
       * 外部导致的状态变化 —— cancelTask()（在此次修复前它只写数据库）、
       * instrumentation.ts 对「僵尸 RUNNING」任务的对账，
       * 或任何其它改 Task.status 的代码路径 —— 都到不了 SSE 订阅方。
       * 这里每 3s 轮一次：只要数据库里的状态 / 进度与上次发出的快照不同，
       * 就补发一个 `state` 事件，于是即使某条代码路径忘了调 emitter.emit()，
       * 前端的 d.status 也不会卡住。abort 时关闭；
       * 同时最多只允许一次轮询在途，避免堆积。 */
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
            /* 数据库抖了一下 —— 下一个 tick 再试 */
          })
          .finally(() => {
            polling = false;
          });
      }, 3000);

      req.signal.addEventListener("abort", () => {
        try {
          clearInterval(hbId);
        } catch {
          /* 定时器已经清过了 —— 忽略 */
        }
        try {
          clearInterval(pollId);
        } catch {
          /* 定时器已经清过了 —— 忽略 */
        }
        try {
          controller.close();
        } catch {
          /* 流已经关了 —— 忽略 */
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
