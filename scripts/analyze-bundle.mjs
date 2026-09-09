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

process.env.ANALYZE = "true";

// 走 pnpm exec 以复用仓库内本地 next 二进制（与 CI/启动器一致，不依赖全局 next）
const child = spawn(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "next", "build", "--webpack"],
  { stdio: "inherit", cwd: process.cwd() },
);

child.on("exit", (code) => process.exit(code ?? 1));
