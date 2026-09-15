import { type NextRequest, NextResponse } from "next/server";
import { requireServerUser } from "@/lib/auth-server";
import { uploadImage, comfyBase } from "@/lib/comfyui/client";
import { ensureComfyUiReady } from "@/lib/comfyui/lifecycle";
import { logger } from "~/server/lib/logger";
import { errorMessage } from "~/lib/error-message";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";

/** ComfyUI 不可达（未运行 / 端口不通）的判据：这些形态才值得触发自动启动。 */
function isUnreachable(msg: string): boolean {
  return /fetch failed|ECONNREFUSED|ENOTFOUND|instance is not running/i.test(msg);
}

// (OWASP A04/A05): whitelist image types and cap the size so a
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
    return unauthorizedResponse();
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
  } catch (e) {
    const msg = errorMessage(e, "上传失败");
    const base = comfyBase();
    if (isUnreachable(msg)) {
      /* ComfyUI 没在运行 / 配置路径的实例没起来。上传本身要求它已经跑着
       * （文件要落进它的 input 目录），这里只能回报 503；但顺手踢一次自动
       * 启动，客户端随后调 `/api/comfy/ensure` 就能看到「正在启动」而不是
       * 永远等不到实例（ISSUE #345）。fire-and-forget：不在这条请求里等
       * 冷加载（可能几十秒），避免上传请求挂死。 */
      void ensureComfyUiReady({ timeoutMs: 0 }).catch(() => {
        /* 启动失败已在 ensure 侧落日志（含「不再自动重试」闩锁），此处不重复刷 */
      });
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
