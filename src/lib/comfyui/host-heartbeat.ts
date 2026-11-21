/**
 * `host-heartbeat.ts` — 执行宿主「活着吗」的读数（ISSUE #4604）
 * ===========================================================================
 *
 * 宿主进程（`scripts/executor-host.mjs`）每 5s 把 `{ t, bootId }` 写进心跳文件
 * （默认 `log/current/services/executor-host-heartbeat.json`，与它的日志通道同目录；
 * 路径可用 `COMFYAPP_HOST_HEARTBEAT` 覆盖）。Next 侧的回收器（reaper）用它回答
 * 「host 片还有没有活宿主」——宿主崩溃 / boot 失败后心跳停止，它名下的排队行
 * 不再被「⏳ 等待 ComfyUI WebSocket 连接就绪」的旧提示永久挂着（那条提示与真实
 * 原因无关，用户会去反复重启 ComfyUI），而是落一条用户可见的 FAILED。
 *
 * 为什么是文件而不是 DB 行 / 进程句柄：宿主由 launcher（或 standalone 运行入口）
 * 拉起，Next 进程手里**没有**它的 PID；跨进程的存活证据要么进库（要建表、要迁移），
 * 要么落文件——宿主本来就在写心跳日志，落一份小 JSON 是最短的桥。
 *
 * §18.4 三选一：第三类（纯 Node 宿主可加载——宿主经 tsx 加载 reaper 时连带加载
 * 本模块）——无 `server-only`；`node:fs` 是本模块的存在理由（读心跳文件），
 * 只被服务端图（reaper → instrumentation）引用，不进浏览器图。
 */
import fs from "node:fs";
import path from "node:path";

/** 默认落点：与宿主日志通道同目录（executor-host.mjs 的 logPath 默认值的兄弟文件）。
 *  两端各自落这个相对形状、由用例钉住一致（与「core 不反向 import scripts」的
 *  既有口径同款：字面量另立 + 用例对账）。 */
export function defaultHostHeartbeatPath(): string {
  return path.join(process.cwd(), "log", "current", "services", "executor-host-heartbeat.json");
}

/** 心跳文件路径：测试 / 特殊部署用 env 覆盖；缺省回落到上面的默认落点。 */
function heartbeatPath(): string {
  return process.env.COMFYAPP_HOST_HEARTBEAT ?? defaultHostHeartbeatPath();
}

/** 心跳文件里应有的形状（宿主写入；解析失败按没有文件处理）。 */
export type HostHeartbeat = {
  bootId?: string;
  /** 宿主写这一笔的时刻（`Date.now()`，毫秒）。 */
  t: number;
};

/** 读心跳文件；缺失 / 损坏 / 形状不对都返回 `null`（= 证据不足，按死处理）。
 *  「读不到按死」的方向是安全的：心跳是宿主每 5s 主动留下的，读不到只能说明
 *  它已经（至少）5s 没有报活 —— 调用方还有 `maxAgeMs` 这一层余量兜底。 */
export function readHostHeartbeat(): HostHeartbeat | null {
  let raw: string;
  try {
    raw = fs.readFileSync(heartbeatPath(), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const t = (parsed as { t?: unknown }).t;
    if (typeof t !== "number" || !Number.isFinite(t)) {
      return null;
    }
    const bootId = (parsed as { bootId?: unknown }).bootId;
    return { t, ...(typeof bootId === "string" ? { bootId } : {}) };
  } catch {
    return null;
  }
}

/** 宿主还活着吗：心跳存在且距现在不超过 `maxAgeMs`。
 *  `maxAgeMs` 取 20s（写节拍 5s 的 4 倍）：宿主活着却连续 4 拍写不出心跳，
 *  等价于它已经驱动不了领取循环 —— 判死方向安全。 */
export function isHostHeartbeatFresh(maxAgeMs = 20_000, now = Date.now()): boolean {
  const hb = readHostHeartbeat();
  if (hb === null) {
    return false;
  }
  return now - hb.t <= maxAgeMs;
}
