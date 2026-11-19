// 前端「需要 ComfyUI」动作的统一入口：不可达时按配置拉起实例，并给调用方可行动的状态而非各自去猜一行报错（ISSUE #345）。
// 契约（前端 `ensureComfyReady` 依赖这个形状）：200 { ok:true } 现在就能用，重试上传即可成功；
// 202 { ok:false, pending:true, detail } 正在启动（或已被用户关闭 / 未开自动启动），前端稍后重试；
// 503 { ok:false, pending:false, ... } 启动失败或本进程不可探活。
import { NextResponse } from "next/server";

import { requireRequestUser } from "~/server/auth/request-user";
import { errorMessage } from "~/lib/error-message";
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
const ENSURE_WAIT_MS = 8000;

export async function POST() {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const up = await probeComfyUi(1500);
  if (up !== null && up !== "") {
    return NextResponse.json({
      ok: true,
      base: up,
      detail: "ComfyUI 已在运行",
    });
  }

  try {
    const r = await ensureComfyUiReady({
      timeoutMs: ENSURE_WAIT_MS,
      // 自动启动的等待上限按任务路径处理：上传这条链路绝不能无限等，
      // 否则请求挂死、reaper 的启动窗口也会被一起拉长。
      onLog: (msg) => {
        logger.info(`[comfyui-ensure] ${msg}`);
      },
    });
    if (r.ok) {
      return NextResponse.json({ ok: true, base: r.base, detail: r.detail });
    }
    return NextResponse.json(
      {
        ok: false,
        pending: true,
        detail: r.detail,
        timeoutMs: COMFYUI_AUTOSTART_TIMEOUT_MS,
      },
      { status: 202 },
    );
  } catch (error) {
    const detail = errorMessage(error, "启动失败");
    logger.error(`[comfyui-ensure] 启动失败：${detail}`);
    return NextResponse.json({ ok: false, pending: false, detail }, { status: 503 });
  }
}
