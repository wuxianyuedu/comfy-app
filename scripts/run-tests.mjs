#!/usr/bin/env node
/**
 * run-tests.mjs — 只跑测试的跨平台入口（`pnpm test` / `pnpm test:file ...`）
 *
 * 与 `scripts/run-tests.ps1` 同一套语义（规范 11.12）：
 *   · 默认排除**已知基线失败**文件（清单唯一来源 `quality-gate-shared.mjs`），
 *     保证单跑时的红/绿能直接归因到本次改动；
 *   · `--full` 反其道而行，保留这些文件，用来复现基线失败；
 *   · 位置参数与 `--` 之后的参数原样透传给 vitest（`-t` / `--reporter` / 具体文件）；
 *   · 显式指定了文件时**不再追加排除项** —— 「我明明指定了它却不跑」比排除本身更难理解。
 *
 * 为什么要有跨平台版本：`tools/start/run-tests.ps1` 是 Windows 双击入口，Linux / macOS
 * 上此前只有「自己拼 `pnpm exec vitest run`」这一条路 —— 那份口令写在文档里就必然
 * 有人漏抄 `--exclude`，于是同一套用例在两个平台上给出不同的红/绿。
 *
 * 源码保持纯 ASCII：本文件会被 Next 的构建期模块图/NFT 相关的 code frame 路径间接
 * 触及（见 AGENTS 硬规则 15 与规范 §5），这类模块里混入多字节字符会让 Rust 侧按字节
 * 切串时 panic。中文只出现在 `.ps1` 入口与文档里。
 *
 * 用法：
 * 用法示例：node scripts/run-tests.mjs
 *   node scripts/run-tests.mjs --full（全量）
 *   node scripts/run-tests.mjs src/lib/media.test.ts（指定文件）
 *   node scripts/run-tests.mjs -- 后面跟 vitest 参数
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runPnpmSync } from "./launcher-core/shell.mjs";
import { KNOWN_FAILED_FILES } from "./quality-gate-shared.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function parseArgs(argv) {
  let full = false;
  const passthrough = [];
  for (const a of argv) {
    if (a === "--full" || a === "-Full") full = true;
    else passthrough.push(a);
  }
  return { full, passthrough: passthrough.filter((a) => a !== "--") };
}

function main() {
  const { full, passthrough } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(path.join(ROOT, "node_modules", ".bin"))) {
    console.error("[ERROR] 未检测到 node_modules/.bin，说明依赖还没装。");
    console.log("        [INFO] 请先在项目根目录执行：pnpm install");
    return 1;
  }
  const args = ["exec", "vitest", "run"];
  if (passthrough.length > 0) {
    console.log(
      `[INFO] 透传参数：${passthrough.join(" ")}（指定了文件的这一次不再追加已知基线失败排除项）`,
    );
    args.push(...passthrough);
  } else if (full) {
    if (KNOWN_FAILED_FILES.length > 0) {
      console.log(
        `[INFO] 全量模式：已知基线失败文件一并运行（${KNOWN_FAILED_FILES.join(" / ")}）。`,
      );
    }
  } else if (KNOWN_FAILED_FILES.length > 0) {
    console.log(
      `[INFO] 排除已知基线失败文件：${KNOWN_FAILED_FILES.join(" / ")}`,
    );
    for (const f of KNOWN_FAILED_FILES) args.push("--exclude", f);
  }

  console.log("");
  console.log(`>>> pnpm ${args.map((a) => `"${a}"`).join(" ")}`);
  console.log("");
  // pnpm 的可执行形态由 shell.mjs 一处判定（规范 §2.1.1 / §9.5）：这里曾拿
  // `whichCommand("pnpm")` 的裸路径直接 spawn —— Windows 上它可能是 Node 起不来的
  // `.cmd`（EINVAL，只有 cmd.exe 解释批处理），而能跑的是同目录经 PowerShell 宿主的
  // `.ps1`，宿主与 `-File` 参数必须一起给（ISSUE #638）。
  const result = runPnpmSync(args, {
    cwd: ROOT,
    stdio: "inherit",
    timeoutMs: 3_600_000,
  });
  if (result.error) {
    console.error(
      `[ERROR] 起 pnpm 失败（${result.error.code ?? "UNKNOWN"}）：${result.error.message}`,
    );
    console.log(
      `        [INFO] 实际命令：${result.command} ${result.args.join(" ")}`,
    );
    console.log("        [INFO] 自查：pnpm check:toolchain");
    return 1;
  }
  const code = result.status ?? 1;
  console.log("");
  if (code === 0) console.log("[OK] vitest 全部通过。");
  else console.error(`[ERROR] vitest 存在未通过的用例（exit ${code}）。`);
  return code;
}

process.exit(main());
