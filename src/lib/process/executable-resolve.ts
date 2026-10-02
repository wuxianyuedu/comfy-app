// ── 「这个命令在这台机器上怎么起」的唯一判据（Node 侧，纯函数 + 进程探测）──────
//
// 症状驱动：`spawn("pnpm")` 在 Windows 上必然 `ENOENT` —— Node 的 `spawn` 不认
// PATHEXT，PATH 上那三个形态（无扩展名 shim / `pnpm.cmd` / `pnpm.ps1`）里没一个是
// 它认识的裸名字；而写死 `pnpm.cmd` 在 POSIX 上又同样 ENOENT。更进一步，
// 「扫到一个同名文件」也不等于「起得来」：corepack 的无扩展名 shim 是
// `#!/usr/bin/env node` 脚本，`.cmd` 只有 cmd.exe 会解释 —— 选中它们真跑起来是
// `EACCES` / `EINVAL`，而调用方看到的只是「命令没起来」（ISSUE #576）。
//
// 所以本模块回答一组问题，且**只有这一处**回答：
//   · 候选扩展名的优先顺序（`executableExts`）
//   · 一个候选是什么形态（`executableKind`）
//   · 它现在能不能被 spawn 起来（`usableCommand`，含同目录 `.ps1` 回退）
//   · PATH 上哪个候选真的能跑（`whichCommand`）
//   · 「命令 + 宿主参数」的最终形态（`commandInvocation` / `pnpmInvocation`）
//
// ## 为什么它住在 `src/lib/process/`
//
// 它的消费方横跨两个世界：启动编排（`scripts/launcher-core/shell.mjs`，纯 Node）
// 与应用内控制台（`src/lib/console/console-run.ts`，Next 路由下的子进程拉起）。
// 此前只有启动编排有这份判据，控制台直接 `spawn(file)` —— 于是同一个坑在应用内
// 再踩一次（ISSUE #1327 现场：面板里 `pnpm exec tsc --noEmit` 回
// 「无法启动命令：spawn pnpm ENOENT」）。把判据下沉到 `src/lib` 之后两边
// `import` 同一份实现（硬规则 24：复用在先，不造第二轮子）。
//
// §18.4 三选一：本模块走第三类（**纯 Node 宿主**），登记在
// `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。
// 加 `server-only` 会让启动编排直接崩（它的入口就是一句 `throw`），而它又必须能被
// 单测直接喂真实文件与真实进程（起一个候选真确认它跑不跑得起来），不适合
// `.server.ts`。同目录同族的 `kill-process-tree.ts` / `process-launch.ts` 就是
// 这形态的原型。
//
// ## 为什么 `.mjs` 能 import 本文件
//
// Node 24（本项目 `.nvmrc` 钉死的版本）**默认开启 TypeScript 类型擦除**，
// `scripts/launcher-core/shell.mjs` 因此可以静态 `import` 本文件 —— 不需要 `tsx`、
// 不需要构建步骤。这是本模块能同时服务两个世界的机械前提；`shell.mjs` 里那条
// import 上写着它，改 Node 版本时先看那里。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** `whichCommand` / `usableCommand` 共用的选项（`env` 与 `platform` 可注入，便于单测）。 */
export interface WhichCommandOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

/** 「这个候选能不能被 spawn」的结论。`prefixArgs` 是启动它所需的宿主参数
 *  （shim 换成 PowerShell 时非空），`reason` 只在 `ok: false` 时有值。 */
export interface CommandUsability {
  ok: boolean;
  command: string;
  prefixArgs: string[];
  reason: string | null;
}

/** 是否是 Windows（与 `src/lib/process/kill-process-tree.ts` 同一判据）。 */
export function isWindows(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32";
}

/* 探测结果的进程内记忆化。
 *
 * 一份启动编排会对同一个名字调 4~6 次 `whichCommand`（probePnpm × 2、
 * spawnDevServer、concludeDownstreamExit…），每次都完整扫 PATH × PATHEXT
 * 并对候选**真起一次进程**（10s 超时）—— Windows 上 pnpm 三种形态同目录并存时，
 * 一次冷探测就是数秒，纯属重复劳动。
 *
 * 键 = name + PATH + PATHEXT + platform：任一不同即不同条目（单测注入的
 * env / platform 互不串扰）。单次启动内 PATH 与文件布局不会变，缓存恒有效；
 * **测试里同一个 tmp 路径可能被覆写重造**（如 toolchain-gate 的
 * `makeWindowsPnpmDir`），那类场景先调 `clearWhichCommandCache()`。 */
const whichCache = new Map<string, string | null>();

/** 丢掉 `whichCommand` 的记忆：PATH 上的文件在本进程存活期间被重建 / 覆写
 *  的场景（测试、装完依赖再探测）需要显式调用。 */
export function clearWhichCommandCache(): void {
  whichCache.clear();
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
 */
export function whichCommand(
  name: string,
  { env = process.env, platform = process.platform }: WhichCommandOptions = {},
): string | null {
  const key = `${name} ${env.PATH ?? ""} ${env.PATHEXT ?? ""} ${platform}`;
  const hit = whichCache.get(key);
  if (hit !== undefined) return hit;
  const dirs = String(env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const exts = executableExts(env, platform);
  let result: string | null = null;
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (!isFile(candidate)) continue;
      const usable = usableCommand(candidate, undefined, { env, platform });
      if (usable.ok) {
        result = candidate;
        break;
      }
      // 不可用的候选直接跳过：同目录里往往还并存别的形态（`pnpm` shim 与
      // `pnpm.ps1` / `pnpm.cmd` 是三个文件），继续往后找才有机会选中能跑的。
      // 全都不可用时返回 null（= 按「没找到」处理）—— 比返回一个注定失败、
      // 且会把真实原因掩盖成「未知错误」的路径更有用（Issue #576 的现场）。
    }
    if (result) break;
  }
  whichCache.set(key, result);
  return result;
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
 */
export function executableExts(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (!isWindows(platform)) return [""];
  const declared = String(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
  /** 认形态的前缀（大小写不敏感，PATHEXT 常见写法是大写）。 */
  const declaredHas = (ext: string) =>
    declared.some((d) => d.toUpperCase() === ext);
  const ordered: string[] = [];
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
function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** 候选的**执行形态**：决定「要不要先确认它能跑」「跑不起来时怎么回退」。 */
export type ExecutableKind =
  "shebang" | "batch" | "script" | "binary" | "unknown";

/**
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
 */
export function executableKind(candidate: string): ExecutableKind {
  let fd: number | undefined;
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
    if (/^@?\s*(echo|setlocal)\b/i.test(text) || text.startsWith("@")) {
      return "batch";
    }
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
 */
export function usableCommand(
  candidate: string,
  probeArgs: string[] = ["--version"],
  { env = process.env, platform = process.platform }: WhichCommandOptions = {},
): CommandUsability {
  const kind = executableKind(candidate);
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
  } catch {
    return {
      ok: false,
      command: candidate,
      prefixArgs: [],
      reason: "no-exec-permission",
    };
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
    return {
      ok: false,
      command: candidate,
      prefixArgs: [],
      reason: "batch-script",
    };
  }
  const probe = spawnSync(candidate, probeArgs, {
    stdio: "ignore",
    windowsHide: true,
    timeout: 10_000,
  });
  /** `spawnSync` 的 error 是 Error 的运行时子类（`code` 由 libuv 填）。 */
  const code = (probe.error as NodeJS.ErrnoException | null | undefined)?.code;
  if (!code) {
    return { ok: true, command: candidate, prefixArgs: [], reason: null };
  }

  const fallback = siblingFallback(candidate, { env, platform });
  if (fallback) return fallback;
  return {
    ok: false,
    command: candidate,
    prefixArgs: [],
    reason: String(code),
  };
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
function siblingFallback(
  candidate: string,
  { env = process.env, platform = process.platform }: WhichCommandOptions = {},
): CommandUsability | null {
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
export function powershellHost({
  env = process.env,
  platform = process.platform,
}: WhichCommandOptions = {}): string | null {
  if (!isWindows(platform)) return null;
  for (const name of ["pwsh", "powershell"]) {
    const exts = executableExts(env, platform).map((ext) => ext || ".EXE");
    for (const dir of String(env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext);
        if (isFile(candidate) && executableKind(candidate) === "binary") {
          return candidate;
        }
      }
    }
  }
  return null;
}

/** 当前脚本要跑的命令形态（`command` / `prefixArgs`）——POSIX 上恒为原路径。 */
export function commandInvocation(
  candidate: string,
  probeArgs: string[] = ["--version"],
  { env = process.env, platform = process.platform }: WhichCommandOptions = {},
): { command: string; prefixArgs: string[] } {
  const usable = usableCommand(candidate, probeArgs, { env, platform });
  return usable.ok
    ? { command: usable.command, prefixArgs: usable.prefixArgs }
    : { command: candidate, prefixArgs: [] };
}

/** `pnpmInvocation()` 的结论。 */
export interface PnpmInvocation {
  /** 真正要 spawn 的可执行文件（可能是 PowerShell 宿主）。 */
  command: string;
  /** 完整参数（宿主参数在前）。 */
  args: string[];
  /** PATH 上选中的候选（`.ps1` 回退时是那个脚本，不是宿主）。 */
  candidate: string;
  /** 是否经宿主（PowerShell）起 —— 排障时「为什么多了一层」的答案。 */
  viaHost: boolean;
}

/** 把 `pnpm <args…>` 解析成「这台机器上真能跑起来」的命令形态。
 *
 * 存在的理由：**任何**由 Node 去 spawn pnpm 的地方都在重复同一个坑 —— 在
 * Windows 上写死 `pnpm.cmd`（或让 PATHEXT 去挑）会选中 Node 起不来的形态
 * （批处理只有 cmd.exe 解释，实测 `EINVAL`），于是子进程「命令没起来」：
 * `spawnSync` 的 `status` 是 `null`，而 `process.exit(status ?? 0)` 把它读成
 * **成功退出（0）** —— 表现为「dev server 已启动」之后两秒静默退出、stdout
 * 只有一行包装脚本的打印、stderr 全空，用户完全看不出哪里不对（ISSUE #576）。
 *
 * 判据只在 `whichCommand()` + `commandInvocation()` 一处（规范 §9.5 / §2.1.1）：
 * 选中能跑的候选，需要宿主时（`.ps1` → PowerShell）连宿主参数一起给出来。
 *
 * 返回 `null` = PATH 上没有任何可用的 pnpm 形态（调用方必须给出可见出口，
 * 不能静默 `null → 0`）。
 */
export function pnpmInvocation(
  args: string[] = [],
  {
    env = process.env,
    platform = process.platform,
    name = "pnpm",
  }: WhichCommandOptions & { name?: string } = {},
): PnpmInvocation | null {
  const candidate = whichCommand(name, { env, platform });
  if (!candidate) return null;
  const usable = usableCommand(candidate, ["-v"], { env, platform });
  const invocation = usable.ok
    ? { command: usable.command, prefixArgs: usable.prefixArgs }
    : { command: candidate, prefixArgs: [] };
  return {
    command: invocation.command,
    args: [...invocation.prefixArgs, ...args],
    candidate,
    viaHost: invocation.command !== candidate,
  };
}

/** `resolveCommandInvocation()` 的结论。 */
export interface ResolvedInvocation {
  /** 真正要 spawn 的可执行文件（可能是绝对路径或 PowerShell 宿主）。 */
  command: string;
  /** 完整参数（宿主参数在前）。 */
  args: string[];
  /** 是否在 PATH 上找到了这个命令（`false` = 交回原样，让 spawn 报它那一句错）。 */
  resolved: boolean;
}

/**
 * 把一行「用户想跑的命令」解析成这台机器上真能起得来的形态。
 *
 * 与控制台的关系：控制台的输入框只做「空格 + 引号」的分词（`parseConsoleLine`），
 * 分词之后拿到的 `file` 是**用户写的名字**（`pnpm` / `git` / `node`），
 * 而这个名字在 Windows 上多半不是一个能直接 `spawn` 的路径 —— 直接交给
 * `spawn` 就是那条 `spawn pnpm ENOENT`（ISSUE #1327 的现场）。所以起进程前
 * 必须过这里一次。
 *
 * `resolved: false` 表示「PATH 上查无此命令」——**不改写 `command`**，调用方
 * 据此给出可读出口（说清「找不到这个命令」与去过 PATH 找过），而不是把一个
 * 裸名字丢给 spawn、拿回一句信息量很低的 ENOENT。
 */
export function resolveCommandInvocation(
  file: string,
  args: string[] = [],
  { env = process.env, platform = process.platform }: WhichCommandOptions = {},
): ResolvedInvocation {
  const candidate = whichCommand(file, { env, platform });
  if (!candidate) return { command: file, args, resolved: false };
  const usable = usableCommand(candidate, args, { env, platform });
  // 可用即用宿主形态；不可用（如 `.cmd` 且无 `.ps1` 回退）仍把**绝对路径**
  // 交出去 —— 让 spawn 报一个带绝对路径的错，比报裸名字更有排障价值。
  return usable.ok
    ? {
        command: usable.command,
        args: [...usable.prefixArgs, ...args],
        resolved: true,
      }
    : { command: candidate, args, resolved: true };
}
