/* ── nvidia-smi 物理专用显存查询 ─────────────────────────────
 * 底部状态栏显存需要与任务管理器「专用 GPU 内存」可比（用户反馈 ComfyUI
 * 的 CUDA 口径有时不准确）。本模块查询 nvidia-smi 的物理专用显存占用，
 * 与 ComfyUI /system_stats 的 CUDA 逻辑口径并列展示，便于对照。
 *
 * 设计要点：
 *   1. 纯函数 parseNvidiaSmiOutput 负责解析，可独立单测。
 *   2. 实际调用走 execFileP（与 proc-detect 同款超时/静默失败降级）；
 *      非 NVIDIA 卡 / nvidia-smi 缺失 / 查询失败返回 null，调用方据此隐藏。
 *   3. 结果短缓存（SMI_CACHE_MS），避免状态栏 4s 轮询每次都起子进程。
 *   4. 只在本机查询——nvidia-smi 反映的是本机物理 GPU，ComfyUI 指向远端
 *      时该项不适用，返回 null 由调用方隐藏。
 */
// §18.4 三选一：本模块走第三类（纯 Node 宿主），依赖登记在
// `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。
// 只用 `child_process.execFile` 起本机 nvidia-smi，不引任何 server-only 侧模块；
// P3 executor host 加入后可被 scripts 侧直接 import。
import { execFile } from "node:child_process";

/** nvidia-smi 内存查询的一条结果（MiB → 调用方换算字节）。 */
export interface NvidiaSmiMem {
  /** 已用（MB） */
  usedMiB: number;
  /** 总量（MB） */
  totalMiB: number;
}

/** 解析 `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits`
 *  的每行输出（形如 `2048, 8192`），返回首块 GPU 用量。
 *  多卡取第一块（状态栏为单值），与 ComfyUI pickGpu 取首块口径一致。
 *  非法行 / 无输出返回 null。纯函数，可单测。 */
export function parseNvidiaSmiOutput(raw: string): NvidiaSmiMem | null {
  const line = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const parts = line.split(",").map((p) => p.trim());
  const used = Number(parts[0]);
  const total = Number(parts[1]);
  if (!Number.isFinite(used) || !Number.isFinite(total)) return null;
  if (used < 0 || total <= 0) return null;
  // 已用可能极轻微超过总量（驱动读数抖动），clamp 到总量内。
  return { usedMiB: Math.min(used, total), totalMiB: total };
}

function execFileP(
  cmd: string,
  args: string[],
  timeoutMs = 3000,
): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) resolve("");
        else resolve(stdout.toString());
      },
    );
  });
}

const SMI_CACHE_MS = 5000;
let smiCache: { at: number; value: NvidiaSmiMem | null } | null = null;

/** 查询本机 nvidia-smi 物理专用显存占用（字节）。
 *  MiB→字节换算；查询失败 / 非 NVIDIA 卡返回 null。带 5s 缓存。 */
export async function queryNvidiaVram(): Promise<NvidiaSmiMem | null> {
  const now = Date.now();
  if (smiCache && now - smiCache.at < SMI_CACHE_MS) return smiCache.value;

  const out = await execFileP("nvidia-smi", [
    "--query-gpu=memory.used,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  const parsed = parseNvidiaSmiOutput(out);
  smiCache = { at: now, value: parsed };
  return parsed;
}
