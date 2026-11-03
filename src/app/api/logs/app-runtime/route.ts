import { NextResponse } from "next/server";
import { createAppRuntimeLogger } from "~/lib/log/app-runtime-log";
import { RUNTIME_LOG_MESSAGE_MAX, clampText } from "~/lib/text-clamp";

/**
 * 应用运行日志写入端点（客户端 → 服务端）：`app-runtime-log` 是 Node-only 模块，客户端必须经此端点转交写入，
 * 直接 import 会让 Turbopack 把 node:fs 静态打进客户端 bundle（ISSUE #282）。
 * 仅接受白名单字段（对齐规范 07 §7.11/§12.5）；写入失败绝不阻塞业务主流程。
 */

/** 命名空间白名单：客户端可用的日志命名空间（防止任意注入）。 */
const ALLOWED_NS = new Set(["settings", "app"]);

/** 允许的日志级别。 */
const ALLOWED_LEVEL = new Set<"info" | "warn" | "error">(["info", "warn", "error"]);

/**
 * 单条消息最大长度（截断防爆日志文件；取值受日志体积约束，§16.2.4.48）。
 * 不加省略标记 —— 原文拼在行首时间戳行内，标记会被读成日志内容的一部分。
 */
const MAX_MSG_LEN = RUNTIME_LOG_MESSAGE_MAX;

export async function POST(request: Request) {
  try {
    /* SAFETY: 类型断言已复核 */
    const body = (await request.json()) as {
      fields?: Record<string, unknown>;
      level?: string;
      msg?: string;
      ns?: string;
    };

    const ns = body.ns ?? "app";
    if (!ALLOWED_NS.has(ns)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const level = body.level ?? "info";
    /* SAFETY: 类型断言已复核 */
    if (!ALLOWED_LEVEL.has(level as "info" | "warn" | "error")) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (typeof body.msg !== "string" || body.msg.length === 0) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // 截断超长消息；fields 仅保留可序列化的标量/对象（由 logger 内部 stringify）。
    const msg = clampText(body.msg, {
      maxLength: MAX_MSG_LEN,
      marker: "",
    });
    const fields = body.fields && typeof body.fields === "object" ? body.fields : undefined;

    const log = createAppRuntimeLogger(ns);
    /* SAFETY: 类型断言已复核 */
    log[level as "info" | "warn" | "error"](msg, fields);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
