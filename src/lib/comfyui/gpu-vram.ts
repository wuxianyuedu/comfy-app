/* ── GPU 物理专用显存查询（nvidia-smi）──────────────────────────────
 * 背景（ISSUE #121 显存与任务管理器不一致）：
 *  ComfyUI /system_stats 的 vram_total/vram_free 来自 torch.cuda.mem_get_info，
 *  上游已不再上报 vram_used，我们用 total-free 推导出的是「CUDA 逻辑占用」。
 *  在 Windows WDDM 模型下 CUDA 分配会被驱动在「专用显存」与「共享 GPU 内存」
 *  之间分页，CUDA 口径显著大于任务管理器「专用 GPU 内存」（进程视角实测
 *  11.1GB vs 5.0GB）。要与任务管理器对齐，需查物理专用显存。
 *  NVIDIA 卡用 nvidia-smi 的 memory.used（与任务管理器同口径）；
 *  查询失败/非 NVIDIA 卡时由调用方回退 CUDA 口径。
 */

import { execFile } from "child_process";

/** nvidia-smi CSV 输出解析：--format=csv,noheader,nounits 的 memory.used。
 *  单位固定 MiB；单卡一行、多卡多行，这里取首行（与 ComfyUI 主设备惯例一致）。
 *  非法输出（空/非数字）返回 null。纯函数，可单测。 */
export function parseNvidiaSmiMemUsed(stdout: string): number | null {
  const firstLine = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  // 兼容可能的 "[N/A]" / "N/A" 等占位
  const m = /^(\d+)\s*$/.exec(firstLine);
  if (!m) return null;
  const mib = Number(m[1]);
  if (!Number.isFinite(mib) || mib < 0) return null;
  return mib * 1024 * 1024; // MiB → 字节
}

/** 查询结果缓存：显存占用是秒级变化的趋势值，5s 内复用，避免状态栏
 *  每 4s 轮询都各起一个 nvidia-smi 子进程（Windows 起进程 ~100ms+）。 */
let cache: { used: number | null; at: number } | null = null;
const CACHE_TTL_MS = 5000;

function queryNvidiaSmi(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=memory.used", "--format=csv,noheader,nounits"],
      { timeout: 2000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        resolve(parseNvidiaSmiMemUsed(String(stdout)));
      },
    );
  });
}

/** 读 GPU 物理专用显存占用（字节）。nvidia-smi 不可用/超时/非 NVIDIA 卡
 *  返回 null，由调用方回退到 CUDA 口径。带 5s 缓存。 */
export async function getGpuVramUsedPhysical(): Promise<number | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.used;
  const used = await queryNvidiaSmi();
  cache = { used, at: now };
  return used;
}

/** 测试钩子：清空缓存（仅测试用） */
export function resetGpuVramCacheForTest(): void {
  cache = null;
}
