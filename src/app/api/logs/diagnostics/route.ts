import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { exportDiagnostics } from "../../../../../scripts/launcher-core/run.mjs";
import { apiErrorBody } from "~/lib/api-error";
import { LOG_ROOT } from "~/lib/log/log-paths";
import { toDisplayPath } from "~/lib/path-display";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";

/**
 * `POST /api/logs/diagnostics` —— 把「本次运行 + 最近几次历史」打成 zip（ISSUE #1326）：面板「保存到本地」只导出筛到的行，
 * 报 bug 要的现场（run.json / 崩溃残留 / 原始回执）面板看不到。打包复用 `scripts/launcher-core/run.mjs` 的 `exportDiagnostics()`
 * —— 同一实现不抄第二遍，该脚本在桌包载荷里、脱离仓库仍可用。落点 `log/exports/`。
 */
export const dynamic = "force-dynamic";

/** 打包是 IO 密集的同步活（几十 MB 的 zip），给它一个明确上限而不是让它挂住请求。 */
export const maxDuration = 60;

export async function POST() {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  try {
    /* 交给它的是**日志根的父目录**：`run.mjs` 的 `logRoot(root)` 是 `root/log`，
     * 而 `LOG_ROOT` 就是那个 `log`。走 `LOG_ROOT` 而不是 `process.cwd()`，是为了
     * 让「日志在哪」只有一处判断（§12.14）—— 否则两处一旦语义不同，表现是
     * 「打包出来的包里没有日志」。 */
    const file = await exportDiagnostics(path.dirname(LOG_ROOT));
    return NextResponse.json({
      ok: true,
      /** 绝对路径：用户要能直接把它发给别人 / 在文件管理器里找到。 */
      path: file,
      /** 相对 log/ 的路径：面板空间窄，展示这一截即可。 */
      relativePath: toDisplayPath(file, LOG_ROOT),
      bytes: await fileSize(file),
    });
  } catch (error) {
    // 失败如实回 500 + 原因（诊断包打不出来通常意味着 log/ 权限或磁盘问题，
    // 而「点了没反应」会把这两类问题一起藏起来）。
    return NextResponse.json(apiErrorBody(error, "打包诊断失败", { ok: false }), { status: 500 });
  }
}

/**
 * 读产物大小（读不到回 null，不把成功打成失败）。
 * 异步（ISSUE #2193）：整包 zip 已是异步，末尾这次 `stat` 不应单独压住线程。
 */
async function fileSize(file: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(/*turbopackIgnore: true*/ file);
    return stat.size;
  } catch {
    return null;
  }
}
