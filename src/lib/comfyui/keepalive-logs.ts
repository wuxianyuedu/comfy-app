/* ── 保活重定向日志的按次命名与轮转（自 lifecycle-launch 拆出，R5）──────
 *
 * 保活拉起把 ComfyUI 的 stdio 重定向到按次命名的
 * `comfyui-keepalive-<时间戳>.{out,err}.log`；这两个函数管「找最新一份」与
 * 「轮转清理」，与 spawn 编排本身无状态耦合，单独成件让 lifecycle-launch
 * 回到文件长度硬闸之内（规范 §12.6 R5）。
 *
 * §18.4 三选一：只有 node:fs / node:path 的 value import，与 launch-path.ts
 * 同族按第三类登记（tests/lib-node-only-declarations.test.ts 的
 * PURE_NODE_HOSTS）。
 */
import fs from "node:fs";
import path from "node:path";

import { SERVICES_LOG_DIR } from "~/lib/log/log-paths";

/**
 * 找 SERVICES_LOG_DIR 里最新的一对 `comfyui-keepalive-*.{out,err}.log`。
 *
 * 用于「接管」场景：那个实例不是本进程拉起的，拿不到它当次的重定向文件路径，
 * 只能按 mtime 取最近被写入的那份（还在跑的实例还在写，基本就是它）。
 * 取不到就返回空对象 —— 退出时带不出尾部，但监督本身照常。
 */
export function findLatestKeepAliveLogs(): { err?: string; out?: string } {
  try {
    if (!fs.existsSync(SERVICES_LOG_DIR)) {
      return {};
    }
    const pick = (suffix: string): string | undefined => {
      const newest = fs
        .readdirSync(SERVICES_LOG_DIR)
        .filter((name) => name.startsWith("comfyui-keepalive-") && name.endsWith(suffix))
        .map((name) => ({
          name,
          mtime: fs.statSync(path.join(SERVICES_LOG_DIR, name)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)[0];
      if (!newest) {
        return undefined;
      }
      return path.join(SERVICES_LOG_DIR, newest.name);
    };
    return { out: pick(".out.log"), err: pick(".err.log") };
  } catch {
    return {};
  }
}

/** 保活重定向日志的保留份数（一次拉起 = out + err 两个文件）。 */
const KEEPALIVE_LOG_KEEP_LAUNCHES = 10;

/**
 * 只保留最近 N 次保活拉起的重定向日志，删掉更老的。
 *
 * 这些文件是**按次命名**的（`comfyui-keepalive-<时间戳>.{out,err}.log`）：好处
 * 是不会被长持句柄锁死、不会互相覆盖，代价是**只建不删**——每次拉起都新增两个，
 * 长期用会在 `log/services/` 里一直堆积（AGENTS 硬规则 4 要的就是这种产物
 * 「按次命名 + 轮转」，光有命名没有轮转仍会堆积）。
 *
 * 每次新拉起顺手清一次最老的：保留的是 mtime 最新的那些，因此
 *   - 本次刚建的（最新）不会被自己删掉；
 *   - 仍在运行、还在被写入的实例（mtime 靠前）也不会被删。
 * 清理失败不该影响启动本身，故整体吞掉异常。
 */
export function pruneKeepAliveLogs(): void {
  try {
    if (!fs.existsSync(SERVICES_LOG_DIR)) {
      return;
    }
    const files = fs
      .readdirSync(SERVICES_LOG_DIR)
      .filter(
        (name) =>
          name.startsWith("comfyui-keepalive-") &&
          (name.endsWith(".out.log") || name.endsWith(".err.log")),
      )
      .map((name) => ({
        name,
        mtime: fs.statSync(path.join(SERVICES_LOG_DIR, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of files.slice(KEEPALIVE_LOG_KEEP_LAUNCHES * 2)) {
      fs.unlinkSync(path.join(SERVICES_LOG_DIR, old.name));
    }
  } catch {
    /* 清理失败不影响启动 */
  }
}
