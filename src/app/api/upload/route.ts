/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { type NextRequest, NextResponse } from "next/server";
import { requireServerUser } from "@/lib/auth-server";
import { uploadImage, comfyBase } from "@/lib/comfyui/client";
import { logger } from "~/server/lib/logger";

export const runtime = "nodejs";

// R-T3-phase4 (OWASP A04/A05): whitelist image types and cap the size so a
// malformed upload cannot write arbitrary extensions or exhaust memory.
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const user = await requireServerUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "auth.required", message: "未登录或会话已失效" } },
      { status: 401 }
    );
  }

  const form = await req.formData();
  const file = form.get("image") as File | null;
  if (!file) return NextResponse.json({ error: "未收到文件" }, { status: 400 });
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "仅支持 PNG / JPG / WebP / GIF 图片" },
      { status: 400 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "图片大小不能超过 50MB" },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf("."))
    : ".png";
  const filename = `comfyapp_${Date.now()}_${Math.floor(Math.random() * 1e6)}${ext}`;

  try {
    const res = await uploadImage(buf, filename, "input");
    if (!res.name) return NextResponse.json({ error: "上传失败" }, { status: 500 });
    return NextResponse.json({ name: res.name });
  } catch (e: any) {
    const msg = e?.message ?? "上传失败";
    const base = comfyBase();
    // Detect common connectivity issues and provide actionable guidance
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      logger.error(
        `[upload] 503 ComfyUI unreachable — ${base} | error: ${msg} | file: ${filename} (${(buf.length/1024).toFixed(0)}KB)`
      );
      return NextResponse.json(
        {
          error: `无法连接 ComfyUI (${base})。请确认 ComfyUI 已启动后再上传素材。`,
          hint: "comfyui-unreachable",
        },
        { status: 503 }
      );
    }
    // Log other upload errors too
    logger.error(`[upload] ${msg} | file: ${filename}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
