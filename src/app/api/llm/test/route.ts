import { type NextRequest, NextResponse } from "next/server";
import { isRecord } from "~/lib/is-record";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { getLLMConfig } from "~/lib/llm/server";
import { apiErrorDetail } from "~/lib/api-error";
import { chatHeaders } from "~/lib/llm/api-format";
import { httpFailureDetail } from "~/lib/llm/http-failure";
import {
  isLlmApiFormat,
  joinApiUrl,
  LLM_API_FORMATS,
  type LlmApiFormat,
} from "~/lib/llm/provider-types";
import { llmProviderRepository, remoteModelRepository } from "~/lib/core/repository";
import type { LlmProvider } from "~/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 探测超时：对端不可达时宁可早失败，前端有自己的降级展示。 */
const PROBE_TIMEOUT_MS = 6000;

/** Base URL 末段可能被填成「资源段」的名词（用户按完整端点减动作的习惯填）。
 *  探测前剥掉，交给 /models 统一拼。 */
const RESOURCE_SEGMENTS: ReadonlyArray<string> = [
  "images",
  "videos",
  "chat",
  "completions",
  "embeddings",
  "audio",
  "moderations",
];

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
 *  用户按「完整端点减动作」的习惯填 base（如 …/v1/images）时先归一，
 *  版本段与 /models 的拼接交给 `joinApiUrl`（#3656：Base 不带版本段时自动补 /v1）。 */
function probeBaseOf(url: string): string {
  try {
    const u = new URL(url.trim());
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs.at(-1)?.toLowerCase() ?? "";
    if (RESOURCE_SEGMENTS.includes(last)) {
      segs.pop();
      u.pathname = segs.length > 0 ? `/${segs.join("/")}` : "/";
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

/** 探测 URL 的拼装：`{版本段}/models` —— Base 不带版本段时 `joinApiUrl` 补 /v1
 *  （#3656：测试连接固定用 /v1/models）。 */
function probeModelsUrl(base: string): string {
  return joinApiUrl(base, "/models");
}

/** 按一种接口格式探测 `GET {base}/models`（格式只影响鉴权头；路径统一由
 *  `probeModelsUrl` 拼，不再按格式分叉 —— /v1/models 对三种格式通用，#3656）。 */
async function probeWithFormat(
  baseUrl: string,
  format: LlmApiFormat,
  apiKey: string,
  model: string,
): Promise<ProbeOutcome> {
  try {
    const headers = chatHeaders(format, apiKey);
    const base = probeBaseOf(baseUrl);
    const res = await fetch(probeModelsUrl(base), {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      /* 探测地址一并点名：用户对照服务商文档改 Base URL 时，得先看清
       * 「我探的是哪一条」。整页 HTML 由 `httpFailureDetail` 翻成
       * 「这不是接口响应」，不再把标记灌进提示（#3517）。 */
      return {
        kind: "http",
        detail: httpFailureDetail({
          body: await res.text().catch(() => ""),
          status: res.status,
          url: probeModelsUrl(base),
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
 * 为什么显式给的那一种不再往后试：显式 `apiFormat` 是调用方指名的口径 —— 若它
 * 404 后偷偷换一种格式探通，界面会报绿而实际调用仍按原格式发出，等于把配置
 * 错误藏起来（模型行自己的「测试连接」已随 #3618 撤掉，探测统一走供应商级）。
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
 * POST /api/llm/test —— 测试上游接口连通性（设置页供应商用）。body 的
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
  let firstOk: Extract<ProbeOutcome, { kind: "ok" }> | null = null;
  for (const format of formats) {
    // oxlint-disable-next-line no-await-in-loop -- 逐个格式探测：前一种通了就不再发（省掉无谓请求）
    const outcome = await probeWithFormat(baseUrl, format, apiKey, model);
    if (outcome.kind === "ok") {
      firstOk = outcome;
      break;
    }
    if (outcome.kind === "network") {
      return NextResponse.json({ ok: false, detail: outcome.detail });
    }
    firstFailure ??= outcome;
  }
  if (firstOk !== null) {
    /* 目录同步（#3577「获取到的模型应该全部显示出来，默认关闭状态」）：
     * 连接成功即把服务端模型清单补进该供应商名下 —— 已存在的名字一行不动，
     * 缺的插成停用行，启用 / 配置在模型列表上做。没有 providerId（弹窗草稿、
     * 全局配置探测）不落库。落库失败不推翻连通性结论：下次成功的探测会再补。
     * （放在探测循环之外：同步至多一次，也不在循环体里再叠一层 await。） */
    if (providerId !== "" && firstOk.models.length > 0) {
      try {
        await remoteModelRepository.syncProviderCatalog(providerId, firstOk.models);
      } catch (error) {
        console.error("[llm/test] 服务端模型目录同步失败:", apiErrorDetail(error, "同步失败"));
      }
    }
    return NextResponse.json({ ok: true, detail: firstOk.detail, models: firstOk.models });
  }
  return NextResponse.json({
    ok: false,
    detail: firstFailure?.detail ?? "连接失败",
  });
}
