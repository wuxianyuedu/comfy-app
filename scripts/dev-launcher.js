#!/usr/bin/env node
/**
 * dev-launcher.js — 启动 Next.js dev server 并确保整棵进程树干净退出
 *
 * 问题背景：
 *   直接关闭 CMD 窗口时，npm → next 的 worker 子进程会变成孤儿残留，
 *   因为窗口关闭只杀掉直接附加到控制台的进程，子进程组不一定一起死。
 *
 * 方案：
 *   1. 以 detached:true 启动 npm run dev，获得独立 PID（进程组根）
 *   2. 监听 SIGINT / SIGTERM / exit（含窗口关闭触发的 CTRL_CLOSE_EVENT）
 *   3. 退出前用 taskkill /T /F /PID 杀掉整棵进程树（父+所有 worker）
 *
 * 用法：
 *   node scripts/dev-launcher.js            # 普通 dev
 *   node scripts/dev-launcher.js warm       # dev + 启动后预热路由（见 dev:warm）
 *
 * 预热说明：
 *   warm 模式下，dev server 起来后（延迟若干秒）会 detached 启动
 *   scripts/warm-routes.mjs，提前命中 Next.js 的 on-demand 编译缓存并填充
 *   服务端 LRU 缓存，让「第一次打开工作流」就已经很快。
 *
 *   注意：warm 脚本对 localhost 的 fetch 在沙箱内会被透明代理拦截，
 *   因此请务必在沙箱外运行（Bash 调用时加 dangerouslyDisableSandbox:true），
 *   或在宿主机直接 `npm run dev:warm`。
 */

const { spawn, execSync } = require("child_process");

const mode = process.argv[2] === "warm" ? "warm" : "normal";
const BASE = process.env.BASE_URL || "http://localhost:3000";
// dev 起来后再等一会儿再预热，避免和首次编译抢资源
const WARM_DELAY_MS = Number(process.env.WARM_DELAY_MS || 5000);

const child = spawn("npm", ["run", "dev"], {
  stdio: "inherit",
  detached: true, // 独立进程组，便于整树清理
  shell: true,
  windowsHide: false,
  env: process.env,
});

const rootPid = child.pid;
let warmChild = null;

function killTree() {
  if (warmChild && warmChild.pid) {
    try {
      execSync(`taskkill /T /F /PID ${warmChild.pid}`, { stdio: "ignore" });
    } catch (_) {
      /* 已退出则忽略 */
    }
  }
  if (!rootPid) return;
  try {
    // /T 递归杀掉所有子进程（next worker 等）；/F 强制
    execSync(`taskkill /T /F /PID ${rootPid}`, { stdio: "ignore" });
  } catch (_) {
    /* 进程已退出则忽略 */
  }
}

if (mode === "warm") {
  console.log(
    `[dev-launcher] warm mode: will pre-warm routes at ${BASE} after ${WARM_DELAY_MS}ms`
  );
  const timer = setTimeout(() => {
    warmChild = spawn("node", ["scripts/warm-routes.mjs", BASE], {
      stdio: "inherit",
      detached: true,
      shell: true,
      windowsHide: false,
      env: { ...process.env, BASE_URL: BASE },
    });
    warmChild.on("error", (err) => {
      console.warn("[dev-launcher] warm script failed to start:", err.message);
    });
  }, WARM_DELAY_MS);
  timer.unref?.();
}

// 键盘 Ctrl+C
process.on("SIGINT", () => {
  killTree();
  process.exit(0);
});

// 其他终止信号
process.on("SIGTERM", () => {
  killTree();
  process.exit(0);
});

// Windows 关闭控制台窗口 → CTRL_CLOSE_EVENT → 触发 exit handler
process.on("exit", () => {
  killTree();
});

// 子进程自身退出时，自己也退出（让上面的 exit handler 完成清理）
child.on("exit", (code) => {
  process.exit(typeof code === "number" ? code : 0);
});

child.on("error", (err) => {
  console.error("[dev-launcher] 启动失败:", err.message);
  process.exit(1);
});
