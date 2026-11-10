import { type NextRequest, NextResponse } from "next/server";
import { isRecord } from "~/lib/is-record";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { getLLMConfig } from "~/lib/llm/server";
import { apiErrorDetail } from "~/lib/api-error";
import { chatHeaders } from "~/lib/llm/api-format";
import { isLlmApiFormat, type LlmApiFormat } from "~/lib/llm/provider-types";
import { llmProviderRepository } from "~/lib/core/repository";
import { INLINE_SNIPPET_MAX, clampText } from "~/lib/text-clamp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 探测超时：对端不可达时宁可早失败，前端有自己的降级展示。 */
const PROBE_TIMEOUT_MS = 6000;

/**
 * POST /api/llm/test —— 测试上游接口连通性（设置页供应商 / 模型行用）。body 的
 * baseUrl/apiKey 省略或空白时回落到已保存配置：给了 `providerId` 就用该供应商的
 * Base URL / 格式 / 密钥（浏览器拿不到明文密钥，只能由服务端代查），否则回落到
 * 全局配置（历史语义）。成功时顺带返回服务端模型清单。探测失败不是硬错误：
 * 一律 200 + { ok, detail }，前端按 detail 降级展示。
 */
export async function POST(req: NextRequest) {
  if (!(await requireRequestUser())) {
    return unauthorizedResponse();
  }

  const body: unknown = await req.json().catch(() => ({}));
  const rec = isRecord(body) ? body : {};
  const cfg = await getLLMConfig();

  const rawProviderId: unknown = rec.providerId;
  const providerId = typeof rawProviderId === "string" ? rawProviderId.trim() : "";
  const provider = providerId === "" ? null : await llmProviderRepository.findById(providerId);
  if (providerId !== "" && provider === null) {
    return NextResponse.json({ ok: false, detail: "供应商不存在，请刷新后重试" });
  }

  const rawBaseUrl: unknown = rec.baseUrl;
  const baseUrl =
    typeof rawBaseUrl === "string" && rawBaseUrl.trim() !== ""
      ? rawBaseUrl.trim()
      : provider !== null && provider.baseUrl.trim() !== ""
        ? provider.baseUrl.trim()
        : cfg.baseUrl;
  const rawApiKey: unknown = rec.apiKey;
  const apiKey =
    typeof rawApiKey === "string" && rawApiKey.trim() !== ""
      ? rawApiKey.trim()
      : (provider?.apiKey ?? cfg.apiKey ?? "");
  const rawModel: unknown = rec.model;
  const model = typeof rawModel === "string" ? rawModel.trim() : "";
  const rawFormat: unknown = rec.apiFormat;
  const apiFormat: LlmApiFormat = isLlmApiFormat(rawFormat)
    ? rawFormat
    : provider !== null && isLlmApiFormat(provider.apiFormat)
      ? provider.apiFormat
      : "chat-completions";

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
      if (segs.length === 0) {
        return null;
      }
      const last = segs.at(-1)?.toLowerCase() ?? "";
      if (
        !["images", "videos", "chat", "completions", "embeddings", "audio", "moderations"].includes(
          last,
        )
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
    const headers = chatHeaders(apiFormat, apiKey);
    /* Anthropic 的模型清单在 `/v1/models`（Base URL 通常只到域名）；OpenAI 兼容
     * 那条链的 Base URL 一般自带 `/v1`，直接用 `{base}/models`。 */
    const probeBase =
      apiFormat === "anthropic-messages" && !/\/v1$/i.test(baseUrl.replace(/\/$/, ""))
        ? `${baseUrl.replace(/\/$/, "")}/v1`
        : baseUrl;
    const probe = (base: string) =>
      fetch(`${base.replace(/\/$/, "")}/models`, {
        headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

    let probedBase = probeBase;
    let fellBack = false;
    let res = await probe(probeBase);
    /* 404/405 = 路径不存在；400 也回退 —— 资源型网关会把 {base}/models 当成
     * 业务请求处理（如 Agnes 视频接口把 models 当 task_id 查询，返回
     * 400 task_not_exist），而不是标准的「路径不存在」。鉴权问题（401/403）
     * 原样透出，不重试。 */
    if ([400, 404, 405].includes(res.status)) {
      const parent = parentBase(probeBase);
      if (parent !== null && parent !== "") {
        const parentRes = await probe(parent);
        if (parentRes.ok) {
          probedBase = parent;
          fellBack = true;
          res = parentRes;
        }
      }
    }
    if (!res.ok) {
      const snippet = clampText(await res.text().catch(() => ""), {
        maxLength: INLINE_SNIPPET_MAX,
        marker: "",
      });
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
    /* 只有**真的回退**过才念这句：Anthropic 的 `/v1` 是格式自带的路径，
     * 不是「用户填错后回退」，把它读成回退会误导用户去改 Base URL。 */
    if (fellBack) {
      detail += `（探测已回退到 ${probedBase}/models —— 填写的接口地址含资源子路径）`;
    }
    if (model !== "" && !models.includes(model)) {
      detail = `连接成功，但「${model}」不在服务端模型列表中，请确认名称是否正确`;
    }
    return NextResponse.json({ ok: true, detail, models });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      detail: apiErrorDetail(error, "连接失败"),
    });
  }
}
