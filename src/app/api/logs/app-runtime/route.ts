import { NextResponse } from "next/server";
import { createAppRuntimeLogger } from "@/lib/app-runtime-log";

/**
 * 应用运行日志写入端点（客户端 → 服务端）。
 * =========================================================
 * `src/lib/app-runtime-log.ts` 是 Node-only 模块（顶层 import node:fs/node:path），
 * 只能由服务端代码 import。客户端逻辑层（如设置页 hook）需要把「静默失败」
 * 补记进 app-runtime.log 供日志面板轮询展示时，必须经此端点转交服务端写入，
 * 而非直接 import 该模块（否则 Turbopack 会把 node:fs 静态打进客户端 bundle，
 * 编译报 “does not support external modules (request: node:fs)”，见 ISSUE #282）。
 *
 * 仅接受有限字段，避免把任意 payload 落盘（对齐规范 07 §7.11/§12.5 埋点纪律）。
 * 写入失败绝不阻塞业务主流程（服务端 logger 内部已 try/catch）。
 */

/** 命名空间白名单：客户端可用的日志命名空间（防止任意注入）。 */
const ALLOWED_NS = new Set(["settings", "app"]);

/** 允许的日志级别。 */
const ALLOWED_LEVEL = new Set<"info" | "warn" | "error">([
  "info",
  "warn",
  "error",
]);

/** 单条消息最大长度（截断，防止异常 payload 撑爆日志文件）。 */
const MAX_MSG_LEN = 2000;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      ns?: string;
      level?: string;
      msg?: string;
      fields?: Record<string, unknown>;
    };

    const ns = body.ns ?? "app";
    if (!ALLOWED_NS.has(ns)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const level = body.level ?? "info";
    if (!ALLOWED_LEVEL.has(level as "info" | "warn" | "error")) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (typeof body.msg !== "string" || body.msg.length === 0) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // 截断超长消息；fields 仅保留可序列化的标量/对象（由 logger 内部 stringify）。
    const msg = body.msg.slice(0, MAX_MSG_LEN);
    const fields =
      body.fields && typeof body.fields === "object" ? body.fields : undefined;

    const log = createAppRuntimeLogger(ns);
    log[level as "info" | "warn" | "error"](msg, fields);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
