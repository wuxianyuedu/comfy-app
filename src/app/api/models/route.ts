import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  const q = sp.get("q");
  const where: Record<string, unknown> = { isAvailable: true };
  if (type) where.type = type;
  if (q) where.name = { contains: q };

  const models = await prisma.model.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return NextResponse.json({ models });
}
