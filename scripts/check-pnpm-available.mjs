#!/usr/bin/env node
// pnpm 可用性自检（跨平台，`pnpm check:toolchain`）。
//
// 为什么单独有一个入口：工具链门禁跑在**启动链路里**，命中失败就直接中断启动；
// 而「pnpm 到底怎么了」这个问题，用户最需要的时刻恰恰是「启动被拦下之后」——
// 那时他希望**只跑一次自查**、看到结论与修复动作，而不是反复双击入口撞同一堵墙。
//
// 本脚本是一个**薄壳**：所有判据都在 `scripts/launcher-core/` 里（`whichCommand`
// 的可执行形态选择、`probePnpm` 的探测、`orchestratePnpm` 的自动重建与复核、
// `buildTip` 的修复文案）。这里只负责打印与退出码 —— 判据一旦在这里重写一遍，
// 就有了第二份「pnpm 为什么不работает」的答案（Issue #576 的教训）。
//
// **版本不一致时做什么，必须与启动器同一条口径**（Issue #576 第三轮）：
// 启动链路里版本不一致是**自动对齐**的（`reconcilePnpmVersion()` → `preparePnpm()`
// + 同一条探测复核），而自检此前只 WARN 一句、什么也不做 —— 于是「白跑一趟：
// 真启动时它自己会好，用户却得手动跑 corepack」，`prepare-local-run.ps1` 的第 3 步
// 也早已自动对齐。现在自检**先试同一条对齐动作**，复核通过就报 OK（并说明做了什么），
// 只有复核仍不一致才 WARN + 给动作；启动器真正会拒绝的「node_modules 未装」
// 也一并检查，避免用户按自检的 OK 去启动、却被门禁拦在下一关。
//
// 退出码：0 = pnpm 可用（版本不一致只是 WARN，与启动器一致：不阻断启动）；
//        1 = 不可用（提示已打印，可直接照做）。
import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { orchestratePnpm, preparePnpm, probePnpm } from "./launcher-core/corepack.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 打印一行结论（纯 ASCII 前缀 + 原文，便于日志检索）。 */
function say(prefix, message) {
  process.stdout.write(`${prefix} ${message}\n`);
}

/** 只比数字主体：`v12.4.1` 与 `12.4.1` 是同一个版本（判据与启动器一致）。 */
/** @param {string | null} a @param {string | null} b @returns {boolean} */
function sameVersion(a, b) {
  if (!a || !b) return false;
  return a.replace(/^v/, "") === b.replace(/^v/, "");
}

/** node_modules 是否完全未装（`.modules.yaml` 缺失 = 从未正确安装）。
 *
 *  与启动器的 `checkNodeModules()` 取**同一个判据键**：自检报 OK 而下一关（完整
 *  依赖预检）立刻拦下，会让人以为自检在骗人 —— 这里至少把「还没装依赖」点出来。 */
/** @returns {{ healthy: boolean, detail: string }} */
function checkNodeModules() {
  const marker = path.join(root, "node_modules", ".modules.yaml");
  try {
    return fs.statSync(marker).isFile()
      ? { healthy: true, detail: "" }
      : { healthy: false, detail: "缺 node_modules/.modules.yaml" };
  } catch {
    return { healthy: false, detail: "缺 node_modules/.modules.yaml" };
  }
}

const result = orchestratePnpm({ root });

if (!result.probe.ok) {
  say("[ERROR]", "pnpm 不可用 —— 启动链路会在工具链门禁处停下。");
  process.stdout.write("\n");
  process.stdout.write(result.tip ?? "（没有可用的修复提示，请检查 launcher-core/corepack.mjs 的 buildTip）\n");
  process.stdout.write("\n");
  process.stdout.write(
    [
      "自查入口：pnpm check:toolchain",
      "本脚本不修改任何全局状态（例外：spawn-error 一类会自动 corepack prepare 重建，并复核结果）。",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

say("[OK]  ", `pnpm 可用：${result.probe.version}（${result.probe.command}）`);
if (result.repaired || result.tip) say("[INFO]", result.tip);

// 版本一致性：先按启动器的口径**试一次自动对齐**，复核通过才算「一致」。
if (result.expected && !sameVersion(result.probe.version, result.expected)) {
  const before = result.probe.version;
  say("[WARN]", `版本与 package.json 要求不一致（本机 ${before}，要求 ${result.expected}）—— 尝试 corepack 自动对齐…`);
  const prepare = preparePnpm({ root, expected: result.expected });
  const after = probePnpm({ root });
  if (after.ok && sameVersion(after.version, result.expected)) {
    say("[OK]  ", `已对齐：pnpm ${before} → ${after.version}（${prepare.description}）。`);
  } else {
    say("[WARN]", `自动对齐未生效（${prepare.description}，当前 ${after.ok ? after.version : "不可用"}）。`);
    say("[INFO]", "启动器对此只 WARN、不阻断启动；要手动对齐：");
    process.stdout.write(`         corepack enable && corepack prepare pnpm@${result.expected} --activate\n`);
  }
} else if (result.expected) {
  say("[OK]  ", `版本与 package.json 的 packageManager 一致（pnpm@${result.expected}）。`);
}

// node_modules：启动器的**另一道**门禁，自检不把它藏起来。
const modules = checkNodeModules();
if (modules.healthy) {
  say("[OK]  ", "node_modules 已装（.modules.yaml 存在）。");
} else {
  say("[WARN]", `node_modules 未装或不完整（${modules.detail}）—— 启动器会在「完整依赖预检」拦下。`);
  process.stdout.write("         修复：pnpm install（首次上手先 pnpm env:init 生成 .env）\n");
}

process.stdout.write(
  [
    "",
    "自查入口：pnpm check:toolchain",
    "本脚本不修改任何全局状态（例外：spawn-error 一类会自动 corepack prepare 重建，并复核结果）。",
    "",
  ].join("\n"),
);
process.exit(0);
