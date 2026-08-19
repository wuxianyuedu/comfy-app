import { NextRequest, NextResponse } from "next/server";
import { container } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 模型目录是**公共可读**的（不绑定用户、无需登录）。本路由仅做去裸 Prisma 改造：
// 数据访问收口到 `ModelRepository.list()`，where 构造与原实现完全等价，响应体
// `{ models }` 保持不变。因不强制认证且返回形态特殊，故不套用 `defineRoute`
// （其默认强制 401 + 结构化信封会破坏公共读取契约）。

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  const q = sp.get("q");
  const repo = container.resolve("modelRepository");
  const models = await repo.list({
    type: type ?? undefined,
    q: q ?? undefined,
  });
  return NextResponse.json({ models });
}
