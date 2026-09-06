import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { getLLMConfig } from "@/lib/llm/server";
import {
  extractBase64DataUrl,
  extractMediaUrl,
  extractRemoteTaskId,
} from "@/lib/workshop/api-channel-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/llm/test-usage —— 按模型的实际用法发起一次真实调用。
 *
 * 与 /api/llm/test（连通性探测，GET /models）不同：这里按用途真的调
 * chat / 生图 / 生视频端点，验证「照实际用法能用」。图片 / 视频会真实
 * 生成、消耗提供方额度，由调用方（测试弹窗）向用户预告。
 *
 * 密钥解析（服务端完成，浏览器不接触明文）：弹窗里输入的 apiKey →
 * 该条目已保存的独立密钥 → 全局 apiKey。
 * 「额外参数」是 JSON 对象，逐键合并进请求体，可覆盖默认字段 ——
 * 支撑「针对每个参数自定义输入内容」。
 *
 * 失败一律 200 + { ok:false, detail }，前端按 detail 展示降级文案。
 */

const CHAT_TIMEOUT_MS = 60_000;
const MEDIA_TIMEOUT_MS = 180_000;
const VIDEO_POLL_TOTAL_MS = 90_000;
const VIDEO_POLL_INTERVAL_MS = 5_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const msg: unknown = e.message;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

function strField(rec: Record<string, unknown>, key: string): string {
  const v: unknown = rec[key];
  return typeof v === "string" ? v.trim() : "";
}

/** 端点路径的目录部分（/videos/generations → /videos），用于任务轮询拼接。 */
function pathDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "" : path.slice(0, idx);
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
    return NextResponse.json({ ok: false, detail: `未知用途：${kind || "(空)"}` });
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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
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
        return NextResponse.json({ ok: false, detail: `HTTP ${res.status}：${detail}` });
      }
      const choices: unknown = payload.choices;
      const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
      const message = isRecord(first) && isRecord(first.message) ? first.message : null;
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
        return NextResponse.json({ ok: false, detail: `HTTP ${res.status}：${detail}` });
      }
      const url = extractMediaUrl(payload) ?? extractBase64DataUrl(payload);
      if (!url) {
        return NextResponse.json({
          ok: false,
          detail: `调用成功但未解析到图片 URL / b64 数据：${JSON.stringify(payload).slice(0, 240)}`,
        });
      }
      return NextResponse.json({
        ok: true,
        detail: "生成成功",
        imageUrl: url,
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
      return NextResponse.json({ ok: false, detail: `HTTP ${res.status}：${detail}` });
    }
    const directUrl = extractMediaUrl(payload);
    if (directUrl) {
      return NextResponse.json({
        ok: true,
        detail: "生成成功",
        videoUrl: directUrl,
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
    const pollBase = `${base}${pathDir(path)}`;
    const deadline = Date.now() + VIDEO_POLL_TOTAL_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
      let pollPayload: unknown = null;
      try {
        const pollRes = await fetch(`${pollBase}/${taskId.replace(/^\/+/, "")}`, {
          headers,
          signal: AbortSignal.timeout(30_000),
        });
        pollPayload = await pollRes.json().catch(() => null);
        if (pollRes.ok) {
          const url = extractMediaUrl(pollPayload);
          if (url) {
            return NextResponse.json({
              ok: true,
              detail: "生成成功",
              videoUrl: url,
              elapsedMs: Date.now() - startedAt,
            });
          }
        }
      } catch {
        // 单次轮询失败不终止 —— 网关抖动常见，继续等下一轮
      }
    }
    return NextResponse.json({
      ok: true,
      detail: `任务已提交且仍在生成中（已等待 ${Math.round(VIDEO_POLL_TOTAL_MS / 1000)}s）`,
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
