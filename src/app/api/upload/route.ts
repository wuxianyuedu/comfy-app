import { NextRequest, NextResponse } from "next/server";
import { uploadImage, comfyBase } from "@/lib/comfyui/client";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("image") as File | null;
  if (!file) return NextResponse.json({ error: "未收到文件" }, { status: 400 });

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
      console.error(
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
    console.error(`[upload] ${msg} | file: ${filename}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
