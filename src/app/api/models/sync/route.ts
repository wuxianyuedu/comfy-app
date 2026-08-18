import { NextResponse } from "next/server";
import { syncModels, modelCountsByFolder } from "@/lib/models";
import { getServerUser } from "@/lib/auth-server";

export const runtime = "nodejs";

/**
 * Re-scan the ComfyUI model directories into our registry.
 *
 * The scan is **config-driven**: we pass the current user's id so
 * `syncModels()` can honor their `UserModelConfig` rows (disabled defaults are
 * skipped, enabled custom directories are scanned in addition).  Without the
 * userId the scan silently ignored every user preference — which was the root
 * of the "I don't know by what rules models are found" complaint.
 */
export async function POST() {
  try {
    const user = await getServerUser();
    const count = await syncModels(user.id);
    const folders = await modelCountsByFolder();
    return NextResponse.json({ ok: true, count, folders });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "同步失败";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
