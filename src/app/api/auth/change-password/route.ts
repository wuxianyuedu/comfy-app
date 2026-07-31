import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLACEHOLDER = /^(demo-not-used|oauth-not-used)$/;

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");

  if (newPassword.length < 8) {
    return NextResponse.json({ error: "新密码至少 8 位" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  // Local single-user mode may start with a placeholder hash (demo / oauth).
  // In that case there is no "current password" to verify — just set the new one.
  const hasRealPassword = typeof user.passwordHash === "string" && !PLACEHOLDER.test(user.passwordHash);
  if (hasRealPassword) {
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "当前密码错误" }, { status: 400 });
    }
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });

  return NextResponse.json({ ok: true });
}
