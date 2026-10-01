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
import {
  consoleSlot,
  recordConsoleHistory,
} from "~/lib/console/console-registry";

export const runtime = "nodejs";

/**
 * 端点：POST /api/console/run
 *
 * 应用内控制台的唯一执行入口（ISSUE #1327）。体 `{ command: string }`，
 * 回一条 **SSE 流**（`start` → 若干 `out` → `exit`），流结束即命令结束。
 *
 * ## 为什么是「POST 回流」而不是「POST 起任务 + GET 轮询/订阅」
 *
 * 命令的输出是**一次性的、有头有尾的**：它没有「后来的订阅者要回放历史」这条
 * 需求（对比任务的 SSE —— 那条要回放，因为用户可能中途才打开面板）。拆成两个
 * 端点只会多出一份「runId → 输出缓冲」的服务端状态与它的清理时机；合并成一条
 * 流则连「命令已经结束、这条订阅还在吗」都不必判 —— 流一关就是结束。
 *
 * 代价是「流中断 = 看不见结果」，所以中断时**命令会被回收**（见下方 close 处理）：
 * 用户关掉界面/切走视图不该留下一条没人管的 `pnpm test` 占着 CPU。
 *
 * ## 安全：这条链能执行任意本机命令，守卫因此是「谁能到达」
 *
 * 三道闸，缺一不可（顺序即成本：先便宜的后贵的）：
 *   1. **回环检查**（`isLoopbackRequest`）—— 只有从本机发起的请求才放行。
 *      应用服务**本来就绑回环**，但「应用服务绑回环」是启动编排的行为、不是
 *      本路由的性质：有人把 `-H 0.0.0.0` 换个值启动，或将来加一层反代，这条
 *      路由就会对着局域网敞开一个任意命令执行口。**判据写在这一层**（同
 *      §12.14 的「端点收口」精神：安全判据贴着它的作用域）。
 *   2. **会话**（`requireRequestUser`）—— 与其余 REST 面同一条闸（`loginRequired`
 *      打开时无会话即 401）。
 *   3. **入参形态**（`parseConsoleLine`）—— 只拆命令，不经过平台 shell
 *      （理由见 `console-catalog.ts` 的文件头）。
 *
 * **刻意不做**「危险命令黑名单」：它拦不住 `node -e`、`sh -c`、`pnpm exec x`，
 * 却会让读到它的人以为拦得住 —— 这类会静默失效的清单在本仓是被点名过的反模式
 * （§12.18 判定反模式）。真正的边界是「本机 + 有会话的用户」，说清楚即可。
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
  if (isErrorResponse(body)) return body;

  const rawCommand = typeof body.command === "string" ? body.command : "";
  if (rawCommand.length > MAX_COMMAND_CHARS) {
    return NextResponse.json(
      apiErrorBody(null, `命令过长（上限 ${MAX_COMMAND_CHARS} 字符）`),
      { status: 400 },
    );
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
    const elapsedSec = Math.max(
      0,
      Math.round((Date.now() - running.startedAt) / 1000),
    );
    return NextResponse.json(
      apiErrorBody(
        null,
        `已有一条命令在运行：${running.command}（已跑 ${elapsedSec}s）`,
      ),
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
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
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
      } catch (e) {
        cancelOnClose = false;
        const message = errorMessage(e, "控制台命令执行失败");
        send({ type: "error", message });
        logger.error(
          `[console] run 异常 command="${parsed.display}"：${message}`,
        );
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
