import { type NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth-server";
import { getLLMConfig } from "@/lib/llm/server";
import { errorMessage } from "~/lib/error-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 探测超时：对端不可达时宁可早失败，前端有自己的降级展示。 */
const PROBE_TIMEOUT_MS = 6000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
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
    return NextResponse.json({
      ok: false,
      detail: "接口地址为空，请先填写或保存 Base URL",
    });
  }

  /** 剥掉末段资源路径（/images、/videos 等）得到上一层 base。
   *  用户按「完整端点减动作」的习惯填 base（如 …/v1/images），而
   *  GET {base}/models 只在 /v1 层存在 —— 404 时自动回退一层再试。 */
  function parentBase(url: string): string | null {
    try {
      const u = new URL(url);
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs.length === 0) return null;
      const last = segs[segs.length - 1]?.toLowerCase() ?? "";
      if (
        ![
          "images",
          "videos",
          "chat",
          "completions",
          "embeddings",
          "audio",
          "moderations",
        ].includes(last)
      ) {
        return null;
      }
      segs.pop();
      u.pathname = segs.length > 0 ? `/${segs.join("/")}` : "/";
      return u.toString().replace(/\/$/, "");
    } catch {
      return null;
    }
  }

  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const probe = (base: string) =>
      fetch(`${base.replace(/\/$/, "")}/models`, {
        headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

    let probedBase = baseUrl;
    let res = await probe(baseUrl);
    /* 404/405 = 路径不存在；400 也回退 —— 资源型网关会把 {base}/models 当成
     * 业务请求处理（如 Agnes 视频接口把 models 当 task_id 查询，返回
     * 400 task_not_exist），而不是标准的「路径不存在」。鉴权问题（401/403）
     * 原样透出，不重试。 */
    if ([400, 404, 405].includes(res.status)) {
      const parent = parentBase(baseUrl);
      if (parent) {
        const parentRes = await probe(parent);
        if (parentRes.ok) {
          probedBase = parent;
          res = parentRes;
        }
      }
    }
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
          .map((m) =>
            isRecord(m) && typeof m.id === "string" ? m.id.trim() : "",
          )
          .filter((n) => n !== "")
      : [];
    let detail = `连接成功，服务端共 ${models.length} 个模型`;
    if (probedBase !== baseUrl) {
      detail += `（探测已回退到 ${probedBase}/models —— 填写的接口地址含资源子路径）`;
    }
    if (model !== "" && !models.includes(model)) {
      detail = `连接成功，但「${model}」不在服务端模型列表中，请确认名称是否正确`;
    }
    return NextResponse.json({ ok: true, detail, models });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      detail: errorMessage(e, "连接失败"),
    });
  }
}
