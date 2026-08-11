/**
 * /api/custom-nodes/manifest
 *
 * Returns the raw generated manifest (src/generated/customNodes.manifest.json)
 * so the client can live-refresh the node registry after a parse — without a
 * server restart.
 */
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANIFEST = path.join(process.cwd(), "src/generated/customNodes.manifest.json");

export async function GET() {
  if (!fs.existsSync(MANIFEST)) {
    return NextResponse.json({ error: "no manifest yet" }, { status: 404 });
  }
  const text = fs.readFileSync(MANIFEST, "utf-8");
  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
