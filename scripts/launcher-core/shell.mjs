#!/usr/bin/env node
// 子进程拉起（跨平台启动编排用）。
//
// 两条硬约束（AGENTS 硬规则 3、§3.1）：
//   1. POSIX 上必须**自建进程组**（`detached: true`）——否则子进程与编排器同组，
//      回收会命中「与调用者同组禁走组路径」的防自杀判据、退化成单杀 leader，
//      其下的 pnpm / next / turbopack worker 三层全部残留成孤儿。
//   2. 不经 shell 解释器（`shell: false`）：多一层 `cmd /C` / `sh -c` 就多一层
//      中转进程，也让「谁是组长」变得不确定。

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** `whichCommand` / `usableCommand` 共用的选项（`env` 与 `platform` 可注入，便于单测）。 */
/**
 * @typedef {{ env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *             platform?: NodeJS.Platform }} WhichCommandOptions
 */

/** 「这个候选能不能被 spawn」的结论。`prefixArgs` 是启动它所需的宿主参数
 *  （shebang shim 换成 PowerShell 时非空），`reason` 只在 `ok: false` 时有值。 */
/**
 * @typedef {{ ok: boolean, command: string, prefixArgs: string[], reason: string | null }} CommandUsability
 */

/** 是否是 Windows（与 src/lib/kill-process-tree.ts 同一判据）。 */
/**
 * @param {NodeJS.Platform} [platform]
 * @returns {boolean}
 */
export function isWindows(platform = process.platform) {
  return platform === "win32";
}

/**
 * 在 PATH 上解析可执行文件，返回可直接 spawn 的**绝对路径**。
 *
 * 为什么必须自己解析：Windows 上 Node 的 `spawn` 不认 PATHEXT —— `spawn("pnpm")`
 * 直接 ENOENT，必须给 `pnpm.cmd`（或它的绝对路径）；而 Linux 上给 `pnpm.cmd`
 * 又同样 ENOENT。写死平台后缀会在「一种平台能用、另一种静默失败」，因此按
 * PATH × PATHEXT 自己扫一遍。
 *
 * **但「扫到一个同名文件」不等于「能跑」**：Node 的 `spawnSync` 在 Windows 上
 * 不解析 shebang（libuv 直接 CreateProcess 传文件路径），所以 `pnpm`（corepack
 * 那只**无扩展名**的 shim，本质是 `#!/usr/bin/env node` 的脚本）被 spawn 时一律
 * EACCES/ENOEXEC —— 用不了。而 PATHEXT 的顺序又把 `.CMD` 排在最前，于是同一目录里
 * 「能跑的 `pnpm.ps1` / 能跑的 `pnpm`」会被**跳过**，选中的偏偏是跑不起来的那个
 * （`.CMD` 只有 cmd.exe 会解释它）。表现是 `pnpm -v` 探测失败、stderr/stdout 全空、
 * 启动器只报一句「未知错误」——看起来完全像 corepack 缓存损坏，实际是路径选错了。
 *
 * 因此判据分两层：① `executableExts()` 定**优先顺序**（真正有可执行形态的扩展名
 * 在前，`executableKind` 判不出形态的垫底）；② 取候选后做一次 `usableCommand()`
 * 确认（`fs.accessSync` + ENOEXEC 回退），**选第一个真的能跑的**。
 *
 * @param {string} name
 * @param {WhichCommandOptions} [options]
 * @returns {string | null}
 */
export function whichCommand(name, { env = process.env, platform = process.platform } = {}) {
  const dirs = String(env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = executableExts(env, platform);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (!isFile(candidate)) continue;
      const usable = usableCommand(candidate, undefined, { env, platform });
      if (usable.ok) return candidate;
      // 不可用的候选直接跳过：同目录里往往还并存别的形态（`pnpm` shim 与
      // `pnpm.ps1` / `pnpm.cmd` 是三个文件），继续往后找才有机会选中能跑的。
      // 全都不可用时返回 null（= 按「没找到」处理）—— 比返回一个注定失败、
      // 且会把真实原因掩盖成「未知错误」的路径更有用（Issue #576 的现场）。
    }
  }
  return null;
}

/**
 * 候选扩展名的**优先顺序**（不是一个集合，顺序即判据）。
 *
 * 顺序取自「Node 能不能直接起它」：
 *   · `""`（无扩展名，如 corepack 的 `pnpm` shim）与 `.EXE` —— 真正的可执行形态，
 *     Windows 上由 CreateProcess 直接起；
 *   · `.PS1` —— 必须经 `powershell -File` 起（由 `executableKind` 判出来，见下）；
 *   · `.CMD` / `.BAT` —— **Node 起不了**（它是给 cmd.exe 的批处理脚本），只能垫底：
 *     同一个目录里既有 `pnpm.cmd` 又有可用的 `pnpm` 时，选前者必然 EACCES；
 *   · PATHEXT 里其它扩展名（`.COM` / `.VBS` / 自定义）排最后，保持「用户配了就用」。
 *
 * POSIX 只有一种形态（无扩展名），此函数退化为 `[""]`。
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {NodeJS.Platform} platform
 * @returns {string[]}
 */
export function executableExts(env, platform = process.platform) {
  if (!isWindows(platform)) return [""];
  const declared = String(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
  /** 认形态的前缀（大小写不敏感，PATHEXT 常见写法是大写）。 */
  /** @param {string} ext */
  const declaredHas = (ext) => declared.some((d) => d.toUpperCase() === ext);
  const ordered = [];
  if (declaredHas(".EXE") || declared.length === 0) ordered.push("");
  for (const ext of [".EXE", ".PS1", ".CMD", ".BAT", ".COM"]) {
    if (declaredHas(ext)) ordered.push(ext);
  }
  for (const ext of declared) {
    const upper = ext.toUpperCase();
    if (!ordered.some((o) => o.toUpperCase() === upper)) ordered.push(ext);
  }
  return ordered;
}

/** 这个候选路径是不是普通文件（目录 / 不可 stat 的一律不算）。 */
/** @param {string} candidate @returns {boolean} */
function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * 候选的**执行形态**：决定「要不要先确认它能跑」「跑不起来时怎么回退」。
 *
 * 读文件头几个字节而不是看扩展名 —— Windows 上 `.CMD` 与 `pnpm`（shim）后缀
 * 不同但内容形态更要紧，而扩展名只是给 shell 看的。
 *   · `shebang` —— 以 `#!` 开头（corepack 的无扩展名 shim 就是）；**Node 起不了**
 *                 （libuv 不解析 shebang），`usableCommand()` 走同目录回退；
 *   · `batch`   —— 批处理（`@echo` / `@setlocal` 起头，`.cmd` / `.bat`）；
 *                 **Node 同样起不了**（只有 cmd.exe 会解释它），照旧走回退 ——
 *                 把两者混成 `script` 曾让 `.CMD` 被当成「可用」而选中，
 *                 真跑起来是 `EINVAL`（ISSUE #576 第二轮现场）；
 *   · `script`  —— 其余文本脚本（`.ps1` 等），由各自的宿主解释；
 *   · `binary`  —— 二进制（.exe / .com），CreateProcess 能直接起；
 *   · `unknown` —— 读不到或形态判不出，按可执行形态处理（交给 spawn 决定）。
 *
 * @param {string} candidate
 * @returns {"shebang" | "batch" | "script" | "binary" | "unknown"}
 */
export function executableKind(candidate) {
  let fd;
  try {
    fd = fs.openSync(candidate, "r");
  } catch {
    return "unknown";
  }
  try {
    // 批处理判据要看到 `@echo` / `@setlocal` 这一类开头，2 字节不够 —— 统一读 16。
    const head = Buffer.alloc(16);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    if (read < 2) return "unknown";
    const text = head.subarray(0, read).toString("latin1");
    if (text.startsWith("#!")) return "shebang";
    // 批处理：以 `@` 起头（`@echo off` / `@SETLOCAL`），或 `:label` / `echo off`。
    // 只认开头，不看扩展名 —— `.cmd` 只是命名习惯，内容才是判据。
    if (/^@?\s*(echo|setlocal)\b/i.test(text) || /^@/.test(text)) return "batch";
    // 可打印 ASCII 起头 → 文本脚本；其余按二进制（含 Windows 的 MZ 头）。
    return /^[\x09\x0a\x0d\x20-\x7e]{2}$/.test(text) ? "script" : "binary";
  } catch {
    return "unknown";
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 这个候选**现在能不能被 spawn 起来**。
 *
 * 判据按**形态**分派（不是「一层层试」），任一路失败即落到同目录回退：
 *   1. `fs.accessSync(X_OK)` —— 权限位。POSIX 上这层就能拦下「文件在但不可执行」；
 *      Windows 上 Node 把 X_OK 当存在性检查（恒通过），所以形态判据才是主力。
 *   2. **Windows 上的批处理**（`.cmd` / `.bat`）不真起：它只有 cmd.exe 会解释，
 *      Node 起它必然 `EINVAL`。此前它与 `.ps1` 混成同一种 `script` 形态、被直接
 *      认作「可用」，于是选中 `pnpm.CMD`（ISSUE #576 第二轮现场）—— 而 `pnpm.ps1`
 *      就在旁边，回退目标稳定可得。POSIX 上 `.cmd` 是无谓形态，不受此条约束。
 *   3. **其余形态真起一次确认**（`binary` / `shebang` / `script` / `unknown`）：
 *      这是唯一能证明「Node 真能起它」的办法（`spawnSync` + `stdio: "ignore"`，
 *      `--version` 报错退出也算起得来），起不来再落回同目录 `.ps1`。
 *      shebang 留在这里而**不按形态一刀切**：libuv 在 Windows 上不解析 shebang，
 *      起不来会走回退；但机器上真配好了文件关联时它确实能用，不该被形态否掉。
 *
 * 探测用的参数取自**调用方真正要跑的第一个参数**（`whichCommand(..., { probeArgs })`）。
 *
 * @param {string} candidate @param {string[]} [probeArgs]
 * @param {WhichCommandOptions} [options] env / platform 可注入，供单测与「模拟另一平台」
 * @returns {CommandUsability}
 */
export function usableCommand(candidate, probeArgs = ["--version"], { env = process.env, platform = process.platform } = {}) {
  const kind = executableKind(candidate);
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
  } catch {
    return { ok: false, command: candidate, prefixArgs: [], reason: "no-exec-permission" };
  }
  // **批处理（`.cmd` / `.bat`）在 Windows 上不由「真起一次」来判**：它只有 cmd.exe
  // 会解释，Node 起它必然失败（实测 `EINVAL`）。此前把它与 `.ps1` 混成同一种
  // `script` 形态、直接认作「可用」，于是选中 `pnpm.CMD` → 探测 EINVAL、
  // 提示却说「未发现可回退形态」—— 而 `pnpm.ps1` 就摆在旁边（ISSUE #576 第二轮）。
  // shebang 不在此列：Node 在 Windows 上确实起不了它（libuv 不解析 shebang），
  // 但**留着「真起一次」去发现**，机器上真配了文件关联时还能用；起不来自然会落到
  // 下面的回退。POSIX 上两者都不是问题（内核解析 shebang，`.cmd` 本就是无谓形态）。
  if (isWindows(platform) && kind === "batch") {
    const fallback = siblingFallback(candidate, { env, platform });
    if (fallback) return fallback;
    return { ok: false, command: candidate, prefixArgs: [], reason: "batch-script" };
  }
  const probe = spawnSync(candidate, probeArgs, { stdio: "ignore", windowsHide: true, timeout: 10_000 });
  /** `spawnSync` 的 error 是 Error 的运行时子类（`code` 由 libuv 填）。 */
  const code = /** @type {NodeJS.ErrnoException | undefined} */ (probe.error)?.code;
  if (!code) return { ok: true, command: candidate, prefixArgs: [], reason: null };

  const fallback = siblingFallback(candidate, { env, platform });
  if (fallback) return fallback;
  return { ok: false, command: candidate, prefixArgs: [], reason: String(code) };
}

/** 同目录回退形态：**同名的 `.ps1`**（经 PowerShell 宿主）。
 *
 *  为什么对所有「Node 起不来」的形态共用一条回退：corepack 的三种形态是
 *  `.ps1` + `.cmd` + 无扩展名 shim 并排摆放（`.tools\pnpm\<ver>\bin` 亦然），
 *  能被 Node 起的只有经宿主的那一种。此前只有 shebang 分支会来这儿，
 *  `pnpm.CMD` 被认成「可用」后真跑起来是 EINVAL，用户在提示里只看到
 *  「未发现可回退形态」—— 其实回退就在旁边。
 *
 *  **同胞名按「去掉自身扩展名再拼 `.ps1`」求**：无扩展名的 shim 是 `pnpm` →
 *  `pnpm.ps1`，批处理是 `pnpm.CMD` → `pnpm.ps1`（不是 `pnpm.CMD.ps1`）。
 *  只按字符串拼接会让 `.CMD` 一侧的回退永远找不到，等于没修。 */
/** @param {string} candidate @param {WhichCommandOptions} [options] @returns {CommandUsability | null} */
function siblingFallback(candidate, { env = process.env, platform = process.platform } = {}) {
  const ext = path.extname(candidate);
  const script = (ext ? candidate.slice(0, -ext.length) : candidate) + ".ps1";
  if (!isFile(script)) return null;
  const host = powershellHost({ env, platform });
  if (!host) return null;
  return {
    ok: true,
    command: host,
    prefixArgs: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    reason: null,
  };
}

/** `pnpm.ps1` 这类包装脚本的宿主（优先 pwsh 7，回退 Windows PowerShell）。 */
/**
 * @param {WhichCommandOptions} [options]
 * @returns {string | null}
 */
export function powershellHost({ env = process.env, platform = process.platform } = {}) {
  if (!isWindows(platform)) return null;
  for (const name of ["pwsh", "powershell"]) {
    const exts = executableExts(env, platform).map((ext) => ext || ".EXE");
    for (const dir of String(env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext);
        if (isFile(candidate) && executableKind(candidate) === "binary") return candidate;
      }
    }
  }
  return null;
}

/** 当前脚本要跑的命令形态（`command` / `prefixArgs`）——POSIX 上恒为原路径。 */
/**
 * @param {string} candidate @param {string[]} [probeArgs]
 * @param {WhichCommandOptions} [options] env / platform 可注入，供单测与「模拟另一平台」
 * @returns {{ command: string, prefixArgs: string[] }}
 */
export function commandInvocation(candidate, probeArgs = ["--version"], { env = process.env, platform = process.platform } = {}) {
  const usable = usableCommand(candidate, probeArgs, { env, platform });
  return usable.ok
    ? { command: usable.command, prefixArgs: usable.prefixArgs }
    : { command: candidate, prefixArgs: [] };
}

/**
 * 起一个子进程并**单独建进程组**（POSIX）。
 *
 * @param {{ command: string, args?: string[], cwd?: string, env?: NodeJS.ProcessEnv,
 *           stdoutFile?: string, stderrFile?: string, platform?: NodeJS.Platform }} spec
 * @returns {import("node:child_process").ChildProcess}
 */
export function spawnInGroup({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  stdoutFile,
  stderrFile,
  platform = process.platform,
}) {
  /** @type {import("node:child_process").StdioOptions} */
  let stdio = "inherit";
  if (stdoutFile && stderrFile) {
    const outFd = fs.openSync(stdoutFile, "a");
    const errFd = fs.openSync(stderrFile, "a");
    stdio = ["ignore", outFd, errFd];
    const child = spawn(command, args, {
      cwd,
      env,
      stdio,
      // POSIX：自建进程组（setsid 语义），收尾可整组回收；
      // Windows：detached 会另开控制台窗口且无组语义，回收走 taskkill /T。
      detached: !isWindows(platform),
      windowsHide: true,
      shell: false,
    });
    // 父进程这一侧的文件描述符副本已交给子进程，立刻关掉，
    // 否则「启动器退出后日志文件仍被锁」会伪装成「文件被占用」。
    fs.closeSync(outFd);
    fs.closeSync(errFd);
    return child;
  }
  return spawn(command, args, {
    cwd,
    env,
    stdio,
    detached: !isWindows(platform),
    windowsHide: true,
    shell: false,
  });
}

/**
 * 同步跑一个命令（`shell: false`，参数按字面量传递，不做引号解析）。
 *
 * @param {string} command @param {string[]} [args]
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, stdio?: "pipe"|"inherit"|"ignore" }} [options]
 * @returns {{ ok: boolean, stdout: string, stderr: string, status: number | null }}
 */
export function runSync(command, args = [], { cwd, env, timeoutMs = 600_000, stdio = "pipe" } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    shell: false,
    stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : stdio,
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    status: result.status ?? null,
  };
}
