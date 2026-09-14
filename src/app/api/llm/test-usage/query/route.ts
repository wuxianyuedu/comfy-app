import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import {
  isRecord,
  normalizeEndpointPath,
  pendingDetail,
  queryVideoTask,
  resolveUpstream,
  saveMediaToLocalTemp,
  strField,
} from "~/lib/llm/usage-test.server";
import { errorMessage } from "~/lib/error-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/llm/test-usage/query —— 「继续等待」一次已经提交的异步视频任务。
 *
 * 视频接口多为任务制：首次提交（`/api/llm/test-usage`）内置轮询一轮后若产物
 * 仍未就绪，会以 `{ pending:true, taskId }` 返回。此时视频仍在提供方后台生成，
 * 用户点「继续等待」即调到本路由：以同一 taskId 再轮询一轮，读到了就把视频
 * 下载存到本地 temp 并返回，否则再报 pending 让用户可继续点。
 *
 * 关键：本路由只查既有任务，**绝不重新提交** —— 不会重复扣费 / 生成第二个视频。
 * 连接参数与密钥解析、轮询地址形状与超时口径都与提交路由同一份实现
 *（`@/lib/llm/usage-test.server`），避免「一处改了另一处没改」的行为分叉。
 *
 * 失败一律 200 + `{ ok:false, detail }`，前端按 detail 展示降级文案。
 */
export async function POST(req: NextRequest) {
  await getServerUser();

  const body: unknown = await req.json().catch(() => ({}));
  const rec = isRecord(body) ? body : {};
  const name = strField(rec, "name");
  const model = name; // 条目名即模型参数值（与提交路由一致）
  const taskId = strField(rec, "taskId");

  if (!name) return NextResponse.json({ ok: false, detail: "缺少模型名" });
  if (!taskId) return NextResponse.json({ ok: false, detail: "缺少任务 ID，无法继续查询" });

  const up = await resolveUpstream(
    name,
    strField(rec, "baseUrl"),
    strField(rec, "apiKey"),
    normalizeEndpointPath(strField(rec, "path")),
  );
  if ("error" in up) return NextResponse.json({ ok: false, detail: up.error });

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
  } catch (e) {
    return NextResponse.json({
      ok: false,
      detail: errorMessage(e, "查询失败"),
      elapsedMs: Date.now() - startedAt,
    });
  }
}
