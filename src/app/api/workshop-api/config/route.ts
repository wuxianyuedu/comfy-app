// 工坊 API 通道配置：掩码视图 + 保存。
//   端点：GET  /api/workshop-api/config  → { channels: ApiChannelsView }
//   POST /api/workshop-api/config  → 保存部分通道配置，返回掩码视图
// apiKey 只存在服务端（data/workshop-api-settings.json），
// 永不返回给浏览器 —— 与 LLM 配置契约一致。
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { getMaskedChannels, saveWorkshopApiSettings } from "~/lib/workshop/api-channel.server";
import { isRecord } from "~/lib/is-record";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { apiErrorBody } from "~/lib/api-error";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { rejectCrossOriginWrite } from "~/server/lib/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  return NextResponse.json({ channels: getMaskedChannels() });
}

export async function POST(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  /* 同源闸（#4723）：写端点统一入口，判据见 ~/server/lib/same-origin。 */
  const crossOrigin = rejectCrossOriginWrite(req);
  if (crossOrigin !== null) {
    return crossOrigin;
  }

  const body = await readJsonRecord(req);
  if (isErrorResponse(body)) {
    return body;
  }

  const patch: { image?: unknown; video?: unknown } = {};
  if (isRecord(body.image)) {
    patch.image = body.image;
  }
  if (isRecord(body.video)) {
    patch.video = body.video;
  }
  if (patch.image === undefined && patch.video === undefined) {
    return NextResponse.json({ error: "缺少 image / video 配置" }, { status: 400 });
  }

  try {
    await saveWorkshopApiSettings(patch);
    return NextResponse.json({ channels: getMaskedChannels() });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "保存失败"), { status: 500 });
  }
}
