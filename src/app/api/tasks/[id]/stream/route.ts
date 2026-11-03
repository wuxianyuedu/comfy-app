import { type NextRequest, NextResponse } from "next/server";
import { requireRequestUser } from "~/server/auth/request-user";
import { taskRepository } from "~/lib/core/repository";
import { getLogs } from "~/lib/comfyui/enqueue";
import { parseValidationErrors } from "~/lib/comfyui/validation";
import { isTerminalTaskStatus } from "~/lib/task-state";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const id = params.id;

  // 原生 Route Handler —— 取代了旧的 `defineRoute` 包装器。
  // 鉴权契约保持一致（`loginRequired` 打开且未登录时返回结构化的 401 信封）。
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      /* 下面「初始回放」与「数据库轮询」两处共用同一组游标。
       * `lastSent`：已发出的状态快照（相同则不重发 state 帧）。
       * `sentLogCount`：已发出的日志条数——日志是**追加数组**，轮询按它做
       * 增量 diff 发 log 帧（P3 §5 ADR §13-3C：SSE 单源化，log/state 都以
       * DB 为准；初始回放读内存是为了接住 persistLogs 200ms 防抖窗口）。 */
      const lastSent: { nodeKey: string; progress: number; status: string } = {
        status: "",
        progress: 0,
        nodeKey: "",
      };
      let sentLogCount = 0;

      // 初始状态（覆盖「订阅之前任务就已经结束」的情形）。
      taskRepository
        .findById(id)
        .then((task) => {
          if (task) {
            // logs 是任务表的 JSON 列(运行时为 LogEntry[];send 收 unknown,无需断言)。
            const existing: Array<unknown> = Array.isArray(task.logs) ? task.logs : [];
            // 优先回放 runner 内存日志（getLogs），恒为 DB 日志超集：提交与领取在 EventSource
            // 订阅前就会输出「已从队列领取」「输入参数」等行，而落库走 200ms 防抖，
            // SSE 在防抖窗口内连接时只读 DB 会漏掉它们（ISSUE #1206）。
            // 内存为空（服务器重启）时回落 DB 日志；两者同源，不会矛盾。
            const inMemory = getLogs(id);
            const replaySrc = inMemory.length > 0 ? inMemory : existing;
            // 回放顺序必须「先日志、后终态 state」：前端 watchTask 在处理 state 的
            // 终态（FAILED/CANCELLED/ERROR）分支时会立即 settle 并关闭 EventSource，
            // 若把 state 排在日志前面，后续 log 帧会被丢弃，用户只看到「等待日志…」
            // 而看不到失败原因（任务在 SSE 建立前就已终态时必现）。
            replaySrc.forEach((entry) => {
              send({ type: "log", entry });
            });
            sentLogCount = replaySrc.length;
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
              // 当前执行节点（3-C D1：画布「当前节点+步数」随快照走 DB）
              node: task.progressNode,
              /*  成功终态必须带产出清单：客户端拿这一份 images 收口成功态
               * （P3 §5 ADR §13-3B1 手工端到端抓到的「完成不落定」）。done 帧
               * 那条进程内通道已随 §14 D1 退役，inline 与 host 因此同形。 */
              images: task.resultImages,
            });
            lastSent.status = task.status;
            lastSent.progress = task.progress ?? 0;
            lastSent.nodeKey = JSON.stringify(task.progressNode ?? null);
            /*  回放之前任务就已终态：轮询那条「与上次发出的快照不同才动作」的判据
             * 刚被这次回放喂成了恒假，于是再没有别的退出路径 —— 只能在这里收口
             * （日志与终态 state 都已回放完毕，此时关闭不丢数据）。 */
            if (isTerminalTaskStatus(task.status)) {
              cleanup();
            }
          }
        })
        .catch(() => {
          /* 初始回放失败可忽略 — 订阅与轮询随后仍会推送状态 */
        });

      /* 两条退出路径 —— 轮询读到终态、客户端 abort —— 必须收进同一个
       * cleanup：只清一条，剩下的那条会让 3s 的 DB 轮询在流关闭之后继续跑
       * （3-C 前还有 emitter 终态这条，订阅通道已随单源化退役）。
       * 句柄收在一个可变对象里：cleanup 既被定时器回调调用、也被 `send`
       * 抛错路径调用，`const` 各自声明会踩 TDZ（历史注释保留原委）。 */
      const handles: {
        heartbeat?: ReturnType<typeof setInterval>;
        poll?: ReturnType<typeof setInterval>;
      } = {};
      let closed = false;
      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        if (handles.heartbeat !== undefined) {
          clearInterval(handles.heartbeat);
        }
        if (handles.poll !== undefined) {
          clearInterval(handles.poll);
        }
        try {
          controller.close();
        } catch {
          /* 流已经关了 —— 忽略 */
        }
      };

      /* SSE 心跳：空闲 30–60s 后 OS/代理会悄悄掐掉 socket，EventSource 自动重连会刷屏。
       * 注释行 `: hb\n\n` 对 onmessage 不可见但能刷新 TCP 空闲计时器；
       * 15s 远小于多数代理空闲超时。abort 时清除。 */
      handles.heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`));
        } catch {
          /* controller 已关闭 —— 清掉定时器并退出 */
          if (handles.heartbeat !== undefined) {
            clearInterval(handles.heartbeat);
          }
        }
      }, 15_000);

      /* 数据库轮询 = SSE 的唯一事件源（P3 §5 ADR §13-3C，D2 定 3s）。
       * 进程内 emitter 只覆盖 inline 一半流量（host 执行到不了），两模式契约曾分裂；
       * log 增量与节点进度统一走 DB：单一来源、inline/host 同一观感（代价 ≤3s 延迟 + 200ms 落库防抖）。
       * `findSseSnapshot` 是窄投影（不含 workflowSnapshot 大列）；同时最多一次轮询在途。 */
      let polling = false;
      handles.poll = setInterval(() => {
        if (polling) {
          return;
        }
        polling = true;
        taskRepository
          .findSseSnapshot(id)
          .then((cur) => {
            if (!cur) {
              return;
            }
            // 日志是 unknown 列：Array.isArray 收窄到 any[] 会踩
            // no-unsafe-assignment，标注成 unknown[] 保住类型纪律。
            const logs: Array<unknown> = Array.isArray(cur.logs) ? cur.logs : [];
            const nodeKey = JSON.stringify(cur.progressNode ?? null);
            const changed =
              cur.status !== lastSent.status ||
              cur.progress !== lastSent.progress ||
              nodeKey !== lastSent.nodeKey;
            try {
              /* 日志增量：追加数组按游标切。DB 数组只会变长（persistLogs
               * 整包重写同一序列）；万一看到变短（异常形态），只把游标
               * 归正、不重发历史，宁缺勿重。 */
              if (logs.length < sentLogCount) {
                sentLogCount = logs.length;
              }
              for (const entry of logs.slice(sentLogCount)) {
                send({ type: "log", entry });
              }
              sentLogCount = Math.max(sentLogCount, logs.length);
              if (changed) {
                lastSent.status = cur.status;
                lastSent.progress = cur.progress ?? 0;
                lastSent.nodeKey = nodeKey;
                send({
                  type: "state",
                  status: cur.status,
                  progress: cur.progress ?? 0,
                  error: cur.error,
                  validationErrors: parseValidationErrors(cur.validationErrors),
                  workflowName: cur.workflowName,
                  node: cur.progressNode,
                  /* 只在终态附带产出清单（与初始回放的 state 帧同形）：
                   * host 执行的任务没有进程内 done 帧，客户端靠这份 images
                   * 收口成功态（#1151）；非终态不带上，轮询帧保持轻量。 */
                  ...(isTerminalTaskStatus(cur.status) ? { images: cur.resultImages } : {}),
                });
              }
            } catch {
              /* `send` 抛 = 流已关、连接已死：abort 事件未必能触发
               * （反向代理缓冲 / keep-alive 提前断开），这是定时器残留
               * 的最后一条漏网路径，必须走 cleanup。 */
              cleanup();
              return;
            }
            if (isTerminalTaskStatus(cur.status)) {
              cleanup();
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
        cleanup();
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
