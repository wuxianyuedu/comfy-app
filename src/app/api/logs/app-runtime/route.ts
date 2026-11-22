import { NextResponse } from "next/server";
import { createAppRuntimeLogger } from "~/lib/log/app-runtime-log";
import { isRecord } from "~/lib/is-record";
import { RUNTIME_LOG_FIELDS_MAX, RUNTIME_LOG_MESSAGE_MAX, clampText } from "~/lib/text-clamp";
import { checkRateLimit } from "~/server/api/middleware/rate-limit";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { rejectCrossOriginWrite } from "~/server/lib/same-origin";

/**
 * 应用运行日志写入端点（客户端 → 服务端）：`app-runtime-log` 是 Node-only 模块，客户端必须经此端点转交写入，
 * 直接 import 会让 Turbopack 把 node:fs 静态打进客户端 bundle（ISSUE #282）。
 * 仅接受白名单字段（对齐规范 07 §7.11/§12.5）；写入失败绝不阻塞业务主流程。
 */

/** 命名空间白名单：客户端可用的日志命名空间（防止任意注入）。 */
const ALLOWED_NS = new Set(["settings", "app"]);

/** 允许的日志级别。 */
const ALLOWED_LEVEL: ReadonlyArray<"info" | "warn" | "error"> = ["info", "warn", "error"];

function isAllowedLevel(v: unknown): v is "info" | "warn" | "error" {
  return typeof v === "string" && ALLOWED_LEVEL.some((level) => level === v);
}

/**
 * 单条消息最大长度（截断防爆日志文件；取值受日志体积约束，§16.2.4.48）。
 * 不加省略标记 —— 原文拼在行首时间戳行内，标记会被读成日志内容的一部分。
 */
const MAX_MSG_LEN = RUNTIME_LOG_MESSAGE_MAX;

/** fields 序列化后的最大字符数（超限整段替换为截断标记）：app-runtime 日志只追加不轮转，
 * 无界的 fields 会把单行撑到 MB 级（#4051 写入端点的最小体积约束）。 */
const MAX_FIELDS_JSON_LEN = RUNTIME_LOG_FIELDS_MAX;

export async function POST(request: Request) {
  /* 鉴权与 /api/logs/list 同一口径（#4041）：运行日志的写入端点不对外开放。 */
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  /* 同源闸（#4723）：写端点统一入口，判据见 ~/server/lib/same-origin。 */
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin !== null) {
    return crossOrigin;
  }
  /* 限流与 tRPC `rateLimitedProcedure` 同一套滑动窗口（纯函数零依赖，#4051 最小滥用约束）：
   * 按已登录用户计数，窗口内超限一律 429 —— 客户端写入失败本就静默，不阻塞业务。 */
  if (!checkRateLimit(`app-runtime-log:${user.id}`)) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  try {
    const rawBody: unknown = await request.json();
    const body: Record<string, unknown> = isRecord(rawBody) ? rawBody : {};

    const rawNs: unknown = body.ns ?? "app";
    const ns = typeof rawNs === "string" ? rawNs : "";
    if (!ALLOWED_NS.has(ns)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const rawLevel: unknown = body.level ?? "info";
    if (!isAllowedLevel(rawLevel)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const level = rawLevel;
    if (typeof body.msg !== "string" || body.msg.length === 0) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // 截断超长消息；fields 仅保留可序列化的标量/对象（由 logger 内部 stringify）。
    const msg = clampText(body.msg, {
      maxLength: MAX_MSG_LEN,
      marker: "",
    });
    const rawFields: unknown = body.fields;
    let fields = isRecord(rawFields) ? rawFields : undefined;
    if (fields !== undefined) {
      /* 请求体来自 JSON.parse，不可能有环，stringify 不会抛；超长不截半截 JSON
       * （半截结构对排障没有价值），整段换成有界的截断标记。 */
      const serializedLength = JSON.stringify(fields).length;
      if (serializedLength > MAX_FIELDS_JSON_LEN) {
        fields = { truncated: true, originalChars: serializedLength };
      }
    }

    const log = createAppRuntimeLogger(ns);
    log[level](msg, fields);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
