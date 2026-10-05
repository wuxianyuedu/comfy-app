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
 * `POST /api/logs/diagnostics` —— 把「本次运行 + 最近几次历史」打成一个 zip。
 *
 * 为什么要有这个端点：日志面板现有的「保存到本地」只导出**面板当前筛选到的那
 * 些行**（前端手上的文本），而用户报 bug 时真正要给的现场还包括面板看不到的
 * 东西 —— `run.json`（runId / 版本 / 分支 / commit / 各 pid / 退出码）、上一次
 * 崩溃留下的残留、comfyui 通信层原始回执。让用户去文件管理器里翻 `log/` 再挑
 * 几个文件打包，是一件他做不好、也没人教他的事（ISSUE #1326）。
 *
 * 打包逻辑**不在这里实现**：复用启动编排的 `exportDiagnostics()`
 * （`scripts/launcher-core/run.mjs`）—— 归档/保留/目录名形态与写方共用同一份
 * 判据，在端点里再写一遍压缩逻辑就是第二条实现（且它必然先漂）。
 * 这正是「同一件事只有一处实现」在本仓库的常规形态（同 `POST /api/schema/push`
 * 直接 import `scripts/db-schema-state.mjs`）。
 *
 * 与 `POST /api/logs/export` 的分工：那个是「把我看得见的东西存下来」，
 * 这个是「把诊断需要的现场整包带走」。两者的落点同为 `log/exports/`。
 *
 * 鉴权与同族端点一致（`requireRequestUser`）；`scripts/launcher-core/run.mjs`
 * 在桌包载荷里（RUNTIME_SCRIPTS 白名单），因此打包能力脱离仓库也还在。
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
      bytes: fileSize(file),
    });
  } catch (error) {
    // 失败如实回 500 + 原因（诊断包打不出来通常意味着 log/ 权限或磁盘问题，
    // 而「点了没反应」会把这两类问题一起藏起来）。
    return NextResponse.json(
      apiErrorBody(error, "打包诊断失败", { ok: false }),
      { status: 500 },
    );
  }
}

/** 读产物大小（读不到回 null，不因它把成功打成失败）。 */
function fileSize(file: string): number | null {
  try {
    return fs.statSync(/*turbopackIgnore: true*/ file).size;
  } catch {
    return null;
  }
}
