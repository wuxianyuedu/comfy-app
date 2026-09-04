// ── Workshop API channel: 浏览器侧 API 客户端（规范 17 §17.2 第②层的网络部分）
// 弹层不再自己 fetch，全部保存请求走这里——失败解析、响应校验集中一处，
// 服务端换了错误信封（{error} 字符串 / {error:{message}}）只需改本文件。

import {
  isRecord,
  type ApiChannelSaveInput,
  type ApiChannelsView,
  type ApiChannelView,
} from "./api-channel-shared";

/** POST /api/workshop-api/config 的请求体：两个通道各自可选，只补丁改字段。 */
export interface ApiChannelSavePayload {
  image?: ApiChannelSaveInput;
  video?: ApiChannelSaveInput;
}

const SAVE_ENDPOINT = "/api/workshop-api/config";

function isChannelView(v: unknown): v is ApiChannelView {
  if (!isRecord(v)) return false;
  return (
    typeof v.configured === "boolean" &&
    typeof v.baseUrl === "string" &&
    typeof v.path === "string" &&
    typeof v.model === "string" &&
    typeof v.hasApiKey === "boolean"
  );
}

function isChannelsView(v: unknown): v is ApiChannelsView {
  return isRecord(v) && isChannelView(v.image) && isChannelView(v.video);
}

/**
 * 从后端错误体里取出可读消息。
 * 两种历史形态都要认：字符串 `error`，以及 `{error:{message}}`（鉴权错误用的信封）。
 */
export function readApiErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const err: unknown = body.error;
  if (typeof err === "string") return err;
  if (isRecord(err) && typeof err.message === "string") return err.message;
  return null;
}

/**
 * 保存 API 通道配置，成功后返回服务端下发的**脱敏视图**（apiKey 永不下发）。
 * 失败时抛出带服务端消息的 Error，由调用方（controller hook）转成提示条。
 */
export async function saveApiChannels(
  payload: ApiChannelSavePayload,
): Promise<ApiChannelsView> {
  let res: Response;
  try {
    res = await fetch(SAVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // 网络层断掉（dev server 未起 / 断网）时 fetch 直接 reject，
    // 这里统一成中文文案，避免把 "Failed to fetch" 甩给用户。
    throw new Error("无法连接服务器");
  }

  const data = (await res.json().catch(() => ({}))) as { error?: unknown; channels?: unknown };
  if (!res.ok) throw new Error(readApiErrorMessage(data) ?? "保存失败");
  if (!isChannelsView(data.channels)) {
    throw new Error("保存失败：服务端返回的通道配置格式不正确");
  }
  return data.channels;
}
