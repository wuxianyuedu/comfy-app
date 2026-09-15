// Workshop generation execution logs: persist / query.
//   POST /api/workshop/logs  { stage, entries: [{ts, kind, summary, detail?}] } → { saved }
//   GET  /api/workshop/logs?stage=character&limit=100             → { entries }
// 角色/分镜提取、AI 拆镜、定妆照生成的执行日志原来只在前端会话里，
// 刷新即失；这里统一落 log/workshop/（按天分文件），供界面回看历史。
import { type NextRequest, NextResponse } from "next/server";

import { requireServerUser } from "@/lib/auth-server";
import { unauthorizedResponse } from "~/server/lib/error-response";
import {
  GENERATION_LOG_STAGE_LABELS,
  parseGenerationLogStage,
} from "@/lib/workshop/generation-log";
import {
  appendGenerationLogs,
  readGenerationLogs,
} from "@/lib/workshop/generation-log.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireServerUser();
  if (!user) {
    return unauthorizedResponse();
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const rec = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const stage = parseGenerationLogStage(rec.stage);
  if (!stage) {
    return NextResponse.json(
      { error: `stage 必须是 ${Object.keys(GENERATION_LOG_STAGE_LABELS).join(" / ")} 之一` },
      { status: 400 },
    );
  }
  const entries: unknown[] = Array.isArray(rec.entries) ? rec.entries.slice(0, 200) : [];
  const saved = await appendGenerationLogs(stage, entries);
  return NextResponse.json({ saved });
}

export async function GET(req: NextRequest) {
  const user = await requireServerUser();
  if (!user) {
    return unauthorizedResponse();
  }
  const stage = parseGenerationLogStage(req.nextUrl.searchParams.get("stage"));
  if (!stage) {
    return NextResponse.json(
      { error: `stage 必须是 ${Object.keys(GENERATION_LOG_STAGE_LABELS).join(" / ")} 之一` },
      { status: 400 },
    );
  }
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
  const entries = await readGenerationLogs(stage, Number.isFinite(limit) ? limit : 100);
  return NextResponse.json({ entries });
}
