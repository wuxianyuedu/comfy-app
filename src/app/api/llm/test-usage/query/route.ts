import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { getLLMConfig } from "@/lib/llm/server";
import {
  VIDEO_POLL_TOTAL_MS,
  pollRemoteVideoTask,
  saveMediaToLocalTemp,
} from "~/lib/llm/video-task-util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/llm/test-usage/query —— 「继续等待」一次已经提交的异步视频任务。
 *
 * 视频接口多为任务制：首次提交（/api/llm/test-usage）内置轮询一轮后若产物
 * 仍未就绪，会以 { pending:true, taskId } 返回。此时视频仍在提供方后台生成，
 * 用户点「继续等待」即调到本路由：以同一 taskId 再轮询一轮，读到了就把视频
 * 下载存到本地 temp 并返回，否则再报 pending 让用户可继续点。
 *
 * 关键：本路由只查既有任务，绝不重新提交 —— 不会重复扣费 / 生成第二个视频。
 * 连接参数与密钥解析与提交路由保持一致（弹窗里输入的 baseUrl/path/apiKey
 * 优先，其次该条目已保存值，再回落全局），taskId 必填。
 *
 * 失败一律 200 + { ok:false, detail }，前端按 detail 展示降级文案。
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function strField(rec: Record<string, unknown>, key: string): string {
  const v: unknown = rec[key];
  return typeof v === "string" ? v.trim() : "";
}

/** 取第一个非空白字符串（空串视为未填，继续向后回落）。 */
function firstNonEmpty(...vals: Array<string | null | undefined>): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return "";
}

export async function POST(req: NextRequest) {
  await getServerUser();

  const body: unknown = await req.json().catch(() => ({}));
  const rec = isRecord(body) ? body : {};
  const name = strField(rec, "name");
  const model = name; // 条目名即模型参数值（与提交路由一致）
  const taskId = strField(rec, "taskId");
  const typedKey = strField(rec, "apiKey");
  const typedBase = strField(rec, "baseUrl");
  let path = strField(rec, "path");
  if (path !== "" && !path.startsWith("/")) path = `/${path}`;

  if (!name) {
    return NextResponse.json({ ok: false, detail: "缺少模型名" });
  }
  if (!taskId) {
    return NextResponse.json({ ok: false, detail: "缺少任务 ID，无法继续查询" });
  }

  // 连接参数解析：弹窗输入 → 条目已保存 → 全局（与提交路由同一口径）
  const cfg = await getLLMConfig();
  const entry = cfg.extraModels?.find((e) => e.name === name);
  const baseUrl = firstNonEmpty(typedBase, entry?.baseUrl, cfg.baseUrl);
  const apiKey = firstNonEmpty(typedKey, entry?.apiKey, cfg.apiKey);
  if (!baseUrl) {
    return NextResponse.json({
      ok: false,
      detail: "接口地址为空：请在弹窗内填写，或先在条目里保存接口地址",
    });
  }

  const base = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const startedAt = Date.now();
  try {
    const url = await pollRemoteVideoTask(base, path, model, taskId, headers);
    if (url) {
      const savedPath = await saveMediaToLocalTemp("video", name, url);
      return NextResponse.json({
        ok: true,
        detail: "生成成功",
        videoUrl: url,
        savedPath,
        elapsedMs: Date.now() - startedAt,
      });
    }
    return NextResponse.json({
      ok: true,
      detail: `任务仍在生成中（本次已等待 ${Math.round(VIDEO_POLL_TOTAL_MS / 1000)}s）`,
      taskId,
      pending: true,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "查询失败";
    return NextResponse.json({
      ok: false,
      detail: msg,
      elapsedMs: Date.now() - startedAt,
    });
  }
}
