import { NextResponse } from "next/server";
import { syncModels } from "@/lib/models";

export const runtime = "nodejs";

export async function POST() {
  try {
    const count = await syncModels();
    return NextResponse.json({ ok: true, count });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "同步失败" }, { status: 500 });
  }
}
