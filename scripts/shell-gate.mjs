#!/usr/bin/env node
/**
 * shell-gate.mjs — 改了桌面壳才跑的提交门禁（规范 §11.10.4 / AGENTS 硬规则 5）
 *
 * 补的是两条一直「只有文档口径」的洞：
 *
 *   1. **壳里的 `#[test]` 从不自动跑。** `src-tauri/src/**` 里那批单测（端口推导、
 *      单实例哈希分桶、进程回收、项目根上溯…）此前只出现在文档正文里 ——
 *      全仓没有任何一步执行 `cargo test`。表现是「Rust 侧改坏了，提交与本地钩子全绿」，
 *      要等到下次出包或运行时才现形。
 *   2. **「改了壳必须重编」没有判据。** 硬规则 5 讲的是编译期内嵌（窗口配置与启动页
 *      打进二进制），只改源码不重编 = 跑旧二进制（历史黑屏事故来源）。这条一直靠人记。
 *
 * 两步的代价与触发面不同，所以**分开条件**，不是一揽子：
 *   · `cargo test` 只在暂存改动里有 `src-tauri/src/*.rs` 时跑 —— 实测本机冷 430s /
 *     暖 40s（用例本身只跑 0.07s，钱全在编译），只改 conf 或启动页时不必付；
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
 *      `node scripts/shell-gate.mjs --base <ref>`（**以 PR diff 为判决面**，平台侧那一档）
 *
 * ── `--base` 形态：为什么要有它（ISSUE #2224 的现场）────────────────────
 *
 * 这一步的判决面是「**本次改了什么**」，而本地形态从**暂存区**取那个面 —— 平台上
 * 没有暂存区，于是 `touchesShell` 恒假 ⇒ 这一步在平台上**恒绿且一个字都不打**
 * （§11.10.4 那两条「改了壳必须重编」与「壳内 `#[test]`」在平台侧没有执行者）。
 *
 * `--base <ref>` 换一个**判决面的来源**：「相对那条基线改了什么」—— 平台上拿得到
 * （PR 事件上平台给 `CNB_PULL_REQUEST_TARGET_SHA`，由 `scripts/changed-scope.mjs`
 * 统一选基线，与「受影响用例」那一格同一份口径）。判决链一字未改：还是
 * 「碰没碰壳 → 要不要 cargo test → 壳时效」。
 *
 * 这一形态下有**两处与本地形态不同**，且两处都因为「平台上没有那件东西」：
 *   · **壳时效不判** —— 判据比的是「编出来的 exe 比源码旧」，而平台检出里**没有**
 *     编出来的壳（exe 不入库）。硬判的结果是「这个 PR 只要碰了壳就必红」，而那条红
 *     与代码无关 ⇒ 改成**不判并说出来**（时效判据的对象是本地那个 exe）。
 *   · **cargo 缺失退 2 而不是退 1** —— 「这台机器上没有 cargo」是「这一格没跑起来」，
 *     不是「判据判出失败」（§13.5.25 的三态口径）。本地形态保持退 1（那边确实该拦）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { defaultShellExe, shellStaleWarning } from "./dev-launcher.mjs";
import { whichCommand } from "./launcher-core/shell.mjs";
import { resolveGitDir } from "./git-dir.mjs";
import { changedFilesForBaseRef } from "./changed-scope.mjs";
import { hostTripleFromCargoVersion, sidecarFileName } from "./sidecar-name.mjs";

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
  // 本仓检出在哪：走权威解析（认链接工作树里 `.git` 是个文件的情形），不硬拼
  // 检出子目录（硬拼在 worktree 上指向那个文件、MERGE_HEAD 永远查不到）。
  const gitDir = resolveGitDir(repoRoot);
  if (!gitDir) return staged; // 不在 git 检出里 ⇒ 没有合并进行中，原样返回
  const mergeHeadPath = path.join(gitDir, "MERGE_HEAD");
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

/**
 * cargo 的寻址判据：**PATH 优先，回退到工具链的默认安装位**。
 *
 * 为什么不能只认 PATH（ISSUE #1555）：CI / 容器镜像是**精修过 PATH** 的 ——
 * `~/.cargo/bin` 常常不在（实测本仓开发容器里 `which cargo` 为空，而同一台机器上
 * `~/.cargo/bin/cargo` 与 `~/.rustup/toolchains/<版本>/bin/cargo` 都在）。那种机器上
 * 改一行 Rust 就被判成「编不了」，而真因只是「探针比 cargo 装得更苛刻」。
 * 单独认安装位也不行：PATH 上那份**才是**要跑的那份（用户可能自选工具链、
 * 或用 distro 包管理器装的那份），越过 PATH 去猜 rustup 的目录 = 拿另一个
 * 版本编壳。两条并成一条判据：先问 PATH，问不到才回退。
 *
 * 回退面刻意**只收 rustup 的三处**（CARGO_HOME/bin、~/.cargo/bin、~/.rustup/），
 * 不做 PATH 式的目录递归 —— 判据越宽，越可能选中一个不该用的 cargo。
 *
 * @returns {string | null} cargo 的绝对路径；PATH 与三处安装位都没有 = `null`
 */
export function findCargo() {
  const onPath = whichCommand("cargo");
  if (onPath) return onPath;
  const home = os.homedir();
  /* 三处候选**按条件拼**（而不是先塞一个 `false` 再 filter 掉）：`CARGO_HOME` 未设时
   * `process.env.CARGO_HOME && …` 求值成 `false`，数组就成了 `(string | false)[]`，
   * 而 `.mjs` 里写不了 `dir is string` 这种谓词（TS8010：类型注解只许出现在 `.ts`），
   * tsc 也不会从 `typeof dir === "string" && dir.length > 0` 里推 —— 结果是下面整段
   * 都带着 `string | undefined` 用。改成按条件拼之后类型本身就是 `string[]`，
   * 不用靠注解断言。 */
  /** @type {string[]} */
  const candidates = [];
  if (process.env.CARGO_HOME) {
    candidates.push(path.join(process.env.CARGO_HOME, "bin"));
  }
  candidates.push(path.join(home, ".cargo", "bin"));
  candidates.push(path.join(home, ".rustup", "toolchains"));

  for (const dir of candidates) {
    if (dir.endsWith("toolchains")) {
      // rustup 的每个工具链各有一份 cargo：取版本号最大的那个（字典序即版本序，
      // 1.10 与 1.9 这种少见形态不在此纠偏 —— 只认「挑不到就继续找下一处」。
      /** @type {string[]} */
      let versions = [];
      try {
        versions = fs.readdirSync(dir).sort().reverse();
      } catch {
        continue; // 目录不存在 = 这一处没有，接着看下一处（不是「探到但不可用」）
      }
      for (const version of versions) {
        const exe = path.join(dir, version, "bin", cargoExeName());
        if (fs.existsSync(exe)) return exe;
      }
      continue;
    }
    const exe = path.join(dir, cargoExeName());
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

/** cargo 的文件名（Windows 上带 .exe；其余平台无后缀）。 */
function cargoExeName() {
  return process.platform === "win32" ? "cargo.exe" : "cargo";
}

/**
 * `cargo test` 的**编译前提落位**（ISSUE #2192 那条 PR 的平台首跑现场）：
 * `src-tauri` 的 build script 会校验 `bundle.externalBin` 与 `resources` 声明的
 * 路径**存在**（`tauri.conf.json` 的 `binaries/node` 与 `static/`），而真产物
 * 由 `build-desktop.mjs` 组装、被 `src-tauri/.gitignore` 忽略 ⇒ 平台侧每次都是
 * 全新 clone，第一次 cargo test 就死在 build script 上（实测原文
 * `resource path … doesn't exist`，指名 `binaries\node-x86_64-pc-windows-msvc.exe`）。
 *
 * 落位的是**编译前提**，不是真产物：
 *   · sidecar = 复制**当前正在跑门禁的这个 node**（与 build-desktop 同一来源；
 *     测试不执行它，内容只要求是同平台的 node）；
 *   · static = 缺目录时建一个空目录 + 占位文件（资源打包的真实内容由
 *     `tauri build` 之前的 build-desktop 组装，两路互不冒充）。
 *
 * 已在场的产物**一律不碰**（本地跑过 build-desktop 时是真实的，占位不许覆盖它）。
 *
 * @param {{
 *   root?: string,
 *   cargo?: string | null,
 *   execPath?: string,
 *   versionOutput?: string | null,
 *   exists?: (p: string) => boolean,
 *   mkdir?: (p: string, o?: { recursive?: boolean }) => void,
 *   copy?: (source: string, dest: string) => void,
 *   chmod?: (p: string, m: number) => void,
 *   write?: (p: string, s: string) => void,
 *   platform?: NodeJS.Platform,
 * }} [deps] 全部可注入 —— 用例据此判「建了什么 / 没动什么」，不碰真盘；
 *   `versionOutput` 是 `cargo -vV` 的替身（不注入才真起一次）。
 * @returns {{ ok: boolean, lines: string[] }}
 *   `ok: false` = 前提落不了位（triple 取不到等），调用方按编译失败收场并把
 *   `lines` 打出来。
 */
export function materializeCargoTestInputs({
  root = ROOT,
  cargo = findCargo(),
  execPath = process.execPath,
  versionOutput,
  exists = (p) => fs.existsSync(p),
  mkdir = (p, o) => fs.mkdirSync(p, o),
  copy = (a, b) => fs.copyFileSync(a, b),
  chmod = (p, m) => fs.chmodSync(p, m),
  write = (p, s) => fs.writeFileSync(p, s, "utf8"),
  platform = process.platform,
} = {}) {
  const srcTauri = path.join(root, "src-tauri");
  /** @type {string[]} */
  const lines = [];

  // 三元组从 cargo 自己嘴里问（`cargo -vV` 的 `host:` 行）—— cargo test 按宿主
  // 三元组编译，sidecar 名里带的是同一个；写死或从 process.arch 翻译都会漂。
  let triple = null;
  if (cargo !== null && cargo !== undefined) {
    const out =
      versionOutput ??
      (spawnSync(cargo, ["-vV"], { encoding: "utf8", windowsHide: true }).stdout ?? "");
    triple = hostTripleFromCargoVersion(out) ?? null;
  }
  if (!triple) {
    return {
      ok: false,
      lines: [
        "[shell-gate] × cargo test 编译前提落不了位：从 `cargo -vV` 取不到目标三元组" +
          "（sidecar 文件名里必须带它，见 scripts/sidecar-name.mjs）。",
      ],
    };
  }

  const sidecar = path.join(srcTauri, "binaries", sidecarFileName(triple, platform));
  if (!exists(sidecar)) {
    mkdir(path.dirname(sidecar), { recursive: true });
    copy(execPath, sidecar);
    if (platform !== "win32") chmod(sidecar, 0o755);
    lines.push(
      `[shell-gate] cargo test 编译前提：sidecar 不在（全新 clone 的常态）⇒ 复制当前 node 落位 ${sidecar}`,
    );
  }

  const staticDir = path.join(srcTauri, "static");
  if (!exists(staticDir)) {
    mkdir(staticDir, { recursive: true });
    write(
      path.join(staticDir, ".cargo-test-placeholder"),
      "cargo test 的编译前提占位：resources 声明的 static/ 必须存在。\n" +
        "真产物由 scripts/build-desktop.mjs 在 tauri build 之前组装；本文件随下一次组装被替换。\n",
    );
    lines.push(
      `[shell-gate] cargo test 编译前提：static/ 不在 ⇒ 建空目录 + 占位（真产物归 build-desktop）`,
    );
  }
  return { ok: true, lines };
}

/** 跑 cargo test；返回退出码（找不到 cargo 时返回 null，由调用方给指路）。 */
function runCargoTest() {
  const cargo = findCargo();
  if (!cargo) return null;
  const prep = materializeCargoTestInputs({ cargo });
  for (const line of prep.lines) process.stdout.write(`${line}\n`);
  if (!prep.ok) return 1;
  const r = spawnSync(cargo, ["test"], {
    cwd: path.join(ROOT, "src-tauri"),
    stdio: "inherit",
    windowsHide: true,
  });
  return r.status ?? 1;
}

/**
 * 壳时效：返回要阻断的消息，或 null（没改壳 / exe 比源码新）。
 *
 * `root` 可传是为了让**判决可被夹具执行**（ISSUE #1356）：此前它被模块级 `ROOT` 钉死，
 * 于是「壳陈旧 ⇒ 阻断」这条传导从来没有用例跑过，规范 §11.10.4 那句「判据由测试锁」
 * 只覆盖得到触发面。比时间戳的逻辑仍然只有 launcher 那一份（§12.18）。
 */
export function freshnessProblem(root = ROOT) {
  const exe = defaultShellExe(root);
  if (!exe) {
    return (
      "改了桌面壳，但检出里根本没有编出来的壳" +
      "（src-tauri/target/{release,debug}/app[.exe] 都不存在）。\n" +
      "        先重编：cd src-tauri && cargo build --release --features custom-protocol\n" +
      "        （feature 不能省：不带它启动页会被导航到 devUrl、资源不内嵌，冷启动必现错误页）"
    );
  }
  const warning = shellStaleWarning(exe, root);
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

/**
 * 走过的每一格。类型写全而不是 `Record<string, unknown>`：消费方（用例）要拼 `${kind}:${state}`
 * 并按 `kind` 收窄后读 `problem`，`unknown` 会让这些读法在 strict 下报错，
 * 而为了让断言过就地把它们 `as string` 掉，等于把类型的意义丢掉。
 *
 * `freshness` 的 `skipped` 只出现在 `--base` 形态下：平台上没有编出来的壳，
 * 时效判据没有对象（原因见文件头那一段）。
 *
 * @typedef {{ kind: "cargo", state: "skipped" | "missing" | "ok" | "failed", code?: number }
 *   | { kind: "freshness", state: "ok" | "blocked" | "skipped", problem?: string }} GateStep
 */

/**
 * 判决本体：给定清单，决定这一步的退出码与走过的每一格。
 *
 * 抽成纯入口是**为了可被执行**（ISSUE #1356）—— 旧版把判决写在 `main()` 的 print 语句之间，
 * 于是「cargo 缺失要拦」「cargo 失败就不再判时效」「壳陈旧要拦」「没编出壳要拦」这四条
 * 只能用源码文本断言（`toContain("whichCommand")` 加一段抠源码正则），而**源码文本不是执行记录**
 * （同族事故：#1345 把脚本自己打的 label 当成执行记录、#1350 把陈旧 `$LASTEXITCODE` 当成败）。
 * 形状沿用 `check-dependency-audit.mjs` 的 `runAudit({ cwd, runner, fixtureFile })`：
 * 注入只是让分支可测，出厂行为不变（§12.18，不再发明第二套）。
 *
 * @param {{staged?: string[], root?: string, cargoRunner?: () => number | null, mode?: "staged" | "base"}} [options]
 *   `mode` = `"staged"`（默认，本地那一跳）/ `"base"`（平台侧以 PR diff 为判决面）。
 * @returns {{ exitCode: number, steps: GateStep[] }}
 */
export function runGate({
  staged,
  root = ROOT,
  cargoRunner = runCargoTest,
  mode = "staged",
} = {}) {
  const { touchesShell, needsCargoTest } = decide(staged ?? []);
  if (!touchesShell) {
    // 没碰壳就什么都不做（这一步不该给普通前端提交加一毫秒）。
    return { exitCode: 0, steps: [] };
  }

  /** @type {GateStep[]} */
  const steps = [];
  if (needsCargoTest) {
    const code = cargoRunner();
    if (code === null) {
      steps.push({ kind: "cargo", state: "missing" });
      /* `--base` 形态（平台侧）：这台机器上没有 cargo ⇒ **这一格没跑起来**（2），
       * 不是「判据判出失败」（1）—— 判据在场、执行者不在，这两件事必须分开说
       * （§13.5.25 的三态口径）。本地形态保持退 1：那边确实该拦住提交。 */
      return { exitCode: mode === "base" ? 2 : 1, steps };
    }
    if (code !== 0) {
      steps.push({ kind: "cargo", state: "failed", code });
      // 顺序也是判据：编不过就不再往下判时效 —— 时效消息会把真因（Rust 侧编译/单测坏了）
      // 挤成第二行，而这两笔钱也不该一起花。
      return { exitCode: code, steps };
    }
    steps.push({ kind: "cargo", state: "ok" });
  } else {
    steps.push({ kind: "cargo", state: "skipped" });
  }

  /* `--base` 形态：判据比的是「编出来的 exe 比源码旧」，而平台检出里**没有**编出来的
   * 壳（exe 不入库）⇒ 没有可比的对象。硬判的结果是「这个 PR 只要碰了壳就必红」，
   * 而那条红与代码无关 ⇒ 不判，并把「为什么不判」说出来。 */
  if (mode === "base" && !defaultShellExe(root)) {
    steps.push({ kind: "freshness", state: "skipped" });
    return { exitCode: 0, steps };
  }

  const problem = freshnessProblem(root);
  if (problem) {
    steps.push({ kind: "freshness", state: "blocked", problem });
    return { exitCode: 1, steps };
  }
  steps.push({ kind: "freshness", state: "ok" });
  return { exitCode: 0, steps };
}

/**
 * 把 `runGate` 的走格打成人类可读的行（打印只在 `main`，判决不在这里）。
 *
 * @param {{ exitCode: number, steps: GateStep[] }} result
 * @returns {{ to: "out" | "err", text: string }[]}
 */
function linesFor(result, mode = "staged") {
  /** @type {{ to: "out" | "err", text: string }[]} */
  const out = [];
  for (const step of result.steps) {
    if (step.kind === "cargo") {
      if (step.state === "missing") {
        out.push({
          to: "err",
          text:
            "[shell-gate] 找不到 cargo（PATH 与 rustup 的默认安装位都没有）—— 改了 Rust 壳却编不了，等于没验证。\n" +
            "        装 Rust 工具链：https://rustup.rs/（或换一台能编壳的机器提交）\n" +
            "        已装却仍探不到时：PATH 里加上 $CARGO_HOME/bin（rustup 默认 <home>/.cargo/bin）" +
            (mode === "base"
              ? "\n        这一格按「没跑起来」收（退 2）—— 判据在场、执行者不在，不是「判出失败」。"
              : ""),
        });
      } else if (step.state === "failed") {
        out.push({
          to: "err",
          text: `[shell-gate] ✗ cargo test 失败（退出码 ${step.code}）—— 它是壳侧 #[test] 唯一的执行者，先修再提`,
        });
      } else if (step.state === "ok") {
        out.push({ to: "out", text: "  [ok] cargo test" });
      } else {
        out.push({
          to: "out",
          text: "  · 跳过 cargo test（只改了 conf / build.rs / 启动页，Rust 源码没动）",
        });
      }
      continue;
    }
    if (step.state === "skipped") {
      out.push({
        to: "out",
        text:
          "  · 壳时效不判（检出里没有编出来的壳可比 —— 平台侧不编壳，exe 不入库；" +
          "「改了壳必须重编」的对象是本地那个 exe）",
      });
      continue;
    }
    if (step.state === "blocked") {
      out.push({ to: "err", text: `[shell-gate] ✗ ${step.problem}` });
    } else {
      out.push({
        to: "out",
        text: "  [ok] 壳二进制时效（复用 dev-launcher 的 shellStaleWarning 判据）",
      });
    }
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const stagedIdx = argv.indexOf("--staged");
  const baseIdx = argv.indexOf("--base");

  /** @type {string[]} */
  let staged;
  /** @type {"staged" | "base"} */
  let mode = "staged";
  let via = "";

  if (baseIdx >= 0) {
    /* `--base <ref>`：判决面 = 「相对那条基线改了什么」（平台侧那一档）。 */
    mode = "base";
    const baseRef = (argv[baseIdx + 1] ?? "").trim();
    if (!baseRef) {
      console.error(
        "[shell-gate] `--base` 要一条基线（用法：`--base <ref>`）—— 拿不到基线就没有判决面，" +
          "这一格按「没跑起来」收（退 2）。",
      );
      return 2;
    }
    const got = changedFilesForBaseRef(baseRef);
    if (!got.ok) {
      console.error(
        `[shell-gate] ${got.reason} —— 这一格按「没跑起来」收（退 2）。`,
      );
      return 2;
    }
    /* 改名的两侧都进面：旧路径上的壳文件被搬走了，也算「这次改了壳」。 */
    staged = [...got.files, ...got.renamedFrom];
    via = `基线 ${baseRef}`;
  } else if (stagedIdx >= 0) {
    // 显式清单（`--staged a b c`）是调试 / 覆写通道，调用方说了算，不过采纳过滤；
    // 只有从暂存区自动推导时，才剔除「原样采纳对方那侧」的壳文件
    // （见 dropAdoptedShellInputs）—— 否则纯前端 PR 只要拉了 master 就被永久拦住。
    staged = argv.slice(stagedIdx + 1);
  } else {
    staged = dropAdoptedShellInputs(stagedFiles());
  }

  const { touchesShell, needsCargoTest } = decide(staged);
  if (!touchesShell) {
    /* 恒绿的那条不许「返回 0 且无输出」（ISSUE #2224 处置方向 3）：平台上这一步
     * 曾经恒绿且一个字都不打 —— 账面全绿，而「改了壳必须重编」与壳内那批
     * `#[test]` 在平台侧一个执行者都没有。 */
    console.log(
      `[shell-gate] 本次没有壳改动（清单 ${staged.length} 条，未命中 src-tauri 的四类壳输入）` +
        (mode === "base" ? `；改动面来自 ${via}` : "") +
        "。",
    );
    return 0;
  }

  console.log(
    mode === "base"
      ? `[shell-gate] PR 改动面命中 src-tauri 的四类壳输入（${via}），开始判：`
      : "[shell-gate] 暂存改动命中 src-tauri 的四类壳输入，开始判：",
  );
  if (needsCargoTest) {
    console.log("  · cargo test（src-tauri/src/** 有改动）");
  }
  const result = runGate({ staged, mode });
  for (const line of linesFor(result, mode)) {
    if (line.to === "err") console.error(line.text);
    else console.log(line.text);
  }
  return result.exitCode;
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
