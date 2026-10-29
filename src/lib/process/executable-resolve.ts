// ── 「这个命令在这台机器上怎么起」的唯一判据（Node 侧，纯函数 + 进程探测）──────
//
// 症状驱动：`spawn("pnpm")` 在 Windows 上必然 `ENOENT`（Node 不认 PATHEXT，而 PATH 上
// 那三个形态没一个是它认识的裸名字），写死 `pnpm.cmd` 在 POSIX 上又同样 ENOENT；更进
// 一步，「扫到一个同名文件」也不等于「起得来」—— 无扩展名 shim 是 shebang、`.cmd` 只有
// cmd.exe 会解释，选中它们真跑起来是 `EACCES` / `EINVAL`（ISSUE #576）。
//
// 所以本模块回答一组问题，且**只有这一处**回答：
//   · 候选扩展名的优先顺序（`executableExts`）
//   · 一个候选是什么形态（`executableKind`）
//   · 它现在能不能被 spawn 起来（`usableCommand`，含同目录 `.ps1` 回退）
//   · PATH 上哪个候选真的能跑（`whichCommand`）
//   · pnpm 的包真身 JS 入口在哪（`pnpmJsEntry` / `pnpmJsInvocation`）
//   · 「命令 + 宿主参数」的最终形态（`commandInvocation` / `pnpmInvocation`）——那条 `.ps1` 回退答的是「起不起得来」，起**仓里装的** CLI 该问包真身入口（`scripts/package-bin-entry.mjs`，#2572）
//
// ## 为什么它住在 `src/lib/process/`
//
// 它的消费方横跨两个世界：启动编排（`scripts/launcher-core/shell.mjs`，纯 Node）
// 与应用内控制台（`src/lib/console/console-run.ts`，Next 路由下的子进程拉起）。
// 把判据下沉到 `src/lib` 之后两边 `import` 同一份实现（硬规则 24：复用在先）。
//
// §18.4 三选一：本模块走第三类（**纯 Node 宿主**），登记在
// `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。加 `server-only`
// 会让启动编排直接崩（它的入口就是一句 `throw`），而它又必须能被单测直接喂真实文件
// 与真实进程，不适合 `.server.ts`。同目录同族的 `kill-process-tree.ts` /
// `process-launch.ts` 就是这形态的原型。
//
// ## 为什么 `.mjs` 能 import 本文件（也为什么它必须留在**这一个文件**里）
//
// Node 24（本项目 `.nvmrc` 钉死的版本）**默认开启 TypeScript 类型擦除**，
// `scripts/launcher-core/shell.mjs` 因此可以静态 `import` 本文件 —— 不需要 `tsx`、
// 不需要构建步骤。代价是它被登记进 `tests/esm-cross-host-imports.test.ts` 那条
// **跨宿主链**，而那条链上的每个节点都必须是**叶子**：只 import 同批清单内的模块、
// 说明符带 `.ts`。所以本模块的依赖闭包只有 `platform.ts` 一个 —— 谁想再拆一块出去，
// 先回答「拆出去的那块要不要回 import `executableKind()`」（要，就成环或不是叶子）。

import { spawnSync } from "node:child_process";

import fs from "node:fs";
import path from "node:path";

import { isWindows } from "./platform.ts";

type SpawnSyncError = NodeJS.ErrnoException | null | undefined;
/** 「这个候选在这台机器上到底起不起得来」的那一次 OS 交互。 */
export interface UsabilityProbe {
  /** 执行位检查：抛错即「没有执行权限」（默认真 `fs.accessSync(X_OK)`）。 */
  access(candidate: string): void;
  /** 起一次确认：返回 libuv 给的错误码，`null` = 起得来（默认真 `spawnSync`）。 */
  spawn(candidate: string, args: string[]): string | null;
}

/** 探针这一次「起一次确认」的超时预算（毫秒）。
 *
 *  它不是一个性能参数，而是**判据会不会误报**的边界（见 `usableCommand` 里
 *  `ETIMEDOUT` 那一段）。取 30s 是「量级余量」：正常 `python --version` /
 *  `pnpm -v` 是几十毫秒，满载机器上也就几百毫秒；而撞上它的形态（节点被压死）
 *  本来也不该被读成「命令不存在」。 */
const USABILITY_PROBE_TIMEOUT_MS = 30_000;

/** 「这一次没量到」的错误码 —— 它们说的是**机器当时的状态**，不是「这个命令不在」。 */
const TRANSIENT_SPAWN_CODES: ReadonlySet<string> = new Set([
  /* 撞上探针自己的 `timeout`（`spawnSync` 的 `error.code`）。 */
  "ETIMEDOUT",
  /* 资源类：探针那一刻起不了新进程（句柄 / 线程 / 内存被占满）。
   * Windows 上还会以 `UNKNOWN` 的形态出现 —— libuv 认不出的错误码一律落到它。 */
  "EAGAIN",
  "EMFILE",
  "ENFILE",
  "ENOMEM",
  "EBUSY",
  "UNKNOWN",
]);

/** 这一次「起一次确认」的失败码算不算**结论**（ISSUE #1961）。
 *
 * 明确失败（`ENOENT` / `EACCES` / `EINVAL` / `ENOEXEC` / …）是结论：这个候选真不可用，
 * 该跳过。`TRANSIENT_SPAWN_CODES` 那些**不是** —— 那是机器当时起不来新进程，把它读成
 * 「这个命令不在」等于把「拿不到测量」当成「测量结果是它坏了」（§13.6.2）。
 *
 * 为什么两类都要按「没量到」办：实测那台自托管节点上 `E2E 关键流程` 是**0.6 秒**就报
 * null 的，10s 超时走不到 0.6s —— 那次不是超时，而是满载节点直接给的 `EAGAIN`/`UNKNOWN`。
 *
 * @param {string | null} code `spawnSync` 给的错误码（`null` = 起得来）
 * @returns {boolean} true = 这一次失败**不构成**「候选不可用」的结论
 */
function isTransientSpawnCode(code: string | null): boolean {
  return code === null || TRANSIENT_SPAWN_CODES.has(code);
}

/** 默认探针：问这台真机器。`error.code` 由 libuv 填，怎么读它是 `usableCommand` 的事。 */
const realUsabilityProbe: UsabilityProbe = {
  access: (candidate) => fs.accessSync(candidate, fs.constants.X_OK),
  spawn: (candidate, args) => {
    const probe = spawnSync(candidate, args, {
      stdio: "ignore",
      windowsHide: true,
      timeout: USABILITY_PROBE_TIMEOUT_MS,
    });
    const err = /* SAFETY: 类型断言已复核 */ probe.error as SpawnSyncError;
    return err?.code ?? null;
  },
};

/** `whichCommand` / `usableCommand` 共用的选项（`env`、`platform`、`probe` 可注入，便于单测）。 */
export interface WhichCommandOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /**
   * 「起得起吗」的探针，默认真权限位 + 真 `spawnSync`。
   *
   * 为什么要这个注入口（与 `kill-process-tree.ts` 的 `COMFYAPP_TASKKILL` 同一条口径）：
   * 本模块判的是**另一种平台**上的事（POSIX 的执行位、内核解析 shebang），
   * 而 Windows 开发机上这两样都造不出来 —— 实测：Windows 上 `fs.accessSync(X_OK)`
   * 对 0o755 / 0o644 / 0o444 / 0o000 **一律通过**（权限位不参与判断），
   * 而把一个真 `.exe` 改名成无扩展名再 spawn 得到的是 `ENOENT`（CreateProcess 不认）。
   * 于是「POSIX 上找到就用绝对路径」「没执行位要与起不来分开报」这几档在本地只有两个
   * 下场：整组 `runIf(!win32)`（= 这台机器上零执行者，台账 E7 记的形状），
   * 或者**为「它本来就不可能红」而通过**（更糟：绿灯是假的）。
   * 注入探针后这张表在两端机器上判同一个结论；Windows 那几档照旧走真探测
   * （批处理不起、`.ps1` 落宿主、MZ 头当二进制），因为那些在本机是真造得出来的。
   * ⚠️ `whichCommand` 的记忆化键**不含 probe**（只有 name + PATH + PATHEXT + platform）：
   *   同一个 PATH 上换探针又指望换结论，会读到上一条的缓存 —— 换探针的用例先 `clearWhichCommandCache()`。
   */
  probe?: UsabilityProbe;
  /**
   * `whichCommand` 在「真起一次确认」时喂给候选的参数（默认 `["--version"]`）。
   *
   * 为什么要有它：**同一个命令的可用判据不是统一的**。`python` 那类解释器要的是
   * 「能不能答 `--version`」，而 `py` 启动器裸着跑是「列出已装版本」并退非零 ——
   * 候选名一样、判据不一样。此前 `whichCommand` 把这一格写死成 `--version`，
   * 于是带宿主参数的候选（`py -3`）只能由调用方自己再包一层，或者干脆漏掉这一档
   * （ISSUE #1959 第二轮：门禁探的面与流水线自证探的面因此漂成两份）。
   * 记忆化键里**也不含它** —— 同一条 PATH 上「`py --version` 不成立、`py -3 --version`
   * 成立」会被读成同一条缓存，换 probeArgs 的用例请先 `clearWhichCommandCache()`。
   */
  probeArgs?: string[];
}

/** 「这个候选能不能被 spawn」的结论。`prefixArgs` 是启动它所需的宿主参数
 *  （shim 换成 PowerShell 时非空），`reason` 只在 `ok: false` 时有值。 */
export interface CommandUsability {
  ok: boolean;
  command: string;
  prefixArgs: string[];
  reason: string | null;
}

/* 是否是 Windows —— 定义搬到 `./platform.ts`，这里只 **re-export**（既有调用点不用动）。
 *
 * 为什么必须搬（ISSUE #1961）：`python-candidates.ts` 只需要这一个判断，却静态 import
 * 本文件；而 `.mjs` 静态 import 一份 `.ts` 时说明符**必须带 `.ts`**，于是同一条链上就
 * 出现了同一份文件被两种形态引用 —— 那在运行时是 `ERR_MODULE_NOT_FOUND`（实测 1 秒就退）。
 * 判据躲进一个**叶子模块**之后，两边都 import 它，那条链上再没有跨「扩展名惯例」的边
 * （见 `tests/esm-cross-host-imports.test.ts`）。 */
export { isWindows };

/* 探测结果的进程内记忆化：一份启动编排会对同一个名字调 4~6 次 `whichCommand`，
 * 每次都完整扫 PATH × PATHEXT 并对候选**真起一次进程** —— 纯属重复劳动。
 *
 * 键 = name + PATH + PATHEXT + platform：任一不同即不同条目（单测注入的 env / platform
 * 互不串扰）。**测试里同一个 tmp 路径可能被覆写重造**，那类场景先调
 * `clearWhichCommandCache()`。 */
const whichCache = new Map<string, string | null>();

/** 丢掉 `whichCommand` 的记忆：PATH 上的文件在本进程存活期间被重建 / 覆写
 *  的场景（测试、装完依赖再探测）需要显式调用。 */
export function clearWhichCommandCache(): void {
  whichCache.clear();
}

/**
 * 读一个环境变量，**按平台的大小写语义**（Windows 上不敏感）。
 *
 * 为什么非要有这一层（ISSUE #1961）：Windows 上 `process.env` 是大小写不敏感的代理，
 * 而 `{ ...process.env }` 出来的是普通对象、键名按系统存的写法来（常写成 `Path`）。于是
 * 同一份环境「直接读」与「复制一份再读」得到不同答案：`resolvePython()` 读代理拿得到，
 * 而 `checkPythonReady({ env: { ...process.env } })` 传下来的是复制品 ⇒ `env.PATH` 是
 * `undefined` ⇒ 扫一个**空 PATH** ⇒ 判「这台机没有 Python」。现场：同一个 stage 里
 * `Python 探针读数` 报 `ok python → …python.exe`，而 `E2E 关键流程` 报「PATH 上没有可用的
 * Python」。POSIX 上环境变量大小写敏感，所以那一边只认精确写法（行为零改动）。
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} name 变量名（大写形式）
 * @returns {string | undefined}
 */
export function envVar(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const exact = env[name];
  if (exact !== undefined) return exact;
  /* 大小写不敏感**只按目标平台**（与 `executableExts()` 同口径）：判据在 POSIX 上
   * 判 win32 形态时也要复现这一格，所以不能读宿主的 `process.platform`。 */
  if (!isWindows(platform)) return undefined;
  const wanted = name.toUpperCase();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === wanted) return env[key];
  }
  return undefined;
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
  {
    env = process.env,
    platform = process.platform,
    probe = realUsabilityProbe,
    probeArgs = ["--version"],
  }: WhichCommandOptions = {},
): string | null {
  const pathValue = envVar(env, "PATH", platform) ?? "";
  const pathextValue = envVar(env, "PATHEXT", platform);
  const key = `${name} ${pathValue} ${pathextValue ?? ""} ${platform}`;
  const hit = whichCache.get(key);
  if (hit !== undefined) return hit;
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  const exts = executableExts(env, platform);
  let result: string | null = null;
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (!isFile(candidate)) continue;
      const usable = usableCommand(candidate, probeArgs, {
        env,
        platform,
        probe,
      });
      if (usable.ok) {
        result = onDiskName(dir, name + ext, candidate, platform);
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
 * ## `.PS1` 是**无条件**候选，不看 `PATHEXT`（ISSUE #1961）
 *
 * `.PS1` 此前与 `.CMD` / `.BAT` / `.COM` 一样要 `PATHEXT` 声明才进得来 —— 而 Windows 的
 * 默认 `PATHEXT` **从不含 `.PS1`**。于是 corepack 那三个形态里唯一能被 Node 起得来的
 * 那个（经宿主）永远选不出来：`whichCommand()` 返回 `null` ⇒ 上层报「PATH 上没有任何可用
 * 的 pnpm 形态」，而能跑的就摆在旁边（实测：自托管 Windows 节点，流水线第 1 秒就停）。
 *
 * 判据因此改成：**`.PS1` 与无扩展名 shim 一样是本仓自己要找的形态，不由 PATHEXT 决定**。
 * `PATHEXT` 描述的是「cmd.exe 敲名字会试哪些后缀」，而这里问的是「Node 能起得来哪些形态」。
 * POSIX 只有一种形态（无扩展名），此函数退化为 `[""]`。
 */
export function executableExts(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (!isWindows(platform)) return [""];
  const declared = String(
    envVar(env, "PATHEXT", platform) ?? ".COM;.EXE;.BAT;.CMD",
  )
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
  /** 认形态的前缀（大小写不敏感，PATHEXT 常见写法是大写）。 */
  const declaredHas = (ext: string) =>
    declared.some((d) => d.toUpperCase() === ext);
  const ordered: string[] = [];
  if (declaredHas(".EXE") || declared.length === 0) ordered.push("");
  for (const ext of [".EXE", ".PS1", ".CMD", ".BAT", ".COM"]) {
    /* `.PS1` 不看 `PATHEXT`（理由见头注）：它是本仓唯一能被 Node 起的 corepack 形态，
     * 而默认 `PATHEXT` 从不声明它 —— 由它决定就是「能跑的那个永远选不出来」。 */
    if (ext === ".PS1" || declaredHas(ext)) ordered.push(ext);
  }
  for (const ext of declared) {
    const upper = ext.toUpperCase();
    if (!ordered.some((o) => o.toUpperCase() === upper)) ordered.push(ext);
  }
  return ordered;
}

/**
 * 把命中的候选改写成**磁盘上的实际大小写**（只在 Windows 上做）。
 *
 * 候选名是拿 `PATHEXT` 拼出来的，而系统那份默认写成大写，于是解析结果可能是 `node.EXE`。
 * spawn 对大小写无所谓，但这一份路径不只用来 spawn：控制台回显它、日志写它，而用户会拿
 * 它去比对与点开。NTFS 不敏感但**保留**原大小写，所以真实名字问目录要一次就够（只在命中
 * 后做一次，结果进 `whichCache`）。POSIX 的大小写是要紧的，原样返回。
 */
function onDiskName(
  dir: string,
  composed: string,
  candidate: string,
  platform: NodeJS.Platform,
): string {
  if (!isWindows(platform)) return candidate;
  const wanted = composed.toUpperCase();
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.toUpperCase() === wanted) return path.join(dir, entry);
    }
  } catch {
    /* 列不出目录（权限 / 竞态删除）就退回拼出来的那份：
     * 一个能跑的路径比一次大小写美化重要，这里不值得让整次解析失败。 */
    return candidate;
  }
  return candidate;
}

/** 这个候选路径是不是普通文件（目录 / 不可 stat 的一律不算）。 */
function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** 候选的执行形态 —— 决定「要不要先确认它能跑」「跑不起来时怎么回退」。 */
export type ExecutableKind =
  | "shebang"
  | "batch"
  | "script"
  | "binary"
  | "unknown";

/** 读文件头几个字节而不是看扩展名（扩展名只是给 shell 看的）：`shebang`（`#!` 开头）与
 *  `batch`（`@echo` / `@setlocal` 起头）**Node 都起不了** —— 把两者混成 `script` 曾让
 *  `.CMD` 被当成「可用」而选中，真跑是 `EINVAL`；`script` 是其余文本脚本（`.ps1` 等）、
 *  `binary` 是 .exe / .com、`unknown` 读不到或判不出（交给 spawn 决定）。 */
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
    // 量词是 `{2,}`（**至少**两个可打印字节）而不是 `{2}`：`text` 是最多 16 字节的
    // 文件头，写 `{2}` 就成了「长度恰好为 2 才算脚本」，于是每一份真脚本都被判成
    // `binary`（ISSUE #2563 —— 它一直没红，是因为此前没有调用点依赖 `script` 这一支）。
    return /^[\x09\x0a\x0d\x20-\x7e]{2,}$/.test(text) ? "script" : "binary";
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
  {
    env = process.env,
    platform = process.platform,
    probe = realUsabilityProbe,
  }: WhichCommandOptions = {},
): CommandUsability {
  const kind = executableKind(candidate);
  try {
    probe.access(candidate);
  } catch {
    return {
      ok: false,
      command: candidate,
      prefixArgs: [],
      reason: "no-exec-permission",
    };
  }
  // **`.ps1` 在 Windows 上必须交宿主起**（ISSUE #1961）：它与 `.cmd` 是同一类「Node
  // 自己起不来、要别人解释」的形态。此前它落在「真起一次」那一档 —— 而那一档在开发机上
  // 判不出来（POSIX 宿主把 `.ps1` 当普通文本文件，起它当然成功），于是交出的形态是
  // 「拿 .ps1 当可执行文件起」。修法与批处理同路：**不真起**，直接交出 `-File <那个 .ps1>`
  // 的完整形态 —— 只让它被找到、却给不出能 spawn 的形态，等于把缺陷从「找不到」挪成
  // 「找到了但起不来」。
  if (isWindows(platform) && isPs1(candidate)) {
    const host = powershellHost({ env, platform });
    if (host) {
      return {
        ok: true,
        command: host,
        prefixArgs: [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          candidate,
        ],
        reason: null,
      };
    }
    // 没有宿主就**不能**把这个 `.ps1` 当作可用 —— 它起不来。
    return {
      ok: false,
      command: candidate,
      prefixArgs: [],
      reason: "no-powershell-host",
    };
  }
  // **批处理在 Windows 上不由「真起一次」来判**：它只有 cmd.exe 会解释，Node 起它必然
  // `EINVAL`（ISSUE #576 第二轮：选中 `pnpm.CMD` 后提示「未发现可回退形态」，而
  // `pnpm.ps1` 就摆在旁边）。shebang 不在此列：留着「真起一次」去发现，机器上真配了
  // 文件关联时还能用。POSIX 上两者都不是问题。
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
  const code = probe.spawn(candidate, probeArgs);
  /* **「没量到」不等于「起不来」**（ISSUE #1961）：`TRANSIENT_SPAWN_CODES` 说的是机器
   * 当时的状态（满载节点起不了新进程），不是这个命令的属性。照「非空 code 即失败」读的话，
   * 一次资源失败就把这个候选跳过，候选全跳过 ⇒ `whichCommand()` 给 `null` ⇒ 上层读成
   * 「这个命令不存在」，于是人去装一个本就装好的东西（§13.6.2：拿不到测量 ≠ 结果是红的）。
   *
   * 判据放这里而不是默认探针里：探针只负责**取事实**（libuv 给了什么 code），
   * 「这个 code 算不算不可用」是判据，对所有探针（含单测注入的那些）一视同仁。 */
  if (isTransientSpawnCode(code)) {
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

/** 这个路径是不是一个 `.ps1`（大小写不敏感 —— Windows 上两者是同一个文件）。 */
function isPs1(candidate: string): boolean {
  return path.extname(candidate).toLowerCase() === ".ps1";
}

/** 同目录回退形态：**同名的 `.ps1`**（经 PowerShell 宿主）。corepack 的三种形态是
 *  `.ps1` + `.cmd` + 无扩展名 shim 并排摆放，能被 Node 起的只有经宿主的那一种。
 *
 *  同胞名按「去掉自身扩展名再拼 `.ps1`」求（`pnpm` → `pnpm.ps1`、`pnpm.CMD` →
 *  `pnpm.ps1`，不是 `pnpm.CMD.ps1`）：只按字符串拼接会让 `.CMD` 一侧的回退永远找不到。 */
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
    /* 与 `whichCommand` 同源：env 可能是 `{ ...process.env }` 的复制品，而 Windows
     * 的键常写成 `Path` —— 直接读 `env.PATH` 会扫一个空 PATH（ISSUE #1961）。 */
    for (const dir of String(envVar(env, "PATH", platform) ?? "")
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
  {
    env = process.env,
    platform = process.platform,
    probe = realUsabilityProbe,
  }: WhichCommandOptions = {},
): { command: string; prefixArgs: string[] } {
  const usable = usableCommand(candidate, probeArgs, { env, platform, probe });
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
  /** 这一跳是不是**经宿主（PowerShell）**起的 —— 排障时「为什么多了一层」的答案。
   *
   *  判据是「真正要 spawn 的那个可执行文件是不是宿主」，**不是**「它等不等于
   *  `candidate`」：走包真身 JS 入口时 `command` 是 `process.execPath`、`candidate`
   *  是落点目录，两者本来就不相等，而那条路上一个宿主也没有（ISSUE #2562）。 */
  viaHost: boolean;
  /** PATH 原文——**就是 `env` 里那一串**，不是本判据解析出来的那几段。 */
  pathRaw: string;
  /** 按**目标平台**分隔符切出来的 PATH 条目（空串已滤掉）。 */
  pathEntries: string[];
  /** 那些条目里 `pnpm<后缀>` 真的落在盘上的（只看「名字在不在」，`.ps1` 无条件在列）。 */
  onDisk: string[];
  /** 解释器宿主（PowerShell）的绝对路径；POSIX 上恒为 `null`。失败结论要能分清
   *  「没装 pnpm」与「宿主没找到」—— 那两句指向完全不同的下一步（ISSUE #2281）。 */
  osHost: string | null;
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
 * 返回 `null` = PATH 上没有任何可用的 pnpm 形态（调用方必须给出可见出口，
 * 不能静默 `null → 0`）。
 *
 * **形态的优先顺序是三段**（ISSUE #2562）：包真身 JS 入口 → 直接可执行 →
 * `.ps1` 经宿主。它们的代价差一个数量级 —— 前两段各一次进程启动，最后一段还要多付
 * 一次 PowerShell 冷启动（实测 0.6~3s，规范 §2.1.9）。所以 `pnpmJsEntry()` 排在
 * `whichCommand()` **之前**：能绕开垫片就直接绕开。这一格不是优化，而是形态判据的
 * 补全 —— 此前 corepack 目录上「包真身在、只有 `.ps1` 起得来」的现场被判成
 * 「只能走宿主」，一次启动里十来条 `pnpm …` 就付十来次 PowerShell。
 *
 * **非空时还要带三条 `PATH` 读数**（ISSUE #2281）：`pathRaw` / `pathEntries` /
 * `onDisk` 一次交出去，取证面因此不必再自己读一遍 `env` 并「按它以为的方式」
 * 重新解析 —— 而正是那第二份读法把「键名不是 `PATH`」「分隔符读错」两类成因藏起来的。
 */
export function pnpmInvocation(
  args: string[] = [],
  {
    env = process.env,
    platform = process.platform,
    name = "pnpm",
  }: WhichCommandOptions & { name?: string } = {},
): PnpmInvocation | null {
  /* ① 能直接跑包真身的 JS 入口时，连垫片都不起（ISSUE #2562）：`process.execPath` +
   * 入口，`shell: false` 恒定、不需要宿主 —— 每一条 `pnpm …` 少付一次 PowerShell
   * 冷启动（实测那一跳 0.6~3s，见规范 §2.1.9）。判据只有 `pnpmJsEntry()` 一处。 */
  const js = pnpmJsInvocation({ name, env, platform });
  const candidate = js?.candidate ?? whichCommand(name, { env, platform });
  if (!candidate) return null;
  const usable = js
    ? { ok: true, command: js.command, prefixArgs: js.prefixArgs, reason: null }
    : usableCommand(candidate, ["-v"], { env, platform });
  const invocation = usable.ok
    ? { command: usable.command, prefixArgs: usable.prefixArgs }
    : { command: candidate, prefixArgs: [] };
  const osHost = isWindows(platform) ? powershellHost({ env, platform }) : null;
  const pathRaw = String(envVar(env, "PATH", platform) ?? "");
  const pathEntries = pathRaw
    .split(isWindows(platform) ? ";" : ":")
    .filter(Boolean);
  const onDisk: string[] = [];
  /* `.ps1` **无条件**在列（与 `executableExts` 同口径）：Windows 默认 `PATHEXT` 从不含它，
   * 漏掉这一读数就会出现「一个都没命中」而旁边正躺着一个能用的 `pnpm.ps1`（ISSUE #2281）。 */
  for (const dir of pathEntries) {
    for (const ext of [...executableExts(env, platform), ".ps1"]) {
      const hit = path.join(dir, name + ext);
      if (isFile(hit) && !onDisk.includes(hit)) onDisk.push(hit);
    }
  }
  return {
    command: invocation.command,
    args: [...invocation.prefixArgs, ...args],
    candidate,
    /* `osHost` 非空**且**真正 spawn 的就是它，才算「经宿主」。用 `candidate` 比会
     * 把「跑 JS 入口」（command = node，candidate = 落点）误读成经宿主 —— 而 PS 参数
     * 切分那道防线（`runPnpmSync` 的 `hostUnsafeArgs`）正是按这个布尔值决定要不要拦。 */
    viaHost: Boolean(osHost) && invocation.command === osHost,
    pathRaw,
    pathEntries,
    onDisk,
    osHost,
  };
}

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
 * 控制台的输入框只做「空格 + 引号」分词（`parseConsoleLine`），拿到的 `file` 是**用户写的
 * 名字**（`pnpm` / `git` / `node`），而这个名字在 Windows 上多半不是一个能直接 `spawn` 的
 * 路径 —— 直接交给 `spawn` 就是那条 `spawn pnpm ENOENT`（ISSUE #1327）。所以起进程前必须
 * 过这里一次。`resolved: false` 表示「PATH 上查无此命令」——**不改写 `command`**，调用方
 * 据此给出可读出口，而不是把裸名字丢给 spawn、拿回一句信息量很低的 ENOENT。
 *
 * ## ⚠️ 探针**不拿 `args` 去起**（ISSUE #1977 第八轮）
 *
 * 上一层（`usableCommand` / `commandInvocation`）判「这个候选起不起得来」的方式是
 * **真起一次**，而它喂的参数就是这里的第二入参。于是「调用方要跑什么」与「探针喂什么」
 * 被合成了一件东西 —— 后果是**探针把真命令整条跑了一遍**：
 *
 *   · `resolveCommandInvocation("node", ["scripts/e2e-run.mjs", "--grep=@critical"])`
 *     ⇒ 探针真的起了一次 `node scripts/e2e-run.mjs --grep=@critical`（`stdio: "ignore"`、
 *     30s 上限），Playwright 的 webServer（`pnpm start` + 假 ComfyUI）随之被拉起来；
 *   · `spawnSync` 超时**只收直接子进程**，那些孙子进程留在端口上接着跑 —— 真那一跑
 *     再起来时撞见「端口已有人应答」，而这一步的结论被读成「解析成功」；
 *   · 更大的形态：`.cnb.yml` 里每一条 `node scripts/…` / `pnpm run build` 都在
 *     **被执行两遍**（一遍探针、一遍真跑），`pnpm install` 那一格尤其危险
 *     （探针把安装砍在半路，留下残缺的 `node_modules`）。
 *
 * 判据是**探针参数与调用参数解耦**：探针恒用一条**廉价、无副作用**的参数
 * （默认 `["--version"]`；`usableCommand` 只读 `error.code`，非零退出也算「起得来」，
 * 所以 `--version` 退非零的形态不会被误判）。第二入参因此在语义上只剩一件事 ——
 * **拼进最终命令行**，一个字节都不改写。
 *
 * 需要**带宿主参数**才能应答的候选（`py` 启动器那种：裸 `py --version` 是「列出
 * 已装版本」并退非零）走 `probeArgs` 显式给 —— 那是 `python-resolve.ts` 那条链的
 * 事，它直接调 `whichCommand()`，不经过本函数。
 */
export function resolveCommandInvocation(
  file: string,
  args: string[] = [],
  {
    env = process.env,
    platform = process.platform,
    probe = realUsabilityProbe,
    probeArgs = ["--version"],
  }: WhichCommandOptions = {},
): ResolvedInvocation {
  const candidate = whichCommand(file, { env, platform, probe, probeArgs });
  if (!candidate) return { command: file, args, resolved: false };
  const usable = usableCommand(candidate, probeArgs, { env, platform, probe });
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
/** 「这个落点上 pnpm 的**包真身 JS 入口**在哪」（ISSUE #2562）；没有就给 `null`。
 *
 * 落点两种形状都接：`<落点>/node_modules/pnpm/` 与落点**自己**就是那个包
 * （corepack 的 `…/v1/pnpm/<ver>/`）。入口**从包自己的 `bin` 字段读**、不猜文件名
 * （猜文件名等于替包做决定，`scripts/package-bin-entry.mjs` 那一层早就这么写了）；
 * `bin` 指向原生二进制时（pnpm 11+ 是 `{ "pnpm": "pnpm" }`，那个文件是 MZ / ELF）
 * 兜一层 Corepack 对 pnpm ≥ 11 写死的 `bin/pnpm.mjs`。
 *
 * @param {string} dropIn 装着 pnpm 的落点目录
 * @returns {string | null}
 */
export function pnpmJsEntry(dropIn: string): string | null {
  const pkgDir = pnpmPackageDir(dropIn);
  if (!pkgDir) return null;
  let manifest: { bin?: unknown };
  try {
    manifest = /* SAFETY: 类型断言已复核 */ JSON.parse(
      fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
    ) as { bin?: unknown };
  } catch {
    return null;
  }
  const bin = manifest.bin;
  let rel: unknown;
  if (typeof bin === "string") rel = bin;
  else if (bin && typeof bin === "object")
    rel = /* SAFETY: 类型断言已复核 */ (bin as Record<string, unknown>).pnpm;
  if (typeof rel === "string" && rel !== "") {
    const target = path.resolve(pkgDir, rel);
    if (isPnpmEntryScript(target)) return target;
  }
  /* `bin` 指向原生二进制时（pnpm 11+ 把 `pnpm` 写成 `{ "pnpm": "pnpm" }`，那个文件是
   * MZ / ELF），**同包的 Corepack 入口**在 `bin/pnpm.mjs` —— 它对 pnpm ≥ 11 写死这一个
   * 相对路径。名字照 Corepack 的约定抄，不是本仓替包做决定：读不到就老实返回 `null`，
   * 调用方照旧走「直接起可执行形态」那条路。 */
  for (const name of ["pnpm.mjs", "pnpm.cjs"]) {
    const corepackEntry = path.join(pkgDir, "bin", name);
    if (isPnpmEntryScript(corepackEntry)) return corepackEntry;
  }
  return null;
}

/** 落点上那个 pnpm 包的目录（两种形状，见 {@link pnpmJsEntry} 头注）。 */
function pnpmPackageDir(dropIn: string): string | null {
  for (const dir of [path.join(dropIn, "node_modules", "pnpm"), dropIn]) {
    if (!isFile(path.join(dir, "package.json"))) continue;
    /* 落点自己是包时，这份 `package.json` 可能是别的包（PATH 上随便一个目录）；
     * 名字对不上就不算。 */
    if (dir !== dropIn) return dir;
    try {
      const pkg = /* SAFETY: 类型断言已复核 */ JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (pkg.name === "pnpm") return dir;
    } catch {
      /* 读不了就跳过这一格。 */
    }
  }
  return null;
}

/** 这份文件能不能被 `process.execPath` 起 —— 判「是不是脚本」只有 `executableKind()`
 *  一处（硬规则 24），这里只把结论翻成布尔：批处理与原生二进制筛掉，其余都算。
 *  ⚠️ 另挡一种（ISSUE #2597）：`#` 起头而**非** `#!` 的是 Corepack 缓存里的**占位文本**
 *  （首行注释自己写着「请走 ./bin/pnpm.mjs」），node 起它必然 `SyntaxError` 而退的是 1。 */
function isPnpmEntryScript(candidate: string): boolean {
  const kind = executableKind(candidate);
  if (!isFile(candidate) || kind === "binary" || kind === "batch") return false;
  const first = fs.readFileSync(candidate).subarray(0, 2).toString("latin1");
  return !first.startsWith("#") || first.startsWith("#!");
}

/** `pnpmInvocation()` 的第一优先：能跑包真身的 JS 入口时就不起垫片（ISSUE #2562）。
 *
 * 候选落点按 PATH 顺序，外加 corepack 与 pnpm 自己的标准落点 —— 后者是「PATH 上只有
 * 垫片、但包真身就摆在旁边」的现场。与 `NodeJS.Platform` 无关：全平台同一条路。
 * 返回的 `candidate` 是落点目录，`entry` 是那个 JS 入口；没有包真身时 `null`。 */
export function pnpmJsInvocation({
  name,
  env,
  platform,
}: {
  name: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  platform: NodeJS.Platform;
}): {
  command: string;
  prefixArgs: string[];
  entry: string;
  candidate: string;
} | null {
  /* 只有 pnpm 有「包真身 + 垫片」这一形（`pnpmInvocation()` 的 `name` 还被 `cnb`
   * 复用，那是另一种落点形状），所以按名字收口。 */
  if (name !== "pnpm") return null;
  for (const dir of String(envVar(env, "PATH", platform) ?? "")
    .split(isWindows(platform) ? ";" : ":")
    .filter(Boolean)) {
    const entry = pnpmJsEntry(dir);
    if (entry) {
      return {
        command: process.execPath,
        prefixArgs: [entry],
        entry,
        candidate: dir,
      };
    }
  }
  /* PATH 上只有垫片：包真身在 corepack 与 pnpm 自己的落点上（corepack 按版本分目录，
   * 取最高的那一版）。`LOCALAPPDATA` / `USERPROFILE` / `HOME` 三路都试，是因为注入进来的
   * `env` 未必带全 —— 按目标平台只挑一个，会在「只写了 HOME」那形状上漏掉。 */
  const localAppData = String(envVar(env, "LOCALAPPDATA", platform) ?? "");
  const home = String(
    envVar(env, "USERPROFILE", platform) ?? envVar(env, "HOME", platform) ?? "",
  );
  const roots = [
    localAppData && path.join(localAppData, "node", "corepack", "v1", "pnpm"),
    localAppData && path.join(localAppData, "pnpm"),
    home &&
      path.join(home, "AppData", "Local", "node", "corepack", "v1", "pnpm"),
    home && path.join(home, "AppData", "Local", "pnpm"),
    home && path.join(home, ".local", "share", "pnpm"),
    home && path.join(home, "Library", "pnpm"),
  ].filter((v): v is string => Boolean(v));
  for (const root of roots) {
    /* 先按「落点本身就是那一版」试一次，再按 corepack 的子目录（`<ver>/`）试。 */
    const dropIns = [root];
    try {
      dropIns.push(
        ...fs
          .readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^\d+\.\d+\.\d+/.test(d.name))
          .map((d) => path.join(root, d.name))
          .sort((a, b) =>
            compareVersionDesc(path.basename(a), path.basename(b)),
          ),
      );
    } catch {
      /* 落点不存在（这台机没装 corepack / 没装 pnpm）：看下一个。 */
    }
    for (const dropIn of dropIns) {
      const entry = pnpmJsEntry(dropIn);
      if (entry)
        return {
          command: process.execPath,
          prefixArgs: [entry],
          entry,
          candidate: dropIn,
        };
    }
  }
  return null;
}

/** 版本目录排序用（`12.4.1` 排在 `10.34.5` 前面）—— 非数字段按字符串退让。 */
function compareVersionDesc(a: string, b: string): number {
  const [pa, pb] = [a.split("."), b.split(".")];
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const [na, nb] = [
      Number.parseInt(pa[i] ?? "0", 10),
      Number.parseInt(pb[i] ?? "0", 10),
    ];
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const cmp = String(pa[i] ?? "").localeCompare(String(pb[i] ?? ""));
      if (cmp !== 0) return cmp;
      continue;
    }
    if (na !== nb) return nb - na;
  }
  return 0;
}
