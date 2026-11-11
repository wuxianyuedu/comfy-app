/* ── 「模型实际使用」测试的服务端共享实现（提交 + 继续等待两个路由共用）──
 * `POST /api/llm/test-usage`（提交一次调用）与
 * `POST /api/llm/test-usage/query`（对已提交的异步视频任务再等一轮）
 * 是同一个弹窗的两个动作。两者的**请求解析、连接参数回落、上游调用与
 * 结果归一化**曾经各写一份 —— 按行统计，query 路由 84% 的行能在提交路由
 * 里找到对应（ISSUE #536 P2 的同一类问题：改一处漏一处 = 静默行为分叉，
 * 这次分叉的是「密钥怎么解析」）。
 *
 * 本模块把那部分收到一处，路由只剩「HTTP 形状」（读 body、包 NextResponse）。
 *
 * 分层：只允许服务端（路由 / server）引入 —— 它读 `getLLMConfig()` 与
 * `node:fs`。浏览器侧的类型与 fetch 见 `usage-test-client.ts`。
 */

import { getLLMConfig } from "~/lib/llm/server";
import { errorMessage } from "~/lib/error-message";
import { httpFailureDetail } from "~/lib/llm/http-failure";
import { INLINE_JSON_SNIPPET_MAX, clampText } from "~/lib/text-clamp";
import {
  extractBase64DataUrl,
  extractMediaUrl,
  extractRemoteTaskId,
} from "~/lib/workshop/api-channel-shared";
import {
  VIDEO_POLL_TOTAL_MS,
  pollRemoteVideoTask,
  saveMediaToLocalTemp,
} from "~/lib/llm/video-task-util";
import { isRecord } from "~/lib/is-record";
import { REMOTE_MODEL_KINDS, type RemoteModelKind } from "~/lib/llm/types";
import { llmProviderRepository, remoteModelRepository } from "~/lib/core/repository";

/** chat / 生图 / 生视频的单次调用超时（生视频提交后若走任务制则由
 *  video-task-util 轮询取回，不受此上限约束，见 VIDEO_POLL_TOTAL_MS）。 */
export const CHAT_TIMEOUT_MS = 60_000;
export const MEDIA_TIMEOUT_MS = 180_000;

/** 允许的用途 —— **与「可标注的用途」是同一张词表**（ISSUE #2170 业主拍板「并成一份」）。
 *
 *  此前这里是三份独立真相之一（另两份在 usage-test-client / usage-field-editor），
 *  三处恰好等值全靠人记。并成一份的自动护栏：下方按 `Record<UsageTestKind,…>`
 *  建的模板表（本文件按 kind 的分支、设置页弹窗的默认参数/标签表）在 tsc 下
 *  **必须穷尽** —— 往 REMOTE_MODEL_KINDS 加一种（如 audio）而不同批补端点模板，
 *  类型检查当场红，而不是运行时悄悄少一档。 */
export const USAGE_TEST_KINDS = REMOTE_MODEL_KINDS;
export type UsageTestKind = RemoteModelKind;

/** 取一个 trim 过的字符串字段（缺省/类型不对一律给空串）。 */
export function strField(rec: Record<string, unknown>, key: string): string {
  const v: unknown = rec[key];
  return typeof v === "string" ? v.trim() : "";
}

/** 取第一个非空白字符串（空串视为未填，继续向后回落）。 */
export function firstNonEmpty(...vals: Array<string | null | undefined>): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") {
      return v;
    }
  }
  return "";
}

/** 端点路径归一：非空时必须根相对，否则 `${base}${path}` 拼不出合法地址。 */
export function normalizeEndpointPath(raw: string): string {
  if (raw !== "" && !raw.startsWith("/")) {
    return `/${raw}`;
  }
  return raw;
}

export type ResolvedUpstream = {
  /** 去掉尾斜杠的连接基址。 */
  base: string;
  headers: Record<string, string>;
  /** 根相对的端点路径（空串 = 直接用 base）。 */
  path: string;
};

/** 供应商链直查的结论（#3577）：模型挂在哪个供应商下、那家的地址与密钥。
 *  `ok:false` = 读库失败（SQLite busy 等）——按「查不到」处理，不让测试整条断掉。 */
type ProviderChainLookup =
  | {
      /** 供应商有没有配密钥（可读报错的判据）。 */
      hasKey: boolean;
      ok: true;
      /** 供应商已保存的明文密钥（repository 读出即已解密；没配为 null）。 */
      providerApiKey: string | null;
      /** 供应商自己的 Base URL（entry 缺席时的地址兜底）。 */
      providerBaseUrl: string | null;
      /** 供应商名（可读报错里点名用）；模型不挂供应商时为 null。 */
      providerName: string | null;
    }
  | { ok: false };

/** 按模型名直查 remoteModel → llmProvider 一轮（**不经过 `getLLMConfig`**）。
 *  为什么要独立于 entry 解析再查一次：`getLLMConfig` 的读库失败会被 catch 吞掉、
 *  整体回落 env 默认（`extraModels` 变空）——表现恰好是「请求地址对（弹窗 typed
 *  值还在）、密钥却没带」，上游答 401 "Token not provided"，现场看不出原因
 *  （#3577 评论 4 的截图）。这条直查是**第二把钥匙**：第一把（entry 合并）失手
 *  时它仍能从供应商行里拿回密钥与地址；两把都失手时至少能给出「供应商没配密钥」
 *  的可读报错，而不是让上游替我们说一句谜语。 */
async function lookupProviderChain(name: string): Promise<ProviderChainLookup> {
  try {
    const row = await remoteModelRepository.findByName(name);
    const provider =
      row?.providerId === null || row?.providerId === undefined
        ? null
        : await llmProviderRepository.findById(row.providerId);
    if (provider === null) {
      return {
        ok: true,
        hasKey: false,
        providerApiKey: null,
        providerBaseUrl: null,
        providerName: null,
      };
    }
    return {
      ok: true,
      hasKey: Boolean(provider.apiKey),
      providerApiKey: provider.apiKey?.trim() ? provider.apiKey.trim() : null,
      providerBaseUrl: provider.baseUrl.trim() === "" ? null : provider.baseUrl.trim(),
      providerName: provider.name,
    };
  } catch {
    return { ok: false };
  }
}

/** 连接参数解析（**两个路由同一口径**，解析顺序改了只有这一处）：
 *  弹窗内填的 → 该条目已保存的 → 该条目所属供应商的（#3577 直查兜底）→ 全局配置。
 *  密钥全空且模型确有所属供应商（又没配密钥）时给可读报错 —— 密钥缺失不该被
 *  静默发出去，让上游用 401 谜语代替我们说话。 */
export async function resolveUpstream(
  name: string,
  typedBase: string,
  typedKey: string,
  rawPath: string,
): Promise<ResolvedUpstream | { error: string }> {
  const cfg = await getLLMConfig();
  const entry = cfg.extraModels?.find((e) => e.name === name);
  const chain = await lookupProviderChain(name);

  const baseUrl = firstNonEmpty(
    typedBase,
    entry?.baseUrl,
    /* 供应商地址：entry 合并成功时它已折进 entry.baseUrl，这里是 entry 缺席
     * （读库失败 / 历史行）时的兜底。弹窗 typed 值永远最优先。 */
    chain.ok ? chain.providerBaseUrl : null,
    cfg.baseUrl,
  );
  if (!baseUrl) {
    return {
      error: "接口地址为空：请在弹窗内填写，或先在条目里保存接口地址",
    };
  }
  const apiKey = firstNonEmpty(
    typedKey,
    entry?.apiKey,
    /* 供应商密钥：entry 合并成功时它已折进 entry.apiKey，这里是 entry 缺席
     * （读库失败 / 历史行）时的兜底 —— 供应商密钥比全局密钥更具体，排在它前面。 */
    chain.ok ? chain.providerApiKey : null,
    cfg.apiKey,
  );
  if (
    apiKey === "" &&
    chain.ok &&
    chain.providerName !== null &&
    !chain.hasKey &&
    /* 独立 baseUrl（模型行自带的接口覆盖）可能本身就不需要密钥；只有「跟着
     *  供应商走」（没有独立覆盖）还两手空空的才算配置缺口。 */
    (entry?.baseUrl ?? "") === ""
  ) {
    return {
      error: `「${name}」挂在供应商「${chain.providerName}」下，但该供应商未配置 API 密钥 —— 到「设置 → 远程模型」的供应商详情里填好密钥再测。`,
    };
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return {
    base: baseUrl.replace(/\/+$/, ""),
    path: normalizeEndpointPath(rawPath),
    headers,
  };
}

/** 两个路由共用的**请求前言**：读 body → 取条目名 → 解析连接参数。
 *
 *  为什么抽出来：`POST /api/llm/test-usage` 与 `POST /api/llm/test-usage/query`
 *  的前言逐行相同（读 body、`strField` 取 name、把弹窗填的连接参数与已保存条目
 *  一起交给 `resolveUpstream`），而且**出错时都必须回答同一个信封**
 *  （`{ ok:false, detail }`）。此前两份各写一遍 —— 按行统计重合 ~79%，属规范
 *  §12.12 的孪生对：改一处漏一处就是静默行为分叉（分叉的正是「密钥怎么解析」
 *  与「错误文案长什么样」）。路由因此只剩「HTTP 形状」（包 NextResponse）。
 *
 *  返回判别式联合而不是抛异常：调用方要原样把它翻成 200 + `{ok:false,detail}`，
 *  抛异常会让「空接口地址」这类**用户可修正**的输入走成 500。 */
export type UsageTestPrologue =
  | {
      name: string;
      ok: true;
      rec: Record<string, unknown>;
      up: ResolvedUpstream;
    }
  | { detail: string; ok: false };

export async function readUsageTestPrologue(req: Request): Promise<UsageTestPrologue> {
  const body: unknown = await req.json().catch(() => ({}));
  const rec = isRecord(body) ? body : {};
  const name = strField(rec, "name");
  if (!name) {
    return { ok: false, detail: "缺少模型名" };
  }

  const up = await resolveUpstream(
    name,
    strField(rec, "baseUrl"),
    strField(rec, "apiKey"),
    strField(rec, "path"),
  );
  if ("error" in up) {
    return { ok: false, detail: up.error };
  }

  return { ok: true, name, rec, up };
}

/** 上游响应体：非 JSON 或解析失败一律给 null（调用方按 HTTP 状态给文案）。 */
export async function readPayload(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/** 非 2xx 时读一次响应体原文（`res.text()` 消费 body，因此**必须排在
 *  `readPayload` 之前**：反过来先 `json()` 再 `text()`，非 JSON 的原文永远
 *  读不到 —— 网关的 HTML 错误页正是这样被丢掉的）。 */
async function readRawText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/** 非 2xx → 可读归因（HTML 页面 / JSON / 纯文本同口径，唯一实现在
 *  `~/lib/llm/http-failure`）；地址一并点名，用户能看出是哪条端点失败。 */
async function failureDetail(res: Response, url: string): Promise<string> {
  return httpFailureDetail({ body: await readRawText(res), status: res.status, url });
}

/** 额外参数（JSON 对象字符串）→ 逐键合并用的对象。 */
export function parseExtraJson(
  extraJson: string,
): { extra: Record<string, unknown>; ok: true } | { detail: string; ok: false } {
  if (extraJson === "") {
    return { ok: true, extra: {} };
  }
  try {
    const parsed: unknown = JSON.parse(extraJson);
    if (!isRecord(parsed)) {
      throw new Error("不是 JSON 对象");
    }
    return { ok: true, extra: parsed };
  } catch (error) {
    return {
      ok: false,
      detail: `额外参数不是有效的 JSON 对象：${errorMessage(error, "解析失败")}`,
    };
  }
}

/** chat 响应 → 助手文本（OpenAI 的 string 与分片数组两种形态都认）。 */
export function chatTextFrom(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  const choices: unknown = payload.choices;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) && isRecord(first.message) ? first.message : null;
  const content: unknown = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
}

/** 一次 chat 调用。 */
export async function callChat(
  up: ResolvedUpstream,
  model: string,
  prompt: string,
  extra: Record<string, unknown>,
): Promise<{ ok: true; text: string } | { detail: string; ok: false }> {
  const res = await fetch(`${up.base}${up.path}`, {
    method: "POST",
    headers: up.headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      ...extra,
    }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  });
  if (!res.ok) {
    return {
      ok: false,
      detail: await failureDetail(res, `${up.base}${up.path}`),
    };
  }
  const payload = await readPayload(res);
  if (!isRecord(payload)) {
    return {
      ok: false,
      detail: `响应不是 JSON 对象（HTTP ${res.status}），无法解析回复`,
    };
  }
  const text = chatTextFrom(payload);
  if (!text) {
    return {
      ok: false,
      detail: `调用成功但未解析到回复文本：${clampText(JSON.stringify(payload), { maxLength: INLINE_JSON_SNIPPET_MAX, marker: "" })}`,
    };
  }
  return { ok: true, text };
}

/** 一次生图调用：返回可用图片地址（远程 URL 或内联 data URL）。 */
export async function callImage(
  up: ResolvedUpstream,
  model: string,
  prompt: string,
  size: string,
  extra: Record<string, unknown>,
): Promise<{ ok: true; url: string } | { detail: string; ok: false }> {
  const res = await fetch(`${up.base}${up.path}`, {
    method: "POST",
    headers: up.headers,
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      ...(size === "" ? {} : { size }),
      ...extra,
    }),
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  if (!res.ok) {
    return {
      ok: false,
      detail: await failureDetail(res, `${up.base}${up.path}`),
    };
  }
  const payload = await readPayload(res);
  const url = extractMediaUrl(payload) ?? extractBase64DataUrl(payload);
  if (url === null) {
    return {
      ok: false,
      detail: `调用成功但未解析到图片 URL / b64 数据：${clampText(JSON.stringify(payload), { maxLength: INLINE_JSON_SNIPPET_MAX, marker: "" })}`,
    };
  }
  return { ok: true, url };
}

/** 一次视频提交 + 内置一轮轮询。
 *
 *  `directUrl` 与 `taskId` 互斥：上游同步返回产物时给前者，任务制时给后者；
 *  两者都没有说明响应里既没有视频也没有任务（多为上游改了字段名）。 */
export type VideoSubmitOutcome =
  | { status: "done"; url: string }
  | { status: "pending"; taskId: string }
  | { detail: string; status: "error" };

export async function callVideo(
  up: ResolvedUpstream,
  model: string,
  prompt: string,
  extra: Record<string, unknown>,
): Promise<VideoSubmitOutcome> {
  const res = await fetch(`${up.base}${up.path}`, {
    method: "POST",
    headers: up.headers,
    body: JSON.stringify({ model, prompt, ...extra }),
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  if (!res.ok) {
    return {
      status: "error",
      detail: await failureDetail(res, `${up.base}${up.path}`),
    };
  }
  const payload = await readPayload(res);
  const directUrl = extractMediaUrl(payload);
  if (directUrl !== null) {
    return { status: "done", url: directUrl };
  }
  const taskId = extractRemoteTaskId(payload);
  if (taskId === null) {
    return {
      status: "error",
      detail: `响应中未找到视频 URL 或任务 ID：${clampText(JSON.stringify(payload), { maxLength: INLINE_JSON_SNIPPET_MAX, marker: "" })}`,
    };
  }
  const doneUrl = await pollRemoteVideoTask(up.base, up.path, model, taskId, up.headers);
  return doneUrl === null ? { status: "pending", taskId } : { status: "done", url: doneUrl };
}

/** 「继续等待」一轮：只查既有任务，**绝不重新提交**（不重复扣费）。 */
export async function queryVideoTask(
  up: ResolvedUpstream,
  model: string,
  taskId: string,
): Promise<{ done: true; url: string } | { done: false }> {
  const url = await pollRemoteVideoTask(up.base, up.path, model, taskId, up.headers);
  return url === null ? { done: false } : { done: true, url };
}

/** pending 文案（提交路由与查询路由的等待窗口是同一个常数）。 */
export function pendingDetail(prefix: string): string {
  return `${prefix}（已等待 ${Math.round(VIDEO_POLL_TOTAL_MS / 1000)}s）`;
}

/** 提交路由的 pending 文案：告诉用户可以继续等，不必重新提交。 */
export const SUBMIT_PENDING_DETAIL =
  `任务已提交且仍在生成中（已等待 ${Math.round(VIDEO_POLL_TOTAL_MS / 1000)}s）。` +
  "视频生成通常需要数十秒到几分钟，可点击「继续等待」再次查询，无需重新提交。";

/* ── 导出给路由复用的落盘助手（避免路由各自 import 两个模块）── */
export { saveMediaToLocalTemp };
