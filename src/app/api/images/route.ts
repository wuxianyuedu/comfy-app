import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { comfyBase } from "@/lib/comfyui/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browser-side image proxy for ComfyUI-resident assets (LoadImage previews,
 * generated results, etc.).  The browser cannot hit ComfyUI's :8188 directly
 * (CORS + private-network exposure), so we relay `GET /api/view` here and
 * pipe the bytes back with the correct Content-Type.
 *
 * Query: ?filename=<name>&subfolder=<dir>&type=input|output|temp
 * The `filename` is produced server-side from a trusted workflow's rawJson, so
 * we still guard against path separators as defense-in-depth.
 */
export async function GET(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const filename = url.searchParams.get("filename");
  const subfolder = url.searchParams.get("subfolder") ?? "";
  const type = url.searchParams.get("type") ?? "";

  if (!filename || /[\/\\]/.test(filename) || /[\/\\]/.test(subfolder)) {
    return NextResponse.json({ error: "invalid filename" }, { status: 400 });
  }

  const u = new URL(`${comfyBase()}/api/view`);
  u.searchParams.set("filename", filename);
  u.searchParams.set("subfolder", subfolder);
  u.searchParams.set("type", type);

  let upstream: Response;
  try {
    upstream = await fetch(u.toString());
  } catch (e: any) {
    const base = comfyBase();
    console.error(`[images] ComfyUI unreachable ${base} | ${e?.message ?? e}`);
    return NextResponse.json(
      { error: `无法连接 ComfyUI (${base})`, hint: "comfyui-unreachable" },
      { status: 503 }
    );
  }
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("upstream error", { status: 502 });
  }

  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("Content-Type", ct);
  headers.set("Cache-Control", "private, max-age=60");
  return new NextResponse(upstream.body, { status: 200, headers });
}
