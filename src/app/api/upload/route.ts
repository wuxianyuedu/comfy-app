import { NextRequest, NextResponse } from "next/server";
import { uploadImage } from "@/lib/comfyui/client";

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
    return NextResponse.json({ error: e?.message ?? "上传失败" }, { status: 500 });
  }
}
