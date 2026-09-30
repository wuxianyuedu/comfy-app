#!/usr/bin/env node
/**
 * shell-gate.mjs — 改了桌面壳才跑的提交门禁（规范 §11.10.4 / AGENTS 硬规则 5）
 *
 * 补的是两条一直「只有文档口径」的洞：
 *
 *   1. **壳里的 `#[test]` 从不自动跑。** `src-tauri/src/**` 有 37 条单测（端口推导、
 *      单实例哈希分桶、进程回收、项目根上溯…），但全仓没有任何一步执行 `cargo test` ——
 *      它们只在文档正文里被提到过。表现是「Rust 侧改坏了，提交与本地钩子全绿」，
 *      要等到下次出包或运行时才现形。
 *   2. **「改了壳必须重编」没有判据。** 硬规则 5 讲的是编译期内嵌（窗口配置与启动页
 *      打进二进制），只改源码不重编 = 跑旧二进制（历史黑屏事故来源）。这条一直靠人记。
 *
 * 两步的代价与触发面不同，所以**分开条件**，不是一揽子：
 *   · `cargo test` 只在暂存改动里有 `src-tauri/src/*.rs` 时跑 —— 实测本机冷 430s /
 *     暖 40s（37 条本身只跑 0.07s，钱全在编译），只改 conf 或启动页时不必付；
 *   · 时效判据对四类输入都判（`tauri.conf.json` / `build.rs` / `src/` / `splash-assets/`），
 *     它们任何一处变了而 exe 没跟着重编，就是硬规则 5 说的那个状态。
 *
 * 时效判据**复用** `dev-launcher.mjs` 的 `shellStaleWarning()`（§12.18，不写第二份比
 * 时间戳的逻辑）。它原本只在启动时打一条 WARN；这里升级为「本次提交改了壳 → 阻断」。
 * ⚠️ 为什么必须条件化：该判据比的是 **mtime**，而 `git pull` / `checkout` / `stash`
 * 会批量推进源码 mtime —— 无条件阻断会让「拉了别人改壳的分支」把本地一个没动过壳的
 * 提交拦下来（`launcher-core/splash-assets.mjs` 里「内容没变就不写盘」就是在护这个数）。
 * 只有当**暂存区里就是本次的壳改动**时，这个比较才指向提交者自己。
 *
 * **合并提交（`merge` 进行中）**：`git diff --cached` 在合并态下报的是「相对第一父
 * 的整份内容差」，于是被合进来的那一侧（如 master 上早已编好、发过版的
 * `splash-assets/`）会被算成「本次改了壳」—— 表现是本地根本编不出壳（Linux 容器 /
 * 非 Windows 机器）时，一个纯前端 PR 只因拉了 master 就被永久拦死。
 *
 * 判据是「这次合并自己有没有创作壳内容」：某个壳输入**同时**不同于第一父（HEAD）
 * 与第二父（`MERGE_HEAD`）才算法定改动。仅与第一父不同、而与第二父逐字节相同 = 只是
 * 原样采纳了对方那侧（`git merge` 自动合并的常态），不是本次改动，不触发重编判据。
 * 冲突解决若真动过壳文件，它两侧都不同，照样进清单 —— 判据不放松。
 *
 * 用法：`node scripts/shell-gate.mjs`（由 `.githooks/pre-commit` 的 D 组调用）
 *      `node scripts/shell-gate.mjs --staged a b c`（手工指定清单，调试用）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { defaultShellExe, shellStaleWarning } from "./dev-launcher.mjs";
import { whichCommand } from "./launcher-core/shell.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 会改变壳二进制内容的四类输入（与 `shellStaleWarning` 的 targets 同集合）。 */
export const SHELL_INPUT_RE =
  /^src-tauri\/(?:tauri\.conf\.json|build\.rs|src\/|splash-assets\/)/;
/** Rust 源码（决定要不要付 `cargo test` 那笔编译钱）。 */
export const RUST_SOURCE_RE = /^src-tauri\/src\/.*\.rs$/;

/** 读暂存区文件清单（相对仓库根、正斜杠）。 */
export function stagedFiles() {
  const out = spawnSync("git", ["diff", "--cached", "--name-only"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (out.status !== 0) return [];
  return out.stdout.split(/\r?\n/).filter(Boolean);
}

/**
 * 合并态下，过滤掉「只是原样采纳了对方那侧」的壳输入 —— 它们不该触发重编判据。
 *
 * `MERGE_HEAD` 存在即正处于合并提交（`repoRoot/.git/MERGE_HEAD`）。此时
 * `git diff --cached --name-only` 列出的是「相对第一父（HEAD）的整份内容差」，其中
 * 被合进来的那侧（如 master 上早已编好发版的 `splash-assets/`）也在内。判据：某文件
 * **同时**不同于第一父与第二父，才算法定改动；只与第一父不同、与第二父逐字节相同
 * = 自动合并原样采纳，不是本次创作。
 *
 * @param {string[]} staged `git diff --cached --name-only` 的结果。
 * @param {string} [repoRoot] 仓库根（默认本仓库；单测传临时仓库）。
 * @returns {string[]} 过滤后的清单；非合并态原样返回。
 */
export function dropAdoptedShellInputs(staged, repoRoot = ROOT) {
  const mergeHeadPath = path.join(repoRoot, ".git", "MERGE_HEAD");
  if (!fs.existsSync(mergeHeadPath)) return staged;
  const mergeHead = fs.readFileSync(mergeHeadPath, "utf8").trim();
  if (!mergeHead) return staged;
  return staged.filter((file) => {
    if (!SHELL_INPUT_RE.test(file)) return true;
    // 与第二父（被合进来的那侧）一致 ⇒ 只是采纳，不算本次改动。
    const againstMergeHead = spawnSync(
      "git",
      ["-C", repoRoot, "diff", "--quiet", mergeHead, "--", file],
      { cwd: repoRoot },
    );
    return againstMergeHead.status !== 0;
  });
}

/**
 * 这一步要不要跑、跑哪两问。
 *
 * @param {string[]} staged
 * @returns {{touchesShell: boolean, needsCargoTest: boolean}}
 */
export function decide(staged) {
  return {
    touchesShell: staged.some((f) => SHELL_INPUT_RE.test(f)),
    needsCargoTest: staged.some((f) => RUST_SOURCE_RE.test(f)),
  };
}

/** 跑 `cargo test`；返回退出码（cargo 不在 PATH 时返回 null，由调用方给指路）。 */
function runCargoTest() {
  const cargo = whichCommand("cargo");
  if (!cargo) return null;
  const r = spawnSync(cargo, ["test"], {
    cwd: path.join(ROOT, "src-tauri"),
    stdio: "inherit",
    windowsHide: true,
  });
  return r.status ?? 1;
}

/** 壳时效：返回要阻断的消息，或 null（没改壳 / exe 比源码新）。 */
export function freshnessProblem() {
  const exe = defaultShellExe(ROOT);
  if (!exe) {
    return (
      "改了桌面壳，但检出里根本没有编出来的壳" +
      "（src-tauri/target/{release,debug}/app[.exe] 都不存在）。\n" +
      "        先重编：cd src-tauri && cargo build --release --features custom-protocol\n" +
      "        （feature 不能省：不带它启动页会被导航到 devUrl、资源不内嵌，冷启动必现错误页）"
    );
  }
  const warning = shellStaleWarning(exe, ROOT);
  if (!warning) return null;
  // 判据原文结尾就是「建议重编：<命令>」，这里不再重复一遍，只补上「为什么必须重编」。
  const detail = (warning.split("；建议重编")[0] ?? warning).replace(
    /^正在运行旧版桌面壳/,
    "二进制仍是旧的",
  );
  return (
    `本次提交改了桌面壳，但${detail}。\n` +
    "        窗口配置与启动页是编译期内嵌的，只改源码不重编 = 跑旧二进制（规范 §5 黑屏事故）。\n" +
    "        重编：cd src-tauri && cargo build --release --features custom-protocol"
  );
}

function main() {
  const argv = process.argv.slice(2);
  const stagedIdx = argv.indexOf("--staged");
  // 显式清单（`--staged a b c`）是调试 / 覆写通道，调用方说了算，不过采纳过滤；
  // 只有从暂存区自动推导时，才剔除「原样采纳对方那侧」的壳文件
  // （见 dropAdoptedShellInputs）—— 否则纯前端 PR 只要拉了 master 就被永久拦住。
  const staged =
    stagedIdx >= 0 ? argv.slice(stagedIdx + 1) : dropAdoptedShellInputs(stagedFiles());
  const { touchesShell, needsCargoTest } = decide(staged);

  if (!touchesShell) {
    // 没碰壳就什么都不做（这一步不该给普通前端提交加一毫秒）。
    return 0;
  }

  console.log("[shell-gate] 暂存改动命中 src-tauri 的四类壳输入，开始判：");

  if (needsCargoTest) {
    console.log("  · cargo test（src-tauri/src/** 有改动）");
    const code = runCargoTest();
    if (code === null) {
      console.error(
        "[shell-gate] PATH 上找不到 cargo —— 改了 Rust 壳却编不了，等于没验证。\n" +
          "        装 Rust 工具链：https://rustup.rs/（或换一台能编壳的机器提交）",
      );
      return 1;
    }
    if (code !== 0) {
      console.error(
        `[shell-gate] ✗ cargo test 失败（退出码 ${code}）—— 壳侧单测是这 37 条的唯一执行者，先修再提`,
      );
      return code;
    }
    console.log("  [ok] cargo test");
  } else {
    console.log(
      "  · 跳过 cargo test（只改了 conf / build.rs / 启动页，Rust 源码没动）",
    );
  }

  const problem = freshnessProblem();
  if (problem) {
    console.error(`[shell-gate] ✗ ${problem}`);
    return 1;
  }
  console.log(
    "  [ok] 壳二进制时效（复用 dev-launcher 的 shellStaleWarning 判据）",
  );
  return 0;
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
