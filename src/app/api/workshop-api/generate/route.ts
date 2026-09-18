// 工坊 API 通道生成中转。
//   对外契约（POST /api/workshop-api/generate）：
//     图片请求字段：{ kind: "image", prompt, negative?, size?,
//       可选：aspectRatio?, megapixels?, multiple?, image? } → 返回 { url }
//     视频请求： { kind: "video", prompt, image?, frames?, fps? }  → { url? , remoteTaskId? }
//     视频轮询： { kind: "video", remoteTaskId }                   → { url } | { pending: true }
// 中转把提供方的 apiKey 留在服务端，并经共享
// 提取辅助函数归一化各种上游响应形状（直给 URL vs b64 vs 异步任务 id）。
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import {
  generateImageViaApi,
  pollVideoViaApi,
  submitVideoViaApi,
} from "~/lib/workshop/api-channel.server";
import { isRecord } from "~/lib/workshop/api-channel-shared";
import {
  intField,
  resolveMediaDataUrl,
  strField,
} from "~/lib/workshop/media-source.server";
import { errorMessage } from "~/lib/error-message";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      // 异步提供方的轮询步。
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
      const result = await submitVideoViaApi({
        prompt,
        negative,
        imageDataUrl,
        frames,
        fps,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "kind 必须是 image 或 video" },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: errorMessage(e, "API 生成失败") },
      { status: 502 },
    );
  }
}
