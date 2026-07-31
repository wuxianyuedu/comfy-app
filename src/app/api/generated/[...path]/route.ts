import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Serve runtime-generated media (images/videos produced by ComfyUI jobs).
// We route through an API handler instead of relying on Next's static `public/`
// serving, because `next start` snapshots the public directory at boot and will
// 404 files written afterwards at runtime. Reading from disk here works in both
// `next dev` and `next start`.
const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const rel = segments.map((s) => decodeURIComponent(s)).join("/");
  const base = path.join(process.cwd(), "public", "generated");
  const full = path.join(base, rel);

  // Guard against path traversal.
  if (full !== base && !full.startsWith(base + path.sep)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const buf = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
