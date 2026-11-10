import { type NextRequest, NextResponse } from "next/server";
import { isRecord } from "~/lib/is-record";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { getLLMConfig } from "~/lib/llm/server";
import { apiErrorDetail } from "~/lib/api-error";
import { chatHeaders } from "~/lib/llm/api-format";
import { httpFailureDetail } from "~/lib/llm/http-failure";
import { isLlmApiFormat, LLM_API_FORMATS, type LlmApiFormat } from "~/lib/llm/provider-types";
import { llmProviderRepository, remoteModelRepository } from "~/lib/core/repository";
import type { LlmProvider } from "~/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 探测超时：对端不可达时宁可早失败，前端有自己的降级展示。 */
const PROBE_TIMEOUT_MS = 6000;

/**
 * 一次格式探测的结论。三态而不是「成 / 败」两态，是为了让调用方知道
 * **换一种格式还值不值得再试**：
 *  · `ok` —— 通了（带服务端模型清单）；
 *  · `http` —— 对端答了，但状态码不是 2xx（可能是鉴权头形状不对，换格式有意义）；
 *  · `network` —— 连接层就失败了（DNS / 超时 / 拒绝），换格式只会白等一轮超时。
 */
type ProbeOutcome =
  | { detail: string; kind: "network" }
  | { detail: string; kind: "http" }
  | { detail: string; kind: "ok"; models: Array<string> };

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

/** 按一种接口格式探测 `GET {base}/models`（格式只影响鉴权头与 Anthropic 的 /v1 段）。 */
async function probeWithFormat(
  baseUrl: string,
  format: LlmApiFormat,
  apiKey: string,
  model: string,
): Promise<ProbeOutcome> {
  try {
    const headers = chatHeaders(format, apiKey);
    /* Anthropic 的模型清单在 `/v1/models`（Base URL 通常只到域名）；OpenAI 兼容
     * 那条链的 Base URL 一般自带 `/v1`，直接用 `{base}/models`。 */
    const probeBase =
      format === "anthropic-messages" && !/\/v1$/i.test(baseUrl.replace(/\/$/, ""))
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
      /* 探测地址一并点名：用户对照服务商文档改 Base URL 时，得先看清
       * 「我探的是哪一条」。整页 HTML 由 `httpFailureDetail` 翻成
       * 「这不是接口响应」，不再把标记灌进提示（#3517）。 */
      return {
        kind: "http",
        detail: httpFailureDetail({
          body: await res.text().catch(() => ""),
          status: res.status,
          url: `${probeBase.replace(/\/$/, "")}/models`,
        }),
      };
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
    return { kind: "ok", detail, models };
  } catch (error) {
    return { kind: "network", detail: apiErrorDetail(error, "连接失败") };
  }
}

/**
 * 探测的格式候选（去重）：显式给的格式**独占**，否则按「指定模型自己的 → 该供应商
 * 下各模型用到的 → 供应商默认」排列；一条格式信息都没有时才把三种格式都试一遍。
 *
 * 为什么显式给的那一种不再往后试：那是**模型行**的「测试连接」（模型级格式，
 * #3517）—— 它问的是「这条模型按它自己声明的协议能不能通」。若它 404 后偷偷换一种
 * 格式探通，界面会报绿而实际调用仍按原格式发出，等于把配置错误藏起来。
 *
 * 为什么要一串而不是一个（供应商级那条）：格式已下移到模型级，同一供应商下文本 /
 * 图片模型可能各用一套协议。供应商级问的是「这个 Base URL + 密钥至少能通一条我配过
 * 的协议吗」；只按一个默认值探，同一条链上「供应商测试绿 / 模型测试红」会再次出现。
 */
async function candidateFormats(input: {
  explicit: unknown;
  model: string;
  provider: LlmProvider | null;
}): Promise<Array<LlmApiFormat>> {
  if (isLlmApiFormat(input.explicit)) {
    return [input.explicit];
  }
  const out: Array<LlmApiFormat> = [];
  const add = (candidate: unknown): void => {
    if (isLlmApiFormat(candidate) && !out.includes(candidate)) {
      out.push(candidate);
    }
  };
  const provider = input.provider;
  if (provider !== null) {
    const owned = (await remoteModelRepository.list()).filter((r) => r.providerId === provider.id);
    add(owned.find((r) => r.name === input.model)?.apiFormat);
    for (const row of owned) {
      add(row.apiFormat);
    }
    add(provider.apiFormat);
  }
  if (out.length === 0) {
    for (const format of LLM_API_FORMATS) {
      add(format);
    }
  }
  return out;
}

/**
 * POST /api/llm/test —— 测试上游接口连通性（设置页供应商 / 模型行用）。body 的
 * baseUrl/apiKey/apiFormat 省略或空白时回落到已保存配置：给了 `providerId` 就用该
 * 供应商的 Base URL / 密钥（浏览器拿不到明文密钥，只能由服务端代查），否则回落到
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

  if (!baseUrl) {
    return NextResponse.json({
      ok: false,
      detail: "接口地址为空，请先填写或保存 Base URL",
    });
  }

  const formats = await candidateFormats({ explicit: rec.apiFormat, model, provider });
  let firstFailure: ProbeOutcome | null = null;
  for (const format of formats) {
    // oxlint-disable-next-line no-await-in-loop -- 逐个格式探测：前一种通了就不再发（省掉无谓请求）
    const outcome = await probeWithFormat(baseUrl, format, apiKey, model);
    if (outcome.kind === "ok") {
      return NextResponse.json({ ok: true, detail: outcome.detail, models: outcome.models });
    }
    if (outcome.kind === "network") {
      return NextResponse.json({ ok: false, detail: outcome.detail });
    }
    firstFailure ??= outcome;
  }
  return NextResponse.json({
    ok: false,
    detail: firstFailure?.detail ?? "连接失败",
  });
}
