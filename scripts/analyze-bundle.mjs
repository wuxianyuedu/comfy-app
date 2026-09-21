#!/usr/bin/env node
/**
 * analyze-bundle.mjs — 前端 bundle 体积分析入口（@next/bundle-analyzer）
 *
 * 为何用 Node 包装而非直接 `ANALYZE=true next build --webpack`：
 *   跨平台（本项目在 Windows 桌面壳为主，另有 Linux/macOS 构建路径）。
 *   内联 `VAR=val cmd` 仅 POSIX shell 支持，Windows 下 PowerShell/cmd 不认，
 *   故在 Node 里显式注入 process.env.ANALYZE 再 spawn，三平台行为一致。
 *
 * 注意：@next/bundle-analyzer 挂在 webpack 上，Turbopack 不支持；因此强制
 *   `next build --webpack`。默认 `next build`（Turbopack）不受本脚本影响。
 * 产物：.next/analyze/client.html、nodejs.html、edge.html，并监听
 *   http://127.0.0.1:8888 提供可视化报告。
 */
import { spawn } from "node:child_process";
import { echoCommandLine, formatCommandLine } from "./launcher-core/command-echo.mjs";
import { pnpmInvocation } from "./launcher-core/shell.mjs";

process.env.ANALYZE = "true";

// 走 pnpm exec 以复用仓库内本地 next 二进制（与 CI/启动器一致，不依赖全局 next）。
// pnpm 的可执行形态由 shell.mjs 判定（规范 §2.1.1）：Windows 上写死 `pnpm.cmd`
// 选中的批处理 Node 起不来，`spawn` 直接 error，构建会「什么都没跑就结束」。
const invocation = pnpmInvocation(["exec", "next", "build", "--webpack"]);
if (!invocation) {
  process.stderr.write(
    "[analyze] ✗ PATH 上找不到可用的 pnpm。先跑 `pnpm check:toolchain` 自查。\n",
  );
  process.exit(1);
}
// 回显命令行（`ANALYZE=true` 由本进程注入、不在行里体现，见文件头）。
echoCommandLine(invocation.command, invocation.args);
const child = spawn(invocation.command, invocation.args, {
  stdio: "inherit",
  cwd: process.cwd(),
});

// 命令没起来（spawn error）时 `exit` 不会触发，只挂 exit 会让脚本挂住/静默成功。
child.on("error", (error) => {
  process.stderr.write(
    `[analyze] ✗ 起 pnpm 失败（${error.code ?? "UNKNOWN"}）：${error.message}\n` +
      `[analyze]   实际命令：${formatCommandLine(invocation.command, invocation.args)}\n`,
  );
  process.exit(1);
});

child.on("exit", (code) => process.exit(code ?? 1));
