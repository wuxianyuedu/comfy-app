import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { apiErrorBody } from "~/lib/api-error";
import { LOG_EXPORT_DIR } from "~/lib/log/log-paths";
import {
  feedbackIssueUrl,
  type FeedbackCliStatus,
  type FeedbackPublishResult,
} from "~/lib/feedback/feedback-contract";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { requireRequestUser } from "~/server/auth/request-user";
import {
  createFeedbackIssue,
  postFeedbackAssetsComment,
  probeCnbCli,
  uploadFeedbackAsset,
} from "~/server/feedback/cnb-cli";

/**
 * `/api/feedback/publish` —— 把已生成的本机反馈包提交到 CNB 仓库（#3384）。
 *
 * 身份不来自应用：运行环境里的 `cnb` cli 自己从 CNB_TOKEN 或 `cnb login`
 * 登录态取（硬规则 17）。GET 只读探测「cli 在不在 / 登没登」，POST 建单 +
 * 传附件。客户端只给一个 `packageName`（反馈包名），**绝不收路径**：目录一律
 * 由 `LOG_EXPORT_DIR` + 白名单形状拼出来，防止任意文件被读走或上传。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 反馈包名：只认服务端 export 路由自造的 `feedback-<时刻>` 形状。 */
function safePackageName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return /^feedback-\d{8}-\d{6}-\d{3}$/.test(value) ? value : null;
}

/** 失败结果统一形状（界面据此给可见提示，硬规则 4）。 */
function failure(error: string): FeedbackPublishResult {
  return { ok: false, error, uploaded: 0, issueNumber: "", issueUrl: "" };
}

/** GET：探测环境里的 cnb cli 是否可用（只读，不建单）。 */
export async function GET() {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  const status: FeedbackCliStatus = await probeCnbCli();
  return NextResponse.json(status);
}

/** POST：建单 → 传附件 → 把附件引用挂到一条评论。 */
export async function POST(request: Request) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const body = await readJsonRecord(request);
  if (isErrorResponse(body)) {
    return body;
  }
  const packageName = safePackageName(body.packageName);
  if (packageName === null) {
    return NextResponse.json({ ok: false, error: "反馈包名不合法" }, { status: 400 });
  }
  const packageDir = /*turbopackIgnore: true*/ path.join(LOG_EXPORT_DIR, packageName);

  try {
    const probe = await probeCnbCli();
    if (!probe.available) {
      return NextResponse.json(failure(probe.reason));
    }

    const issueMd = await fs.promises.readFile(
      /*turbopackIgnore: true*/ path.join(packageDir, "issue.md"),
      "utf8",
    );
    const firstLine = issueMd.split("\n")[0] ?? "";
    const title = firstLine.replace(/^#\s*/, "").trim() || "应用运行反馈";

    const created = await createFeedbackIssue(title, issueMd);
    if (!created.ok) {
      return NextResponse.json(failure(created.error));
    }

    const links: Array<string> = [];
    const errors: Array<string> = [];
    const imagesDir = path.join(packageDir, "images");
    const diagnosticsDir = path.join(packageDir, "diagnostics");
    /* 一次把两类附件的上传并发发出去：串行 await 会让 6 张图 + zip 把界面拖成
     * 七倍往返。结果按「图片在前、诊断在后」的既定顺序汇总，保序不靠并发顺序。 */
    const [imageFiles, diagnosticFiles] = await Promise.all([
      listFiles(imagesDir),
      listFiles(diagnosticsDir),
    ]);
    const uploads = [
      ...imageFiles.map((file) => ({ file, kind: "image" as const, dir: imagesDir })),
      ...diagnosticFiles.map((file) => ({ file, kind: "file" as const, dir: diagnosticsDir })),
    ];
    const results = await Promise.all(
      uploads.map(async (item) => ({
        file: item.file,
        result: await uploadFeedbackAsset(
          created.issueNumber,
          path.join(item.dir, item.file),
          item.kind,
        ),
      })),
    );
    for (const { file, result } of results) {
      if (result.ok) {
        links.push(`- ${file}：${result.link}`);
      } else {
        errors.push(`${file}：${result.error}`);
      }
    }

    let commentError = "";
    if (links.length > 0) {
      const commented = await postFeedbackAssetsComment(created.issueNumber, links);
      if (!commented.ok) {
        commentError = commented.error;
      }
    }

    const result: FeedbackPublishResult = {
      ok: true,
      error: "",
      uploaded: links.length,
      issueNumber: created.issueNumber,
      issueUrl: feedbackIssueUrl(created.issueNumber),
    };
    /* 建单成功但附件没全带上：不推翻「已建单」，把半成状态如实回给界面。
     * 界面据此提示「Issue 已建，但 N 个附件没传上去，可手动补」。 */
    const partial = [...errors, commentError].filter((line) => line !== "");
    if (partial.length > 0) {
      result.error = `Issue 已建，但部分附件未完成：${partial.join("；")}`;
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(apiErrorBody(error, "提交反馈失败", { ok: false }), { status: 500 });
  }
}

/** 列目录里的普通文件名；目录不存在（未附带截图 / 诊断）时返回空数组。 */
async function listFiles(dir: string): Promise<Array<string>> {
  try {
    const entries = await fs.promises.readdir(/*turbopackIgnore: true*/ dir, {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
