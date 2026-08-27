import { type NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getServerUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// R-T3-phase4 (OWASP A04/A05): whitelist audio types and cap the size.
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
  const user = await getServerUser();
  void user;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "表单解析失败" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "未找到文件" }, { status: 400 });
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "仅支持 MP3 / WAV / M4A / OGG 音频" },
      { status: 400 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "音频大小不能超过 100MB" },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || ".mp3";
  const safe = file.name.replace(/[^\w.\-一-龥]/g, "_").slice(0, 60);
  const name = `${Date.now()}_${safe}${ext}`;
  const dir = path.join(process.cwd(), "public", "generated", "films", "bgm");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buf);
  return NextResponse.json({ name });
}
