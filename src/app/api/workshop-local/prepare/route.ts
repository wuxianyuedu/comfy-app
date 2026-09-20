// 本地 ComfyUI 链辅助：把某镜头的生成图片上传进 ComfyUI 的
// 输入目录，好让 img2video / flfvideo 工作流（LoadImage 节点）能消费它。
// 生成路由期望 `inputImage` 是已存在于该目录的文件名；
// 本端点桥接工坊的生成图片 URL。
//   端点：POST /api/workshop-local/prepare  { image: string }  → { filename }
import { type NextRequest, NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { uploadImage } from "~/lib/comfyui/client";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import {
  resolveMediaBytes,
  strField,
} from "~/lib/workshop/media-source.server";
import { apiErrorBody } from "~/lib/api-error";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { uniqueStamp } from "~/lib/unique-id";
import { extForMime } from "~/lib/media/mime-ext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* 未知 MIME 一律当图片存：ComfyUI 的 LoadImage 按扩展名认文件，
 * 没有扩展名会被拒；这里的入参已过 resolveMediaBytes 收窄（非图片会被拒在上游）。 */
const DEFAULT_EXT = "png";

export async function POST(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const body = await readJsonRecord(req);
  if (isErrorResponse(body)) return body;
  const image = strField(body, "image");
  if (!image) {
    return NextResponse.json({ error: "image 不能为空" }, { status: 400 });
  }

  try {
    const { buffer, mime } = await resolveMediaBytes(
      image,
      new URL(req.url).origin,
    );
    /* 文件名走全库唯一出口（规范 16 §16.2.4.36）。 */
    const filename = `${uniqueStamp("workshop-ref-")}.${extForMime(mime) ?? DEFAULT_EXT}`;
    const uploaded = await uploadImage(buffer, filename);
    return NextResponse.json({ filename: uploaded.name ?? filename });
  } catch (e) {
    return NextResponse.json(apiErrorBody(e, "参考图准备失败"), {
      status: 502,
    });
  }
}
