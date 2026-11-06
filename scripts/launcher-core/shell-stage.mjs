/**
 * 主流程第 3 步：prebuilt 模式下先拉起（或不拉起）桌面壳（ISSUE #1811 拆 R5）。
 *
 * 从 `dev-launcher.mjs` 的 `run()` 搬出来的这一段是「用户双击后第一件事是看见
 * 窗口」那一步，含一条容易踩错的判据：**自编排那次不再起第二个壳**（§1.5 / §1.3，
 * PR #1712 的回归）。它此前住在 `run()` 里，与端口归属、缓存策略、就绪等待同处
 * 一个 400 行的函数。
 *
 * **依赖靠注入**：`ctx` 给日志出口与几个壳层动作（它们住在 `shell-ops.mjs`，
 * 主文件对它们只有同名薄包装）。本模块不 import 主文件 —— 回引会成环。
 */
import fs from "node:fs";
import process from "node:process";

/**
 * 起桌面壳（仅 `--mode prebuilt`）。web / tauri 模式是空转，返回 `{ shell: null }`。
 *
 * 三个出口：
 *   · `{ error: string }` —— 找不到预编译壳（调用方 `status("error", …)` 后退 1）；
 *   · `{ shell: null, staleShell }` —— 自编排链路（壳已经在跑）或非 prebuilt；
 *   · `{ shell: ChildProcess, staleShell }` —— 本次真的起了一只壳。
 *
 * @param {object} ctx
 * @param {(m: string, l?: import("./log.mjs").LogLevel) => void} ctx.log 日志出口
 * @param {string} ctx.root 检出根
 * @param {(msg: string) => void} ctx.appendRuntimeWarning 把壳提醒补进 app-runtime 通道
 * @param {() => string | null} ctx.defaultShellExe 解析预编译壳路径
 * @param {(msg: string) => void} ctx.ensureSplashResource 同步启动页资源
 * @param {(exe: string, port: number, opts: { root?: string, foreground?: string | null }) => import("node:child_process").ChildProcess} ctx.spawnShell 拉起壳
 * @param {(root: string) => void} ctx.resetShellPidFile 清上一轮壳 PID 文件
 * @param {(exe: string, root: string) => string | null} ctx.shellStaleWarning 旧壳提醒
 * @param {object} target
 * @param {string} target.mode web | tauri | prebuilt
 * @param {string | null} target.shellExe 显式指定的壳路径（`--shell-exe`）
 * @param {boolean} target.coldStart 冷启动（给壳前台）
 * @param {number} target.port 已解析端口
 * @returns {{ ok: false, error: string } | { ok: true, shell: import("node:child_process").ChildProcess | null, staleShell: string | null }}
 */
export function startShellStage(ctx, target) {
  const { log, root, appendRuntimeWarning } = ctx;
  const { mode, shellExe: explicitExe, coldStart, port } = target;
  // 自编排标记：壳拉起本编排器时注入（`shell_launch.rs` 的 `spawn_orchestrator`）。
  // 它回答「本次编排是谁拉起的」，只有壳自编排链路（§1.5）里的 prebuilt 会带。
  const launchedByShell = process.env.COMFYAPP_SHELL_SELF_LAUNCH === "1" && mode === "prebuilt";
  if (mode !== "prebuilt") {
    return { ok: true, shell: null, staleShell: null };
  }
  const shellExe = explicitExe ?? process.env.COMFYAPP_PREBUILT_SHELL ?? ctx.defaultShellExe();
  if (!shellExe || !fs.existsSync(shellExe)) {
    return {
      ok: false,
      error:
        "找不到预编译 Tauri 壳（src-tauri/target/{release,debug}/app[.exe]）。" +
        "请先执行 cargo build --release --features custom-protocol 或 pnpm tauri build。",
    };
  }
  let staleShell = ctx.shellStaleWarning(shellExe, root);
  if (staleShell) {
    log(staleShell, "WARN");
    appendRuntimeWarning(staleShell);
  }
  ctx.resetShellPidFile(root);
  if (launchedByShell) {
    /* 双击壳的自编排链路（§1.5）里，拉起本编排器的那只壳**就是**本次启动唯一
     * 的应用宿主：启动页与主窗都是 tauri.conf.json 的声明式窗口，每个壳进程
     * 各建一份。这里若再 spawn 一只壳，同一次启动就有两个壳——用户会看到两个
     * 一模一样的启动窗口（PR #1712 的回归），两只壳的回收链还互相纠缠（关掉
     * 任意一只都会把编排器连同另一只一起收走）。所以自编排那次**只编排、
     * 不起壳**：壳已经在跑，把本地服务起起来就好。 */
    log("本次编排由桌面壳亲自拉起：壳已在运行，不再起第二个壳。", "INFO");
    return { ok: true, shell: null, staleShell };
  }
  ctx.ensureSplashResource(root);
  const shell = ctx.spawnShell(shellExe, port, {
    root,
    foreground: coldStart ? "1" : null,
  });
  log(`预编译 Tauri 壳已启动（PID ${shell.pid}）：${shellExe}`, "OK");
  log("Tauri 桌面壳已启动，正在启动本地服务…", "STEP");
  return { ok: true, shell, staleShell };
}
