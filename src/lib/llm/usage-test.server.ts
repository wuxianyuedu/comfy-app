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

import { getLLMConfig } from "@/lib/llm/server";
import { errorMessage } from "~/lib/error-message";
import { extractBase64DataUrl, extractMediaUrl, extractRemoteTaskId } from "~/lib/workshop/api-channel-shared";
import {
  VIDEO_POLL_TOTAL_MS,
  pollRemoteVideoTask,
  saveMediaToLocalTemp,
} from "~/lib/llm/video-task-util";

/** chat / 生图 / 生视频的单次调用超时（生视频提交后若走任务制则由
 *  video-task-util 轮询取回，不受此上限约束，见 VIDEO_POLL_TOTAL_MS）。 */
export const CHAT_TIMEOUT_MS = 60_000;
export const MEDIA_TIMEOUT_MS = 180_000;

/** 允许的用途。 */
export const USAGE_TEST_KINDS = ["chat", "image", "video"] as const;
export type UsageTestKind = (typeof USAGE_TEST_KINDS)[number];

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 取一个 trim 过的字符串字段（缺省/类型不对一律给空串）。 */
export function strField(rec: Record<string, unknown>, key: string): string {
  const v: unknown = rec[key];
  return typeof v === "string" ? v.trim() : "";
}

/** 取第一个非空白字符串（空串视为未填，继续向后回落）。 */
export function firstNonEmpty(...vals: Array<string | null | undefined>): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return "";
}

/** 端点路径归一：非空时必须根相对，否则 `${base}${path}` 拼不出合法地址。 */
export function normalizeEndpointPath(raw: string): string {
  if (raw !== "" && !raw.startsWith("/")) return `/${raw}`;
  return raw;
}

export interface ResolvedUpstream {
  /** 去掉尾斜杠的连接基址。 */
  base: string;
  /** 根相对的端点路径（空串 = 直接用 base）。 */
  path: string;
  headers: Record<string, string>;
}

/** 连接参数解析（**两个路由同一口径**，解析顺序改了只有这一处）：
 *  弹窗内填的 → 该条目已保存的 → 全局配置。 */
export async function resolveUpstream(
  name: string,
  typedBase: string,
  typedKey: string,
  rawPath: string,
): Promise<ResolvedUpstream | { error: string }> {
  const cfg = await getLLMConfig();
  const entry = cfg.extraModels?.find((e) => e.name === name);
  const baseUrl = firstNonEmpty(typedBase, entry?.baseUrl, cfg.baseUrl);
  if (!baseUrl) {
    return {
      error: "接口地址为空：请在弹窗内填写，或先在条目里保存接口地址",
    };
  }
  const apiKey = firstNonEmpty(typedKey, entry?.apiKey, cfg.apiKey);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return {
    base: baseUrl.replace(/\/+$/, ""),
    path: normalizeEndpointPath(rawPath),
    headers,
  };
}

/** 上游响应体：非 JSON 或解析失败一律给 null（调用方按 HTTP 状态给文案）。 */
export async function readPayload(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/** 非 2xx 的统一错误文案（响应体截断，不把整页 HTML 灌进界面）。 */
export function httpFailureDetail(status: number, payload: unknown): string {
  const detail = isRecord(payload) ? JSON.stringify(payload).slice(0, 240) : `HTTP ${status}`;
  return `HTTP ${status}：${detail}`;
}

/** 额外参数（JSON 对象字符串）→ 逐键合并用的对象。 */
export function parseExtraJson(extraJson: string):
  | { ok: true; extra: Record<string, unknown> }
  | { ok: false; detail: string } {
  if (extraJson === "") return { ok: true, extra: {} };
  try {
    const parsed: unknown = JSON.parse(extraJson);
    if (!isRecord(parsed)) throw new Error("不是 JSON 对象");
    return { ok: true, extra: parsed };
  } catch (e) {
    return { ok: false, detail: `额外参数不是有效的 JSON 对象：${errorMessage(e, "解析失败")}` };
  }
}

/** chat 响应 → 助手文本（OpenAI 的 string 与分片数组两种形态都认）。 */
export function chatTextFrom(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const choices: unknown = payload.choices;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) && isRecord(first.message) ? first.message : null;
  const content: unknown = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
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
): Promise<{ ok: true; text: string } | { ok: false; detail: string }> {
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
  const payload = await readPayload(res);
  if (!res.ok || !isRecord(payload)) {
    return { ok: false, detail: httpFailureDetail(res.status, payload) };
  }
  const text = chatTextFrom(payload);
  if (!text) {
    return {
      ok: false,
      detail: `调用成功但未解析到回复文本：${JSON.stringify(payload).slice(0, 240)}`,
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
): Promise<{ ok: true; url: string } | { ok: false; detail: string }> {
  const res = await fetch(`${up.base}${up.path}`, {
    method: "POST",
    headers: up.headers,
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      ...(size !== "" ? { size } : {}),
      ...extra,
    }),
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  const payload = await readPayload(res);
  if (!res.ok) return { ok: false, detail: httpFailureDetail(res.status, payload) };
  const url = extractMediaUrl(payload) ?? extractBase64DataUrl(payload);
  if (!url) {
    return {
      ok: false,
      detail: `调用成功但未解析到图片 URL / b64 数据：${JSON.stringify(payload).slice(0, 240)}`,
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
  | { status: "error"; detail: string };

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
  const payload = await readPayload(res);
  if (!res.ok) return { status: "error", detail: httpFailureDetail(res.status, payload) };
  const directUrl = extractMediaUrl(payload);
  if (directUrl) return { status: "done", url: directUrl };
  const taskId = extractRemoteTaskId(payload);
  if (!taskId) {
    return {
      status: "error",
      detail: `响应中未找到视频 URL 或任务 ID：${JSON.stringify(payload).slice(0, 240)}`,
    };
  }
  const doneUrl = await pollRemoteVideoTask(up.base, up.path, model, taskId, up.headers);
  return doneUrl ? { status: "done", url: doneUrl } : { status: "pending", taskId };
}

/** 「继续等待」一轮：只查既有任务，**绝不重新提交**（不重复扣费）。 */
export async function queryVideoTask(
  up: ResolvedUpstream,
  model: string,
  taskId: string,
): Promise<{ done: true; url: string } | { done: false }> {
  const url = await pollRemoteVideoTask(up.base, up.path, model, taskId, up.headers);
  return url ? { done: true, url } : { done: false };
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
