import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const newEmail = String(body?.newEmail ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(newEmail)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: newEmail } });
  if (existing && existing.email !== email) {
    return NextResponse.json({ error: "该邮箱已被占用" }, { status: 409 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  await prisma.user.update({ where: { id: user.id }, data: { email: newEmail } });

  return NextResponse.json({ ok: true, email: newEmail });
}
