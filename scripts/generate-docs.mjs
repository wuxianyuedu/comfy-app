#!/usr/bin/env node
/**
 * generate-docs.mjs — 原文文档生成 / 一致性校验（跨平台，`pnpm doc:gen`）
 *
 * 与 `scripts/generate-docs.ps1` 同一套两步（顺序不能颠倒）：
 *   1. `pnpm doc:check`  校验编辑文档的占位符 / 裸值 / 路径与权威源码一致；
 *   2. `pnpm doc:render` 把占位符替换成从源码实时提取的真实值，写 docs/generated/。
 *
 * 为什么「先 check 再 render」：只有编辑文档与权威源一致时，生成出来的「原文」
 * 才有意义 —— 否则读到的是**一份看起来权威、实际已经过期**的数值副本，比没有
 * 这份文档更糟（ISSUE #242）。任一步失败即非零退出。
 *
 * Linux / macOS 此前只有 `pnpm doc:check` + `pnpm doc:render` 两条口令，写在
 * 文档里就必然有人只记得其中一条；入口形态（Windows 双击 .ps1）不是逻辑，
 * 逻辑必须有跨平台实现（规范 §9）。
 *
 * 用法：
 * 用法示例：node scripts/generate-docs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runPnpmSync } from "./launcher-core/shell.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 跑一条 `pnpm run <script>`，返回退出码；`null` = 前置条件不满足（已打印原因）。
 *
 * pnpm 的可执行形态由 shell.mjs 一处判定（规范 §2.1.1 / §9.5）：这里曾拿
 * `whichCommand("pnpm")` 的裸路径直接 spawn —— Windows 上命中的可能是
 * **批处理**形态（只有 cmd.exe 解释它，Node 起它 EINVAL）；能跑的 `.ps1` 形态
 * 还得连 PowerShell 宿主与 `-File` 参数一起给，那件事只有 `pnpmInvocation()`
 * 知道（ISSUE #638）。
 */
function runPnpm(script) {
  if (!fs.existsSync(path.join(ROOT, "node_modules", ".bin"))) {
    console.error(
      "[ERROR] 未检测到 node_modules/.bin，请先在项目根执行：pnpm install",
    );
    return null;
  }
  const result = runPnpmSync(["run", script], { cwd: ROOT, stdio: "inherit" });
  if (result.error) {
    console.error(
      `[ERROR] 起 pnpm 失败（${result.error.code ?? "UNKNOWN"}）：${result.error.message}`,
    );
    console.error(
      `[INFO] 实际命令：${result.command} ${result.args.join(" ")}`,
    );
    console.error("[INFO] 自查：pnpm check:toolchain");
    return null;
  }
  return result.status ?? 1;
}

function main() {
  console.log("[INFO] 步骤 1/2：文档引用一致性校验（pnpm doc:check）");
  const check = runPnpm("doc:check");
  if (check === null) return 1;
  if (check !== 0) {
    console.error(`[ERROR] 文档引用校验未通过（exit ${check}）。`);
    console.log(
      "[INFO] 请按上方报错，检查编辑文档里的占位符 / 裸值 / 路径是否与权威源一致。",
    );
    return check;
  }
  console.log("[OK]   文档引用一致性通过");
  console.log("");
  console.log("[INFO] 步骤 2/2：生成原文文档（pnpm doc:render）");
  const render = runPnpm("doc:render");
  if (render === null) return 1;
  if (render !== 0) {
    console.error(`[ERROR] 文档生成失败（exit ${render}）。`);
    console.log(
      "[INFO] 请确认权威源文件存在、doc-facts.cjs 的 extract 规则能读到值。",
    );
    return render;
  }
  console.log("[OK]   原文文档已生成到 docs/generated/");
  return 0;
}

process.exit(main());
