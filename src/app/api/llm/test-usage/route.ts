import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { getLLMConfig } from "@/lib/llm/server";
import {
  extractBase64DataUrl,
  extractMediaUrl,
  extractRemoteTaskId,
} from "@/lib/workshop/api-channel-shared";
import {
  VIDEO_POLL_TOTAL_MS,
  pollRemoteVideoTask,
  saveMediaToLocalTemp,
} from "~/lib/llm/video-task-util";
import { errorMessage } from "~/lib/error-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* chat / 生图 / 生视频的单次调用超时（生视频提交后若走任务制则由 video-task-util
 * 轮询取回，不受此上限约束，见 VIDEO_POLL_TOTAL_MS）。 */
const CHAT_TIMEOUT_MS = 60_000;
const MEDIA_TIMEOUT_MS = 180_000;

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
  const kind = strField(rec, "kind");
  const name = strField(rec, "name");
  const prompt = strField(rec, "prompt");
  const size = strField(rec, "size");
  const extraJson = strField(rec, "extraJson");
  const typedKey = strField(rec, "apiKey");
  const typedBase = strField(rec, "baseUrl");
  let path = strField(rec, "path");
  if (path !== "" && !path.startsWith("/")) path = `/${path}`;

  if (!["chat", "image", "video"].includes(kind)) {
    return NextResponse.json({
      ok: false,
      detail: `未知用途：${kind || "(空)"}`,
    });
  }
  if (!name) {
    return NextResponse.json({ ok: false, detail: "缺少模型名" });
  }
  if (!prompt) {
    return NextResponse.json({ ok: false, detail: "请填写提示词" });
  }
  // 条目名即模型参数值（设置页清单按模型名建条目）
  const model = name;

  // 条目已保存的连接参数（独立密钥 / 接口地址），按名字在服务端解析
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

  // 额外参数：必须是 JSON 对象，逐键合并进请求体（可覆盖默认字段）
  let extra: Record<string, unknown> = {};
  if (extraJson !== "") {
    try {
      const parsed: unknown = JSON.parse(extraJson);
      if (!isRecord(parsed)) throw new Error("不是 JSON 对象");
      extra = parsed;
    } catch (e) {
      return NextResponse.json({
        ok: false,
        detail: `额外参数不是有效的 JSON 对象：${errorMessage(e, "解析失败")}`,
      });
    }
  }

  const base = baseUrl.replace(/\/+$/, "");
  const endpoint = `${base}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const startedAt = Date.now();
  try {
    if (kind === "chat") {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          ...extra,
        }),
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok || !isRecord(payload)) {
        const detail = isRecord(payload)
          ? JSON.stringify(payload).slice(0, 240)
          : `HTTP ${res.status}`;
        return NextResponse.json({
          ok: false,
          detail: `HTTP ${res.status}：${detail}`,
        });
      }
      const choices: unknown = payload.choices;
      const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
      const message =
        isRecord(first) && isRecord(first.message) ? first.message : null;
      const content: unknown = message?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .map((p) =>
                  isRecord(p) && typeof p.text === "string" ? p.text : "",
                )
                .join("")
            : "";
      if (!text) {
        return NextResponse.json({
          ok: false,
          detail: `调用成功但未解析到回复文本：${JSON.stringify(payload).slice(0, 240)}`,
        });
      }
      return NextResponse.json({
        ok: true,
        detail: "调用成功",
        chatText: text,
        elapsedMs: Date.now() - startedAt,
      });
    }

    if (kind === "image") {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          ...(size !== "" ? { size } : {}),
          ...extra,
        }),
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = isRecord(payload)
          ? JSON.stringify(payload).slice(0, 240)
          : `HTTP ${res.status}`;
        return NextResponse.json({
          ok: false,
          detail: `HTTP ${res.status}：${detail}`,
        });
      }
      const url = extractMediaUrl(payload) ?? extractBase64DataUrl(payload);
      if (!url) {
        return NextResponse.json({
          ok: false,
          detail: `调用成功但未解析到图片 URL / b64 数据：${JSON.stringify(payload).slice(0, 240)}`,
        });
      }
      /* 产出的图片落到本地 temp 子目录一份（不是只给远端 URL） */
      const savedPath = await saveMediaToLocalTemp("image", name, url);
      return NextResponse.json({
        ok: true,
        detail: "生成成功",
        imageUrl: url,
        savedPath,
        elapsedMs: Date.now() - startedAt,
      });
    }

    // ── video：提交（同步 URL 或任务 ID），任务制则轮询到完成或超时 ──
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, prompt, ...extra }),
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = isRecord(payload)
        ? JSON.stringify(payload).slice(0, 240)
        : `HTTP ${res.status}`;
      return NextResponse.json({
        ok: false,
        detail: `HTTP ${res.status}：${detail}`,
      });
    }
    const directUrl = extractMediaUrl(payload);
    if (directUrl) {
      const savedPath = await saveMediaToLocalTemp("video", name, directUrl);
      return NextResponse.json({
        ok: true,
        detail: "生成成功",
        videoUrl: directUrl,
        savedPath,
        elapsedMs: Date.now() - startedAt,
      });
    }
    const taskId = extractRemoteTaskId(payload);
    if (!taskId) {
      return NextResponse.json({
        ok: false,
        detail: `响应中未找到视频 URL 或任务 ID：${JSON.stringify(payload).slice(0, 240)}`,
      });
    }
    const doneUrl = await pollRemoteVideoTask(base, path, model, taskId, headers);
    if (doneUrl) {
      const savedPath = await saveMediaToLocalTemp("video", name, doneUrl);
      return NextResponse.json({
        ok: true,
        detail: "生成成功",
        videoUrl: doneUrl,
        savedPath,
        elapsedMs: Date.now() - startedAt,
      });
    }
    return NextResponse.json({
      ok: true,
      detail: `任务已提交且仍在生成中（已等待 ${Math.round(VIDEO_POLL_TOTAL_MS / 1000)}s）。视频生成通常需要数十秒到几分钟，可点击「继续等待」再次查询，无需重新提交。`,
      taskId,
      pending: true,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      detail: errorMessage(e, "调用失败"),
      elapsedMs: Date.now() - startedAt,
    });
  }
}
