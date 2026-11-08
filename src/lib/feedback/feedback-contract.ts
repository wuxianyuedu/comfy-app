/* ── 应用内「运行反馈」的共享契约与正文生成（浏览器 / 服务端同构）──────────
 * 本模块零 Node 依赖、零 React：预填 Issue 正文的拼装在浏览器侧（复制 / 打开
 * 新建页）与服务端侧（写进反馈包）读同一份实现，避免两处各写一份逐字漂移。
 * 落盘的网络与 IO 不在这里：见 ./feedback-client.ts（第②层网络）与
 * src/app/api/feedback/export/route.ts（服务端落盘）。
 */

import { APP_VERSION } from "~/lib/app-version";
import { asRecord } from "~/lib/is-record";

/** 反馈仓库坐标（与 CI 脚本的 `DEFAULT_CNB_SLUG` 同一处事实，不放进桌包凭证）。 */
export const FEEDBACK_REPO_SLUG = "moon-read/comfy-app-t3";
/** 新建 Issue 页（用户在有平台身份的浏览器里粘贴正文提交）。 */
export const FEEDBACK_NEW_ISSUE_URL = `https://cnb.cool/${FEEDBACK_REPO_SLUG}/-/issues/new`;

/** 一张反馈的提交体（客户端 → /api/feedback/export）。图片是浏览器读出的 data URL。 */
export type FeedbackDraft = {
  /** 问题描述（必填，界面已判非空，这里再兜一次上限）。 */
  description: string;
  /** 用户附加的截图（data URL）；顺序即界面里的添加顺序。 */
  images: Array<{ dataUrl: string; name: string }>;
  /** 运行环境信息（浏览器侧采集，纯展示事实，不含任何口令）。 */
  environment: {
    appVersion: string;
    platform: string;
    userAgent: string;
    when: string;
  };
  /** 是否随包附上诊断日志 zip（复用 /api/logs/diagnostics 的产物路径）。 */
  includeDiagnostics: boolean;
};

/** 描述长度上限（字符）：超了如实拒绝，不写半个包。 */
export const MAX_DESCRIPTION_CHARS = 8000;
/** 一次反馈最多几张图：界面与服务端同一把尺。 */
export const MAX_IMAGES = 6;

/** 反馈包文件名（本地时刻、无非法字符）——与日志导出同一处时间格式出口。 */
export function feedbackFileName(stamp: string): string {
  return `feedback-${stamp}`;
}

/** 校验一份反馈草稿；同时收窄类型（校验即守卫，服务端不必再作类型断言）。 */
export function validateFeedbackDraft(draft: unknown): draft is FeedbackDraft {
  if (typeof draft !== "object" || draft === null) {
    return false;
  }
  const d = asRecord(draft);
  if (d === null || typeof d.description !== "string" || d.description.trim() === "") {
    return false;
  }
  if (d.description.length > MAX_DESCRIPTION_CHARS) {
    return false;
  }
  if (!Array.isArray(d.images) || d.images.length > MAX_IMAGES) {
    return false;
  }
  if (!isEnvironment(d.environment)) {
    return false;
  }
  if (typeof d.includeDiagnostics !== "boolean") {
    return false;
  }
  for (const image of d.images) {
    if (typeof image !== "object" || image === null) {
      return false;
    }
    const rec = asRecord(image);
    if (rec === null || typeof rec.dataUrl !== "string" || !rec.dataUrl.startsWith("data:")) {
      return false;
    }
    if (typeof rec.name !== "string") {
      return false;
    }
  }
  return true;
}

/** 环境信息只作展示，四个字段都要求字符串；缺一不收窄（不是错误，只是形状不符）。 */
function isEnvironment(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const e = asRecord(value);
  return (
    e !== null &&
    typeof e.appVersion === "string" &&
    typeof e.platform === "string" &&
    typeof e.userAgent === "string" &&
    typeof e.when === "string"
  );
}

/** 一句中文原因（守卫为假时给用户看）；与守卫同源，不另判一遍。 */
export function feedbackValidationReason(draft: unknown): string {
  if (typeof draft !== "object" || draft === null) {
    return "反馈内容格式不正确";
  }
  const d = asRecord(draft);
  if (d === null || typeof d.description !== "string" || d.description.trim() === "") {
    return "请填写问题描述";
  }
  if (typeof d.description === "string" && d.description.length > MAX_DESCRIPTION_CHARS) {
    return `问题描述不能超过 ${MAX_DESCRIPTION_CHARS} 字`;
  }
  if (!Array.isArray(d.images) || d.images.length > MAX_IMAGES) {
    return `最多附加 ${MAX_IMAGES} 张截图`;
  }
  return "反馈内容格式不正确";
}

/** 预填好的 Issue 正文（症状 / 现场 / 环境三段，纯事实、不替用户下结论）。 */
export function buildIssueBody(draft: FeedbackDraft, packageName: string): string {
  const lines = [
    "## 问题描述",
    "",
    draft.description.trim(),
    "",
    "## 运行环境",
    "",
    `- 应用版本：${draft.environment.appVersion || APP_VERSION}`,
    `- 平台：${draft.environment.platform || "未知"}`,
    `- 时间：${draft.environment.when || "未知"}`,
    `- User-Agent：${draft.environment.userAgent || "未知"}`,
    "",
    "## 附件与日志",
    "",
    draft.images.length > 0
      ? `本次反馈附加 ${draft.images.length} 张截图，见反馈包 ${packageName}/ 内的 images/。`
      : "本次反馈未附加截图。",
    draft.includeDiagnostics
      ? `诊断日志（zip）见反馈包 ${packageName}/ 内的 diagnostics/，或应用内「日志面板 → 保存到本地」。`
      : "本次反馈未附带诊断日志。",
    "",
    "> 反馈包由应用内「反馈」按钮生成，落在本机 `log/exports/`；请把截图与诊断包一并上传到本 Issue。",
  ];
  return lines.join("\n");
}

/** 预填标题：取描述首行，去掉换行与多余空白，长度封顶。 */
export function buildIssueTitle(description: string): string {
  const firstLine = description.split("\n").find((l) => l.trim() !== "") ?? "应用运行反馈";
  const clean = firstLine.replace(/\s+/g, " ").trim();
  const title = clean === "" ? "应用运行反馈" : clean;
  return `[运行反馈] ${title.slice(0, 80)}`;
}
