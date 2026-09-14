// Workshop API channel generation relay.
//   POST /api/workshop-api/generate
//     { kind: "image", prompt, negative?, size?,
//       aspectRatio?, megapixels?, multiple?, image? }        → { url }
//     { kind: "video", prompt, image?, frames?, fps? }        → { url? , remoteTaskId? }
//     { kind: "video", remoteTaskId }                         → { url } | { pending: true }
// The relay keeps the provider apiKey server-side and normalizes heterogeneous
// upstream response shapes (direct URL vs b64 vs async task id) via the shared
// extraction helpers.
import { type NextRequest, NextResponse } from "next/server";

import { requireServerUser } from "@/lib/auth-server";
import {
  generateImageViaApi,
  pollVideoViaApi,
  submitVideoViaApi,
} from "@/lib/workshop/api-channel.server";
import { isRecord } from "@/lib/workshop/api-channel-shared";
import { intField, resolveMediaDataUrl, strField } from "@/lib/workshop/media-source.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const msg: unknown = e.message;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

export async function POST(req: NextRequest) {
  const user = await requireServerUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "auth.required", message: "未登录或会话已失效" } },
      { status: 401 },
    );
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

  const kind: unknown = body.kind;
  const model = strField(body, "model");
  const mode = strField(body, "mode");
  const aspectRatio = strField(body, "aspectRatio");
  const megapixels = strField(body, "megapixels");
  const multiple = intField(body, "multiple", 1, 512);
  const image = strField(body, "image");
  const prompt = strField(body, "prompt") ?? "";
  const negative = strField(body, "negative");
  const size = strField(body, "size");
  const remoteTaskId = strField(body, "remoteTaskId");
  const frames = intField(body, "frames", 1, 1000);
  const fps = intField(body, "fps", 1, 120);

  try {
    if (kind === "image") {
      if (!prompt) {
        return NextResponse.json({ error: "prompt 不能为空" }, { status: 400 });
      }
      const url = await generateImageViaApi({
        prompt,
        negative,
        size,
        model,
        mode,
        aspectRatio,
        megapixels,
        ...(multiple !== undefined ? { multiple } : {}),
        image,
      });
      return NextResponse.json({ url });
    }

    if (kind === "video") {
      // Poll step for async providers.
      if (remoteTaskId) {
        const result = await pollVideoViaApi(remoteTaskId);
        return NextResponse.json(result);
      }
      if (!prompt) {
        return NextResponse.json({ error: "prompt 不能为空" }, { status: 400 });
      }
      const imageDataUrl = image
        ? await resolveMediaDataUrl(image, new URL(req.url).origin)
        : undefined;
      const result = await submitVideoViaApi({ prompt, negative, imageDataUrl, frames, fps });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "kind 必须是 image 或 video" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, "API 生成失败") }, { status: 502 });
  }
}
