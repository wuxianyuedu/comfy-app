// ── API 直连通道设置弹层：纯配置层（规范 17 §17.2 第①层）──────────────────
// 只有常量与纯函数：无 React、无副作用、无 DOM，可直接单测。

import type { ApiChannelKind } from "~/lib/workshop/api-channel-shared";

/** 弹层内可选的两个通道，顺序即页签顺序。 */
export const API_CHANNEL_KINDS: ReadonlyArray<ApiChannelKind> = ["image", "video"];

export type ApiChannelKindMeta = {
  /** 页签下方的一句说明，解释该通道的协议形态。 */
  hint: string;
  /** 模型名输入框的 placeholder。 */
  modelPlaceholder: string;
  /** 请求路径输入框的 placeholder（各 provider 默认值不同）。 */
  pathPlaceholder: string;
  title: string;
};

export const API_CHANNEL_KIND_META: Record<ApiChannelKind, ApiChannelKindMeta> = {
  image: {
    hint: "OpenAI 兼容 images 接口（POST {baseUrl}{path}），如 https://api.openai.com/v1 + /images/generations。",
    modelPlaceholder: "gpt-image-1",
    pathPlaceholder: "/images/generations",
    title: "生图 API",
  },
  video: {
    hint: "视频生成端点：支持同步返回视频 URL，或提交后返回任务 ID（系统自动按 GET {baseUrl}/{taskId} 轮询）。",
    modelPlaceholder: "Provider 模型 ID",
    pathPlaceholder: "/videos/generations",
    title: "视频 API",
  },
};

/** 新建草稿时的默认请求路径（用户从空表单起步也点得动）。 */
export const API_CHANNEL_DEFAULT_PATH: Record<ApiChannelKind, string> = {
  image: "/images/generations",
  video: "/videos/generations",
};

/** 保存结果的提示文案：成功/失败各一套，失败时拼上具体原因。 */
export const API_CHANNEL_SAVE_OK = "已保存。API 通道已可用。";
export const API_CHANNEL_SAVE_FAIL = "保存失败";

/** 结果提示条配色：成功 / 失败各一套（§4.11.1 状态语义 → 语义 token）。 */
export const API_CHANNEL_MSG_STYLE: Record<"ok" | "err", string> = {
  err: "bg-destructive/15 text-destructive",
  ok: "bg-success/15 text-success-strong",
};
