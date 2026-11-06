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
// 说明符带 `.ts`。所以本模块的依赖闭包只有 `platform.ts` 一个。
//
// 那条叶子性判的是**说明符**（`.mjs` 侧 Node 的 ESM 解析器不补扩展名），所以
// 「从本模块再 import 一个同目录的 `.ts`」即便写了 `.ts` 也只有一个方向成立、
// 另一个方向（TS 侧惯例省略扩展名）当场 `ERR_MODULE_NOT_FOUND`。于是能搬出去的
// **只有不回头 import 本模块**的那一块：`./pnpm-resolve`（`pnpmInvocation` /
// `pnpmJsEntry` / `pnpmJsInvocation`）与 `./version-compare` 都只依赖
// `platform.ts` 与 node 内建；而 `resolveCommandInvocation` 要回 import
// `whichCommand` / `usableCommand`，它**留在这里**。

import { spawnSync } from "node:child_process";

import fs from "node:fs";
import path from "node:path";

import { isWindows } from "./platform.ts";

type SpawnSyncError = NodeJS.ErrnoException | null | undefined;
/** 「这个候选在这台机器上到底起不起得来」的那一次 OS 交互。 */
export type UsabilityProbe = {
  /** 执行位检查：抛错即「没有执行权限」（默认真 `fs.accessSync(X_OK)`）。 */
  access(candidate: string): void;
  /** 起一次确认：返回 libuv 给的错误码，`null` = 起得来（默认真 `spawnSync`）。 */
  spawn(candidate: string, args: Array<string>): string | null;
};

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

/** 默认探针：问这台真机器。`error.code` 由 libuv 填，怎么读它是 `usableCommand` 的事。
 *
 *  导出给 `./pnpm-resolve`：`resolveCommandInvocation` 那一条要用它做默认值，而它
 *  只依赖 node 内建、不回头 import 任何本模块的判据（跨宿主叶子性见文件头）。 */
export const realUsabilityProbe: UsabilityProbe = {
  access: (candidate) => {
    fs.accessSync(candidate, fs.constants.X_OK);
  },
  spawn: (candidate, args) => {
    const probe = spawnSync(candidate, args, {
      stdio: "ignore",
      windowsHide: true,
      timeout: USABILITY_PROBE_TIMEOUT_MS,
    });
    /* SAFETY: 类型断言已复核 */
    const err = probe.error as SpawnSyncError;
    return err?.code ?? null;
  },
};

/** `whichCommand` / `usableCommand` 共用的选项（`env`、`platform`、`probe` 可注入，便于单测）。 */
export type WhichCommandOptions = {
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
  probeArgs?: Array<string>;
};

/** 「这个候选能不能被 spawn」的结论。`prefixArgs` 是启动它所需的宿主参数
 *  （shim 换成 PowerShell 时非空），`reason` 只在 `ok: false` 时有值。 */
export type CommandUsability = {
  command: string;
  ok: boolean;
  prefixArgs: Array<string>;
  reason: string | null;
};

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
  if (exact !== undefined) {
    return exact;
  }
  /* 大小写不敏感**只按目标平台**（与 `executableExts()` 同口径）：判据在 POSIX 上
   * 判 win32 形态时也要复现这一格，所以不能读宿主的 `process.platform`。 */
  if (!isWindows(platform)) {
    return undefined;
  }
  const wanted = name.toUpperCase();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === wanted) {
      return env[key];
    }
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
  if (hit !== undefined) {
    return hit;
  }
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  const exts = executableExts(env, platform);
  let result: string | null = null;
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (!isFile(candidate)) {
        continue;
      }
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
    /* 命中结果是拼出来的绝对路径，空串不可能出现 */
    if (result !== null) {
      break;
    }
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
): Array<string> {
  if (!isWindows(platform)) {
    return [""];
  }
  const declared = String(envVar(env, "PATHEXT", platform) ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
  /** 认形态的前缀（大小写不敏感，PATHEXT 常见写法是大写）。 */
  const declaredHas = (ext: string) => declared.some((d) => d.toUpperCase() === ext);
  const ordered: Array<string> = [];
  if (declaredHas(".EXE") || declared.length === 0) {
    ordered.push("");
  }
  for (const ext of [".EXE", ".PS1", ".CMD", ".BAT", ".COM"]) {
    /* `.PS1` 不看 `PATHEXT`（理由见头注）：它是本仓唯一能被 Node 起的 corepack 形态，
     * 而默认 `PATHEXT` 从不声明它 —— 由它决定就是「能跑的那个永远选不出来」。 */
    if (ext === ".PS1" || declaredHas(ext)) {
      ordered.push(ext);
    }
  }
  for (const ext of declared) {
    const upper = ext.toUpperCase();
    if (!ordered.some((o) => o.toUpperCase() === upper)) {
      ordered.push(ext);
    }
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
  if (!isWindows(platform)) {
    return candidate;
  }
  const wanted = composed.toUpperCase();
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.toUpperCase() === wanted) {
        return path.join(dir, entry);
      }
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
export type ExecutableKind = "shebang" | "batch" | "script" | "binary" | "unknown";

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
    if (read < 2) {
      return "unknown";
    }
    const text = head.subarray(0, read).toString("latin1");
    if (text.startsWith("#!")) {
      return "shebang";
    }
    // 批处理：以 `@` 起头（`@echo off` / `@SETLOCAL`），或 `:label` / `echo off`。
    // 只认开头，不看扩展名 —— `.cmd` 只是命名习惯，内容才是判据。
    if (/^@?\s*(?:echo|setlocal)\b/i.test(text) || text.startsWith("@")) {
      return "batch";
    }
    // 可打印 ASCII 起头 → 文本脚本；其余按二进制（含 Windows 的 MZ 头）。
    // 量词是 `{2,}`（**至少**两个可打印字节）而不是 `{2}`：`text` 是最多 16 字节的
    // 文件头，写 `{2}` 就成了「长度恰好为 2 才算脚本」，于是每一份真脚本都被判成
    // `binary`（ISSUE #2563 —— 它一直没红，是因为此前没有调用点依赖 `script` 这一支）。
    return /^[\u0009\u000a\u000d\u0020-\u007e]{2,}$/.test(text) ? "script" : "binary";
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
  probeArgs: Array<string> = ["--version"],
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
    /* 宿主路径是解析出来的绝对路径，空串不可能出现 */
    if (host !== null) {
      return {
        ok: true,
        command: host,
        prefixArgs: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", candidate],
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
    if (fallback) {
      return fallback;
    }
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
  if (fallback) {
    return fallback;
  }
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
  const script = `${ext ? candidate.slice(0, -ext.length) : candidate}.ps1`;
  if (!isFile(script)) {
    return null;
  }
  const host = powershellHost({ env, platform });
  /* 宿主路径是解析出来的绝对路径，空串不可能出现 */
  if (host === null) {
    return null;
  }
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
  if (!isWindows(platform)) {
    return null;
  }
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
  probeArgs: Array<string> = ["--version"],
  {
    env = process.env,
    platform = process.platform,
    probe = realUsabilityProbe,
  }: WhichCommandOptions = {},
): { command: string; prefixArgs: Array<string> } {
  const usable = usableCommand(candidate, probeArgs, { env, platform, probe });
  return usable.ok
    ? { command: usable.command, prefixArgs: usable.prefixArgs }
    : { command: candidate, prefixArgs: [] };
}

/* pnpm 那一族（`pnpmInvocation` / `pnpmJsEntry` / `pnpmJsInvocation`）与
 * `resolveCommandInvocation` 的实现住在 `./pnpm-resolve` —— 那块只依赖 `platform.ts`
 * 与 node 内建，是这条跨宿主链上唯一搬得动的部分（见文件头的叶子性说明）。
 * 这里**原样转出**：既有 TS 侧调用点与 `.mjs` 宿主都不用动。 */
export {
  pnpmInvocation,
  pnpmJsEntry,
  pnpmJsInvocation,
  resolveCommandInvocation,
  type PnpmInvocation,
  type ResolvedInvocation,
} from "./pnpm-resolve.ts";
