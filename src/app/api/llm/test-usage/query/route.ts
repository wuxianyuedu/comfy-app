import { type NextRequest, NextResponse } from "next/server";
import {
  pendingDetail,
  queryVideoTask,
  saveMediaToLocalTemp,
  strField,
} from "~/lib/llm/usage-test.server";
import { apiErrorDetail } from "~/lib/api-error";
import { usageTestEntry } from "../entry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/llm/test-usage/query —— 对已提交的异步视频任务再轮询一轮（「继续等待」）。
 * 关键：只查既有任务、**绝不重新提交** —— 不会重复扣费 / 生成第二个视频；连接参数、轮询地址与超时口径与提交路由共用 `usage-test.server` 同一份实现。
 * 失败一律 200 + `{ ok:false, detail }`，前端按 detail 展示降级文案。
 */
export async function POST(req: NextRequest) {
  const entry = await usageTestEntry(req, "llm-test-usage-query");
  if (entry instanceof Response) {
    return entry;
  }
  const { name, rec, up } = entry;
  const model = name; // 条目名即模型参数值（与提交路由一致）
  const taskId = strField(rec, "taskId");

  if (!taskId) {
    return NextResponse.json({
      ok: false,
      detail: "缺少任务 ID，无法继续查询",
    });
  }

  const startedAt = Date.now();
  try {
    const r = await queryVideoTask(up, model, taskId);
    if (r.done) {
      const savedPath = await saveMediaToLocalTemp("video", name, r.url);
      return NextResponse.json({
        ok: true,
        detail: "生成成功",
        videoUrl: r.url,
        savedPath,
        elapsedMs: Date.now() - startedAt,
      });
    }
    return NextResponse.json({
      ok: true,
      detail: pendingDetail("任务仍在生成中"),
      taskId,
      pending: true,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      detail: apiErrorDetail(error, "查询失败"),
      elapsedMs: Date.now() - startedAt,
    });
  }
}
