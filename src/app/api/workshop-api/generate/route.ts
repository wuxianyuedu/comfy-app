// 工坊 API 通道生成中转（POST /api/workshop-api/generate）。契约：
//   图片 { kind:"image", prompt, negative?, size?, aspectRatio?, megapixels?, resolution?, multiple?, image? } → { url }
//   视频 { kind:"video", prompt, image?, frames?, fps? } → { url?, remoteTaskId? }；轮询 { kind:"video", remoteTaskId } → { url } | { pending:true }
// 中转把提供方 apiKey 留在服务端，并经共享辅助归一化上游响应形状（直给 URL vs b64 vs 异步任务 id）。
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import {
  generateImageViaApi,
  pollVideoViaApi,
  submitVideoViaApi,
} from "~/lib/workshop/api-channel.server";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { intField, resolveMediaDataUrl, strField } from "~/lib/workshop/media-source.server";
import { apiErrorBody } from "~/lib/api-error";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const body = await readJsonRecord(req);
  if (isErrorResponse(body)) {
    return body;
  }

  const kind: unknown = body.kind;
  const model = strField(body, "model");
  const mode = strField(body, "mode");
  const aspectRatio = strField(body, "aspectRatio");
  const megapixels = strField(body, "megapixels");
  /* 分辨率档位名（"1k"/"2k"/"4k"，ISSUE #3622）：与百万像素同口的另一种
   * 表达，适配器映射了「分辨率」口的远端接口直接拿到它。 */
  const resolution = strField(body, "resolution");
  const multiple = intField(body, "multiple", 1, 512);
  const image = strField(body, "image");
  const prompt = strField(body, "prompt") ?? "";
  const negative = strField(body, "negative");
  const size = strField(body, "size");
  const remoteTaskId = strField(body, "remoteTaskId");
  const frames = intField(body, "frames", 1, 1000);
  const fps = intField(body, "fps", 1, 120);
  /* 视频秒数（#3590 测试页与适配器 duration 输入用）：1~60s 的宽松界 ——
   * 各家视频接口的合法区间不同（Agnes 4~12s），越界由上游报错。 */
  const duration = intField(body, "duration", 1, 60);
  /* 生图种子（ISSUE #3778）：非负整数（0 也是合法种子），越界/非法 = 没带。 */
  const seed = intField(body, "seed", 0, 4_294_967_295);

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
        ...(resolution === undefined ? {} : { resolution }),
        ...(multiple === undefined ? {} : { multiple }),
        ...(seed === undefined ? {} : { seed }),
        image,
      });
      return NextResponse.json({ url });
    }

    if (kind === "video") {
      // 异步提供方的轮询步。model/mode 跟着走（#3590）：远端模型的任务查询
      // 地址与密钥都在该条目上，轮询要按它构造候选。
      if (remoteTaskId !== undefined && remoteTaskId !== "") {
        const result = await pollVideoViaApi(remoteTaskId, { mode, model });
        return NextResponse.json(result);
      }
      if (!prompt) {
        return NextResponse.json({ error: "prompt 不能为空" }, { status: 400 });
      }
      const imageDataUrl =
        image !== undefined && image !== ""
          ? await resolveMediaDataUrl(image, new URL(req.url).origin)
          : undefined;
      const result = await submitVideoViaApi({
        prompt,
        negative,
        imageDataUrl,
        frames,
        fps,
        model,
        mode,
        ...(duration === undefined ? {} : { duration }),
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "kind 必须是 image 或 video" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "API 生成失败"), { status: 502 });
  }
}
