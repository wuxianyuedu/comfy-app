import { prisma } from "@/lib/db";
import { defineRoute, NotFoundError } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 迁移说明：手写 getServerUser + 404 {error:"任务不存在"} → defineRoute +
// NotFoundError；legacyError:true 保持 {error:string}；成功体 {job} 不变。

export const GET = defineRoute(async ({ params, user }) => {
  const { id } = params;
  const job = await prisma.loraTrainingJob.findFirst({
    where: { id, userId: user.id },
  });
  if (!job) throw new NotFoundError("任务不存在");
  return { job };
}, { legacyError: true });
