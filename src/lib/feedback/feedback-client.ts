/* ── 「运行反馈」的网络层（规范 17 第②层）──────────────────────────────
 * 反馈弹窗只关心「把一份草稿交出去、拿到落盘结果」，不直接发 fetch。
 * 与 /api/logs/export 同族：桌面壳里浏览器下载不保证落盘，所以由服务端
 * 把反馈包写进 log/exports/ 并把绝对路径回给界面。
 */

import { isRecord } from "~/lib/is-record";
import { readApiError } from "~/lib/api-error";
import type { FeedbackCliStatus, FeedbackDraft, FeedbackPublishResult } from "./feedback-contract";

/** 一次反馈落盘的结果。失败不抛：界面据此显示「保存失败」+ 原因（硬规则 4）。 */
export type FeedbackExportResult = {
  /** 诊断日志 zip 是不是真的带上了。 */
  diagnosticsIncluded: boolean;
  /** 失败原因（成功时为空）。 */
  error: string;
  /** 本次随包写入的截图数。 */
  imageCount: number;
  /** 预填好的 Issue 正文（服务端按同一份契约生成，界面直接复制）。 */
  issueBody: string;
  /** 预填好的 Issue 标题。 */
  issueTitle: string;
  ok: boolean;
  /** 反馈包名（进 Issue 正文引用）。 */
  packageName: string;
  /** 反馈包目录的绝对路径（成功时有）。 */
  packagePath: string;
  /** 相对 log/ 的短路径（界面空间窄，展示这一截）。 */
  relativePath: string;
};

const EMPTY: FeedbackExportResult = {
  diagnosticsIncluded: false,
  error: "",
  imageCount: 0,
  issueBody: "",
  issueTitle: "",
  ok: false,
  packageName: "",
  packagePath: "",
  relativePath: "",
};

/**
 * 收窄服务端回执并补齐缺省字段。
 * 「业务失败」那一档只需 `ok:false` + 一句原因（路由的 400/500 就是这种形状），
 * 成功才要求全套路径 / 正文；否则一句「请填写问题描述」会被误判成「响应形状
 * 不合法」，用户看不到真正的原因。
 */
function toFeedbackResult(value: unknown): FeedbackExportResult | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return null;
  }
  const error = typeof value.error === "string" ? value.error : "";
  if (value.ok === false) {
    return { ...EMPTY, ok: false, error: error || "保存反馈失败" };
  }
  if (
    typeof value.packagePath !== "string" ||
    typeof value.packageName !== "string" ||
    typeof value.relativePath !== "string" ||
    typeof value.issueBody !== "string" ||
    typeof value.issueTitle !== "string" ||
    typeof value.imageCount !== "number" ||
    typeof value.diagnosticsIncluded !== "boolean"
  ) {
    return null;
  }
  return {
    ok: true,
    error: "",
    packagePath: value.packagePath,
    packageName: value.packageName,
    relativePath: value.relativePath,
    imageCount: value.imageCount,
    diagnosticsIncluded: value.diagnosticsIncluded,
    issueBody: value.issueBody,
    issueTitle: value.issueTitle,
  };
}

/** 把一份反馈草稿交给服务端打包落盘。网络 / 服务端失败都转成同形状失败结果。 */
export async function submitFeedback(draft: FeedbackDraft): Promise<FeedbackExportResult> {
  try {
    const res = await fetch("/api/feedback/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data: unknown = await res.json();
    if (!res.ok) {
      return { ...EMPTY, error: readApiError(data) ?? `提交失败（HTTP ${res.status}）` };
    }
    const result = toFeedbackResult(data);
    return result ?? { ...EMPTY, error: "反馈响应形状不合法" };
  } catch (error) {
    return {
      ...EMPTY,
      error: error instanceof Error ? error.message : "网络请求失败",
    };
  }
}

/** 「提交到仓库」失败的兜底形状（网络/服务端失败都转成同形状结果）。 */
const PUBLISH_EMPTY: FeedbackPublishResult = {
  ok: false,
  error: "",
  uploaded: 0,
  issueNumber: "",
  issueUrl: "",
};

/** 收窄 GET /status 的回执；形状不对按「不可用」处理，不猜。 */
function toCliStatus(value: unknown): FeedbackCliStatus {
  if (isRecord(value) && typeof value.available === "boolean") {
    return {
      available: value.available,
      reason: typeof value.reason === "string" ? value.reason : "",
    };
  }
  return { available: false, reason: "环境探测回执形状不合法" };
}

/** 收窄 POST /publish 的回执；业务失败只需 ok:false + 一句原因。 */
function toPublishResult(value: unknown): FeedbackPublishResult | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return null;
  }
  const error = typeof value.error === "string" ? value.error : "";
  if (value.ok === false) {
    return { ...PUBLISH_EMPTY, error: error || "提交反馈失败" };
  }
  if (
    typeof value.issueNumber !== "string" ||
    typeof value.issueUrl !== "string" ||
    typeof value.uploaded !== "number"
  ) {
    return null;
  }
  return {
    ok: true,
    error,
    uploaded: value.uploaded,
    issueNumber: value.issueNumber,
    issueUrl: value.issueUrl,
  };
}

/** 探测运行环境里的 cnb cli 是否可用（弹窗打开时调一次，只读）。 */
export async function getFeedbackCliStatus(): Promise<FeedbackCliStatus> {
  try {
    const res = await fetch("/api/feedback/publish", { method: "GET" });
    if (!res.ok) {
      return { available: false, reason: `环境探测失败（HTTP ${res.status}）` };
    }
    return toCliStatus((await res.json()) as unknown);
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : "环境探测请求失败",
    };
  }
}

/** 把已生成的反馈包提交到 CNB 仓库；失败不抛，界面据此显示可见原因。 */
export async function publishFeedback(packageName: string): Promise<FeedbackPublishResult> {
  try {
    const res = await fetch("/api/feedback/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageName }),
    });
    const data: unknown = await res.json();
    if (!res.ok) {
      return { ...PUBLISH_EMPTY, error: readApiError(data) ?? `提交失败（HTTP ${res.status}）` };
    }
    return toPublishResult(data) ?? { ...PUBLISH_EMPTY, error: "提交回执形状不合法" };
  } catch (error) {
    return {
      ...PUBLISH_EMPTY,
      error: error instanceof Error ? error.message : "网络请求失败",
    };
  }
}
