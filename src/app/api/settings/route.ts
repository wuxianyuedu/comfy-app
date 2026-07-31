import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, saveSettings } from "@/lib/app-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  comfyuiUrl: z.string().url().optional(),
  trainerUrl: z
    .string()
    .refine((s) => s === "" || /^https?:\/\//.test(s), "训练后端需为 http(s) 地址")
    .optional(),
  defaultVideoWorkflow: z.enum(["auto", "txt2video", "img2video"]).optional(),
  comfyLorasDir: z.string().optional(),
});

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }
  const settings = await saveSettings(parsed.data);
  return NextResponse.json({ settings });
}
