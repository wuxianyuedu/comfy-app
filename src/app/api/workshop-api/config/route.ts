// Workshop API channel config: masked view + save.
//   GET  /api/workshop-api/config  → { channels: ApiChannelsView }
//   POST /api/workshop-api/config  → save partial channel config, returns masked view
// The apiKey is stored server-side only (data/workshop-api-settings.json) and
// never returned to the browser — matching the LLM config contract.
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import {
  getMaskedChannels,
  saveWorkshopApiSettings,
} from "~/lib/workshop/api-channel.server";
import { isRecord } from "~/lib/workshop/api-channel-shared";
import { errorMessage } from "~/lib/error-message";
import { unauthorizedResponse } from "~/server/lib/error-response";

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "请求体必须是对象" }, { status: 400 });
  }

  const patch: { image?: unknown; video?: unknown } = {};
  if (isRecord(body.image)) patch.image = body.image;
  if (isRecord(body.video)) patch.video = body.video;
  if (patch.image === undefined && patch.video === undefined) {
    return NextResponse.json(
      { error: "缺少 image / video 配置" },
      { status: 400 },
    );
  }

  try {
    await saveWorkshopApiSettings(patch);
    return NextResponse.json({ channels: getMaskedChannels() });
  } catch (e) {
    return NextResponse.json(
      { error: errorMessage(e, "保存失败") },
      { status: 500 },
    );
  }
}
