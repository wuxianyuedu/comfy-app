import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { getLLMConfig } from "@/lib/llm/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 探测超时：对端不可达时宁可早失败，前端有自己的降级展示。 */
const PROBE_TIMEOUT_MS = 6000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 提取错误信息,等价原 `e?.message ?? fallback`(catch 变量为 unknown 后的窄化版)。 */
function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const msg: unknown = e.message;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

/**
 * POST /api/llm/test —— 测试 OpenAI 兼容接口连通性（设置页「添加模型」弹窗用）。
 *
 * body 的 baseUrl / apiKey 省略或为空白时回落到已保存的全局配置，支撑
 * 「留空则使用全局」的语义。成功时顺带返回服务端模型清单（GET {base}/models），
 * 供弹窗内点选填入模型名称。
 *
 * 探测失败不是硬错误：一律 200 + { ok, detail }，前端按 detail 展示降级文案。
 */
export async function POST(req: NextRequest) {
  await getServerUser();

  const body: unknown = await req.json().catch(() => ({}));
  const rec = isRecord(body) ? body : {};
  const cfg = await getLLMConfig();

  const rawBaseUrl: unknown = rec.baseUrl;
  const baseUrl =
    typeof rawBaseUrl === "string" && rawBaseUrl.trim() !== ""
      ? rawBaseUrl.trim()
      : cfg.baseUrl;
  const rawApiKey: unknown = rec.apiKey;
  const apiKey =
    typeof rawApiKey === "string" && rawApiKey.trim() !== ""
      ? rawApiKey.trim()
      : (cfg.apiKey ?? "");
  const rawModel: unknown = rec.model;
  const model = typeof rawModel === "string" ? rawModel.trim() : "";

  if (!baseUrl) {
    return NextResponse.json({ ok: false, detail: "接口地址为空，请先填写或保存 Base URL" });
  }

  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      return NextResponse.json({
        ok: false,
        detail: `HTTP ${res.status}${snippet ? `：${snippet}` : ""}`,
      });
    }
    const parsed: unknown = await res.json();
    // OpenAI 兼容 /models → { data: [{ id }] }
    const rawList = isRecord(parsed) ? parsed.data : undefined;
    const models = Array.isArray(rawList)
      ? rawList
          .map((m) => (isRecord(m) && typeof m.id === "string" ? m.id.trim() : ""))
          .filter((n) => n !== "")
      : [];
    let detail = `连接成功，服务端共 ${models.length} 个模型`;
    if (model !== "" && !models.includes(model)) {
      detail = `连接成功，但「${model}」不在服务端模型列表中，请确认名称是否正确`;
    }
    return NextResponse.json({ ok: true, detail, models });
  } catch (e) {
    return NextResponse.json({ ok: false, detail: errorMessage(e, "连接失败") });
  }
}
