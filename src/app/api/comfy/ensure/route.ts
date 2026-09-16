// 前端「需要 ComfyUI」的动作（上传素材等）的统一入口：不可达时按配置拉起实例，
// 并在还不能用时给出**可行动**的状态，而不是让调用方各自去猜一句
// 「Configured ComfyUI instance is not running」。
//
// 背景（ISSUE #345）：工作流库里选一张图上传，服务端 `resolveComfyBase()` 判定
// 「配置路径的实例没在运行」就直接抛错，前端只看到一行原文——上传位没有错误出口，
// 用户不知道是「没启动」还是「启动中」，也不知道该点什么。任务提交路径
// （executor-ws）早就会自动拉起并等就绪，上传这条路径此前完全没有接上。
//
// 契约（前端 `ensureComfyReady` 依赖这个形状）：
//   200 { ok: true }                        → 现在就能用，重试上传即可成功
//   202 { ok: false, pending: true, ... }   → 正在启动（或已被用户关闭 / 未开自动
//                                             启动），前端稍后重试；`detail` 直接
//                                             给用户看
//   503 { ok: false, pending: false, ... }  → 启动失败或本进程不可探活
import { NextResponse } from "next/server";

import { requireServerUser } from "~/lib/auth-server";
import {
  probeComfyUi,
  ensureComfyUiReady,
  COMFYUI_AUTOSTART_TIMEOUT_MS,
} from "~/lib/comfyui/lifecycle";
import { logger } from "~/server/lib/logger";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单次请求内最多等多久。拉起的实例冷加载通常远超这个时长，所以这里只负责
 *  「等一小会儿」，等不到就回 202 让前端继续重试——把等待拆成多次短请求，
 *  用户才能在中途看到「正在启动」而不是一个挂了十几秒的请求。 */
const ENSURE_WAIT_MS = 8_000;

export async function POST() {
  const user = await requireServerUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const up = await probeComfyUi(1_500);
  if (up)
    return NextResponse.json({
      ok: true,
      base: up,
      detail: "ComfyUI 已在运行",
    });

  try {
    const r = await ensureComfyUiReady({
      timeoutMs: ENSURE_WAIT_MS,
      // 自动启动的等待上限按任务路径处理：上传这条链路绝不能无限等，
      // 否则请求挂死、reaper 的启动窗口也会被一起拉长。
      onLog: (msg) => logger.info(`[comfyui-ensure] ${msg}`),
    });
    if (r.ok)
      return NextResponse.json({ ok: true, base: r.base, detail: r.detail });
    return NextResponse.json(
      {
        ok: false,
        pending: true,
        detail: r.detail,
        timeoutMs: COMFYUI_AUTOSTART_TIMEOUT_MS,
      },
      { status: 202 },
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    logger.error(`[comfyui-ensure] 启动失败：${detail}`);
    return NextResponse.json(
      { ok: false, pending: false, detail },
      { status: 503 },
    );
  }
}
