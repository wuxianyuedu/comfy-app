// 本地 ComfyUI 链辅助：把某镜头的生成图片上传进 ComfyUI 的
// 输入目录，好让 img2video / flfvideo 工作流（LoadImage 节点）能消费它。
// 生成路由期望 `inputImage` 是已存在于该目录的文件名；
// 本端点桥接工坊的生成图片 URL。
//   端点：POST /api/workshop-local/prepare  { image: string }  → { filename }
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { uploadImage } from "~/lib/comfyui/client";
import { isRecord } from "~/lib/workshop/api-channel-shared";
import {
  resolveMediaBytes,
  strField,
} from "~/lib/workshop/media-source.server";
import { errorMessage } from "~/lib/error-message";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extForMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[mime] ?? "png";
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
  const image = strField(body, "image");
  if (!image) {
    return NextResponse.json({ error: "image 不能为空" }, { status: 400 });
  }

  try {
    const { buffer, mime } = await resolveMediaBytes(
      image,
      new URL(req.url).origin,
    );
    const filename = `workshop-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extForMime(mime)}`;
    const uploaded = await uploadImage(buffer, filename);
    return NextResponse.json({ filename: uploaded.name ?? filename });
  } catch (e) {
    return NextResponse.json(
      { error: errorMessage(e, "参考图准备失败") },
      { status: 502 },
    );
  }
}
