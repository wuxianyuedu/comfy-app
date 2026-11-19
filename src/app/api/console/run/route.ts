import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { readJsonRecord, isErrorResponse } from "~/server/lib/request-body";
import { logger } from "~/lib/core/logger";
import { apiErrorBody } from "~/lib/api-error";
import { uniqueStamp } from "~/lib/unique-id";
import { errorMessage } from "~/lib/error-message";
import { MAX_COMMAND_CHARS, MAX_RUN_MS } from "~/lib/console/console-limits";
import { parseConsoleLine } from "~/lib/console/console-catalog";
import { isLoopbackRequest } from "~/lib/console/console-guard";
import { consoleSlot, recordConsoleHistory } from "~/lib/console/console-registry";

export const runtime = "nodejs";

/**
 * 端点：POST /api/console/run —— 应用内控制台唯一执行入口（ISSUE #1327）：体 `{ command: string }`，回 SSE 流 `start`→`out`→`exit`，
 * 流结束即命令结束（一次性输出无需回放，代价是流中断即回收命令）。守卫三道缺一不可：回环 `isLoopbackRequest`（判据贴本层）
 * → 会话 `requireRequestUser` → `parseConsoleLine`（不经平台 shell）；**刻意不做**危险命令黑名单（拦不住 `node -e`，只会让人以为拦得住）。
 */
export async function POST(req: NextRequest) {
  if (!isLoopbackRequest(req.headers)) {
    return NextResponse.json(
      apiErrorBody(null, "控制台只允许从本机访问", {
        reason: "remote-request",
      }),
      { status: 403 },
    );
  }

  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const body = await readJsonRecord(req);
  if (isErrorResponse(body)) {
    return body;
  }

  const rawCommand = typeof body.command === "string" ? body.command : "";
  if (rawCommand.length > MAX_COMMAND_CHARS) {
    return NextResponse.json(apiErrorBody(null, `命令过长（上限 ${MAX_COMMAND_CHARS} 字符）`), {
      status: 400,
    });
  }
  const parsed = parseConsoleLine(rawCommand);
  if (!parsed.ok) {
    return NextResponse.json(apiErrorBody(null, parsed.reason), {
      status: 400,
    });
  }

  const slot = consoleSlot();
  const running = slot.runner.busy();
  if (running) {
    /* 忙时**拒绝**而不是排队：队列会让用户以为「点了没反应」，而控制台里最可
     * 疑的正是「它到底跑没跑」。回一句「是谁在跑、跑了多久」比排一条队有用。 */
    const elapsedSec = Math.max(0, Math.round((Date.now() - running.startedAt) / 1000));
    return NextResponse.json(
      apiErrorBody(null, `已有一条命令在运行：${running.command}（已跑 ${elapsedSec}s）`),
      { status: 409 },
    );
  }

  /* 运行标识走 `~/lib/unique-id` 的唯一出口：手拼「时间戳 + 随机段」在
   * 「同一毫秒起两条」时会撞名，而 runId 是取消与日志定位的键。 */
  const runId = uniqueStamp("run-");
  const encoder = new TextEncoder();

  /* 流与执行的生命周期**绑在一起**：`cancelOnClose` 在用户断开时回收整棵树。
   * 它必须是 `let`：正常跑完（exit 事件已发、流由执行方关）时置 false，
   * 否则 `close()` 会在我们主动关闭时再去杀一次已经退出的 pid。 */
  let cancelOnClose = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      /** 本路由对 SSE 帧的唯一出口（与其余流式路由同形：`data: <json>\n\n`）。 */
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          /* 用户已经断开：`cancelOnClose` 那条路会回收命令，这里静默即可
           * （往已关的 controller 写会抛，而那是正常路径，不是错误）。 */
        }
      };

      try {
        const result = await slot.runner.run(
          {
            runId,
            command: parsed.display,
            file: parsed.file,
            args: parsed.args,
            cwd: process.cwd(),
            timeoutMs: MAX_RUN_MS,
          },
          send,
        );
        // 执行方已经发完 exit 帧，接下来的 close 由我们自己触发 —— 不要再回收。
        cancelOnClose = false;
        recordConsoleHistory(slot, {
          runId: result.runId,
          command: result.command,
          exitCode: result.exitCode,
          killed: result.killed,
          durationMs: result.durationMs,
          finishedAt: Date.now(),
        });
        logger.info(
          `[console] run 完成 command="${result.command}" exit=${result.exitCode ?? "null"}` +
            ` killed=${result.killed} 用时=${result.durationMs}ms`,
        );
      } catch (error) {
        cancelOnClose = false;
        const message = errorMessage(error, "控制台命令执行失败");
        send({ type: "error", message });
        logger.error(`[console] run 异常 command="${parsed.display}"：${message}`);
      } finally {
        try {
          controller.close();
        } catch {
          /* 已经关了 */
        }
      }
    },

    async cancel() {
      /* 用户断开连接（关界面 / 切视图 / 网络断）：把命令整棵树收走。
       * 不在这里 await 日志写入 —— cancel 的调用方不保证会等我们。 */
      if (cancelOnClose) {
        const killed = await slot.runner.cancel();
        logger.warn(
          `[console] 客户端断开，${killed ? "已回收" : "无在跑的命令"}（runId=${runId}）`,
        );
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Connection: "keep-alive",
      // 反代/浏览器缓冲会让「逐行输出」变成「结束时一次性出现」——这是流式
      // 界面上最容易被误判成「没反应」的一件事，显式禁掉。
      "X-Accel-Buffering": "no",
    },
  });
}
