import { type NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { currentServerUser } from "~/server/auth/request-user";
import { uniqueStamp } from "~/lib/unique-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 安全（OWASP A04/A05）：白名单音频类型并限制大小。
const ALLOWED_MIME = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
]);
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const user = await currentServerUser();
  void user;
  const form = await req.formData().catch(() => null);
  if (!form)
    return NextResponse.json({ error: "表单解析失败" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ error: "未找到文件" }, { status: 400 });
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "仅支持 MP3 / WAV / M4A / OGG 音频" },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "音频大小不能超过 100MB" },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || ".mp3";
  const safe = file.name.replace(/[^\w.\-一-龥]/g, "_").slice(0, 60);
  /* 落盘文件名走全库唯一出口（规范 16 §16.2.4.36）—— 收口前这里是手拼的
   * `${Date.now()}_${safe}${ext}`，与另两处上传路由各写一份「怎么保证不撞名」。 */
  const name = `${uniqueStamp("bgm-")}_${safe}${ext}`;
  const dir = path.join(process.cwd(), "public", "generated", "films", "bgm");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buf);
  return NextResponse.json({ name });
}
