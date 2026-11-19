import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { apiErrorBody } from "~/lib/api-error";
import { formatCompactStamp } from "~/lib/time-format";
import { toDisplayPath } from "~/lib/path-display";
import { parseDataUrl } from "~/lib/media/data-url";
import { extForMime } from "~/lib/media/mime-ext";
import { LOG_EXPORT_DIR, LOG_ROOT } from "~/lib/log/log-paths";
import {
  buildIssueBody,
  buildIssueTitle,
  feedbackFileName,
  feedbackValidationReason,
  validateFeedbackDraft,
} from "~/lib/feedback/feedback-contract";
import { exportDiagnostics } from "../../../../../scripts/launcher-core/run.mjs";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { requireRequestUser } from "~/server/auth/request-user";

/**
 * `POST /api/feedback/export` —— 把应用内「运行反馈」打包落盘（ISSUE #3371）。
 *
 * 为什么是「落盘 + 预填正文」而不是应用直接提 Issue：桌面包不持有 CNB 凭证
 * （凭证只在 CI 平台注入，硬规则 17 禁止把密钥打进分发产物），运行时无从代用户
 * 向平台提交。这一格把「问题描述 + 截图 + 诊断日志」收成一份本机反馈包，并把
 * 预填好的 Issue 标题 / 正文回给界面（复制即粘、打开新建页即提），材料的落点
 * 与提交通道都铺平，剩下的提交动作交给有平台身份的一侧。
 *
 * 文件名一律由服务端按序号自造，**绝不采用客户端给的文件名**（否则是任意路径
 * 写入漏洞）；图片 MIME 走白名单，svg 会带脚本、刻意不放进反馈包。
 */

/** 允许的截图 MIME（与 /api/upload 同族白名单，但不收 svg）。 */
const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
/** 单张图片上限（解码后字节）：防一张图把反馈包与内存撑爆。 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 当次反馈的一张待写图片（data URL 已在服务端解析过）。 */
type PendingImage = { bytes: Buffer; ext: string; index: number };

/** 解析并校验一张 data URL 图片；畸形 / 不放行类型 / 超限一律回一句原因。 */
function decodeImage(dataUrl: string, index: number): PendingImage | string {
  const parsed = parseDataUrl(dataUrl);
  const mime = parsed?.mime.toLowerCase() ?? "";
  if (parsed === null || !ALLOWED_IMAGE_MIME.has(mime)) {
    return `第 ${index + 1} 张截图格式不受支持，请换一张 PNG / JPG / WebP / GIF 图片`;
  }
  const bytes = Buffer.from(parsed.base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return `第 ${index + 1} 张截图为空或超过 10MB，请压缩后重试`;
  }
  const ext = extForMime(mime) ?? "png";
  return { bytes, ext, index };
}

export async function POST(request: Request) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const body = await readJsonRecord(request);
  if (isErrorResponse(body)) {
    return body;
  }
  if (!validateFeedbackDraft(body)) {
    return NextResponse.json({ ok: false, error: feedbackValidationReason(body) }, { status: 400 });
  }
  const draft = body;

  try {
    const images: Array<PendingImage> = [];
    for (const [index, image] of draft.images.entries()) {
      const decoded = decodeImage(image.dataUrl, index);
      if (typeof decoded === "string") {
        return NextResponse.json({ ok: false, error: decoded }, { status: 400 });
      }
      images.push(decoded);
    }

    const stamp = formatCompactStamp(new Date(), { millis: true });
    const packageName = feedbackFileName(stamp);
    const packageDir = path.join(LOG_EXPORT_DIR, packageName);
    const imagesDir = path.join(packageDir, "images");
    /* turbopackIgnore：这些路径是运行期拼出来的，不该被构建期静态追踪（与
     * /api/logs/export 同一口径；去掉会让 standalone 产物误判动态路径）。 */
    await fs.promises.mkdir(/*turbopackIgnore: true*/ imagesDir, { recursive: true });

    await Promise.all(
      images.map((image) => {
        const name = `${String(image.index + 1).padStart(2, "0")}.${image.ext}`;
        return fs.promises.writeFile(
          /*turbopackIgnore: true*/ path.join(imagesDir, name),
          image.bytes,
        );
      }),
    );

    const issueBody = buildIssueBody(draft, packageName);
    await fs.promises.writeFile(
      /*turbopackIgnore: true*/ path.join(packageDir, "issue.md"),
      `# ${buildIssueTitle(draft.description)}\n\n${issueBody}\n`,
      "utf8",
    );

    let diagnosticsIncluded = false;
    if (draft.includeDiagnostics) {
      /* 诊断 zip 复用日志面板「保存到本地」的同一份实现，不抄第二遍打包链。
       * 它落在 log/exports/ 根下，这里复制进反馈包的 diagnostics/ 子目录，
       * 让「一次反馈的全部材料」在同一个目录里，用户不必到处找。 */
      const zip = await exportDiagnostics(path.dirname(LOG_ROOT));
      const diagnosticsDir = path.join(packageDir, "diagnostics");
      await fs.promises.mkdir(/*turbopackIgnore: true*/ diagnosticsDir, { recursive: true });
      await fs.promises.copyFile(
        /*turbopackIgnore: true*/ zip,
        /*turbopackIgnore: true*/ path.join(diagnosticsDir, path.basename(zip)),
      );
      diagnosticsIncluded = true;
    }

    return NextResponse.json({
      ok: true,
      error: "",
      packagePath: packageDir,
      packageName,
      relativePath: toDisplayPath(packageDir, LOG_ROOT),
      imageCount: images.length,
      diagnosticsIncluded,
      issueBody,
      issueTitle: buildIssueTitle(draft.description),
    });
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "保存反馈失败", { ok: false }), { status: 500 });
  }
}
