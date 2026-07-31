import { NextRequest, NextResponse } from "next/server";
import { getView } from "@/lib/comfyui/client";

export const runtime = "nodejs";

// Serve a file previously uploaded to the ComfyUI input directory
// (dataset images, masks, reference frames, etc.) through our own origin.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const buf = await getView(decodeURIComponent(name), "", "input");
    const ext = name.toLowerCase().split(".").pop() ?? "";
    const ct =
      ext === "png"
        ? "image/png"
        : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
        ? "image/webp"
        : ext === "gif"
        ? "image/gif"
        : "application/octet-stream";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
