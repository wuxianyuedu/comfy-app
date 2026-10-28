/**
 * 桌面壳层的编排（ISSUE #1811 拆 R5 超限文件）。
 *
 * 从 `dev-launcher.mjs` 搬出来的四件事:找预编译壳、同步启动页资源、拉起壳并落
 * PID 锚点、按 PID 文件兜底回收。它们此前与端口回收、依赖补装、主流程同住一份
 * 1540 行的文件里。
 *
 * **依赖靠注入,不靠 import 回主文件**:`ctx.log` 是主文件的日志出口、`ctx.spawned`
 * 是「本次会话拉起的子进程」数组(收尾时整树回收)、`ctx.reapProcessTree` 是整树
 * 回收的出口。回引主文件会成环,而把状态复制一份到这边就等于「两处各记一半子
 * 进程」—— 少收的那一半正是残留进程;`reapProcessTree` 更是写第二份就等于
 * §12.12 的孪生对。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { isWindows } from "./procs.mjs";
import { syncSplashAssets } from "./splash-assets.mjs";
import { currentDirOf } from "./log.mjs";
import { recordPid } from "./run.mjs";
import { spawnInGroup } from "./shell.mjs";

/** 解析预编译壳的可执行文件（Windows `app.exe`、POSIX 无后缀）。 */
/** @param {string} [root] @returns {string | null} */
export function defaultShellExe(root = process.cwd()) {
  const candidates = isWindows()
    ? ["src-tauri/target/release/app.exe", "src-tauri/target/debug/app.exe"]
    : ["src-tauri/target/release/app", "src-tauri/target/debug/app"];
  for (const rel of candidates) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * 确保 Tauri 启动页资源就位（frontendDist 编译期嵌入，运行时同步保证下次编对）。
 *
 * 副本清单（`splash.html` + `index.html`）与同步动作在
 * `launcher-core/splash-assets.mjs` 一处定义，这里只接线与记日志 ——
 * **不要在本文件里再写一份副本名清单**：此前正是这里手写了一份、只同步了
 * `splash.html`，`index.html` 于是长期停在旧版（症状与根因见该模块的文件头注释）。
 *
 * @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void }} ctx 日志出口
 * @param {string} [root]
 */
export function ensureSplashResource(ctx, root = process.cwd()) {
  const result = syncSplashAssets(root);
  if (result.status === "missing-source") {
    ctx.log("未找到 public/splash.html，Tauri 启动页可能无法显示", "WARN");
    return result;
  }
  if (result.status === "error") {
    ctx.log(`同步启动页失败：${result.message}`, "WARN");
    return result;
  }
  if (result.status === "ok") {
    ctx.log(
      `已同步启动页 → src-tauri/splash-assets/（${result.written.join(" + ")}，frontendDist，编译期嵌入）`,
      "INFO",
    );
  }
  return result;
}

/** 拉起预编译壳，并把 PID 落盘（启动器先退出时的兜底回收锚点）。 */
/**
 * 预编译壳的拉起参数。
 * @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void, spawned: import("node:child_process").ChildProcess[] }} ctx 日志出口与子进程账本
 * @param {string} shellExe 壳可执行文件路径
 * @param {number} port 应用端口
 * @param {{ root?: string, foreground?: string | null }} [options]
 *   检出根与前台开关
 */
export function spawnShell(
  ctx,
  shellExe,
  port,
  { root = process.cwd(), foreground = null } = {},
) {
  const child = spawnInGroup({
    command: shellExe,
    args: [],
    cwd: root,
    env: {
      ...process.env,
      COMFYAPP_PROJECT_ROOT: root,
      COMFYAPP_DEV_URL: `http://127.0.0.1:${port}/workspace`,
      COMFYAPP_PORT: String(port),
      COMFYAPP_FOREGROUND: foreground ?? process.env.COMFYAPP_FOREGROUND ?? "0",
    },
  });
  ctx.spawned.push(child);
  recordPid(root, "shell", child.pid ?? null);
  try {
    fs.writeFileSync(
      path.join(currentDirOf("launcher", root), "tauri-shell.pid"),
      String(child.pid ?? ""),
      "ascii",
    );
  } catch {
    /* 兜底锚点写不进去不影响本次启动 */
  }
  return child;
}

/** 清掉上一轮留下的壳 PID 文件（在拉起之前调用）。
 *
 *  文件是「上一次 run 的残留」，而本编排器是被启动器另起的进程 —— 在写到新 PID
 *  之前，文件里还是旧 PID。系统会复用 PID，旧号很可能已归某个无关进程，兜底
 *  回收路径读到它就会去杀不相干的东西。先删 = 窗口期内读不到，语义安全。 */
export function resetShellPidFile(root = process.cwd()) {
  try {
    fs.rmSync(path.join(currentDirOf("launcher", root), "tauri-shell.pid"), {
      force: true,
    });
  } catch {
    /* 忽略 */
  }
}

/** 回收本次拉起的壳（整棵进程树）；PID 取不到/不是数字/已退出都直接返回。
 * @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void, reapProcessTree: (o: { pid: number, detached?: boolean, force?: boolean }) => Promise<{ ok: boolean, via: string }> }} ctx 日志出口与整树回收出口
 * @param {string} [root] @returns {Promise<boolean>} */
export async function killShellFromPidFile(ctx, root = process.cwd()) {
  const file = path.join(currentDirOf("launcher", root), "tauri-shell.pid");
  let pid;
  try {
    pid = Number.parseInt(fs.readFileSync(file, "utf8").trim(), 10);
  } catch {
    return false;
  } finally {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* 忽略 */
    }
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const via = await ctx.reapProcessTree({
    pid,
    detached: !isWindows(),
    force: true,
  });
  ctx.log(`兜底回收桌面壳（PID ${pid}）：${via.via}`, "STEP");
  return true;
}

