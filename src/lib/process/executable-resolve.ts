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

import { isWindows } from "./platform.ts";
import fs from "node:fs";
import path from "node:path";

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

/**
 * 这一次「起一次确认」的失败码算不算**结论**。
 *
 * 判据分两类（ISSUE #1961，`usableCommand` 里那一格）：
 *   · **结论**（`ENOENT` / `EACCES` / `EINVAL` / `ENOEXEC` / …）—— 「起了一次、明确
 *     失败」，说明这个候选**真的不可用**，该跳过；
 *   · **没量到**（`TRANSIENT_SPAWN_CODES`）—— 机器当时起不来新进程。那不是这个命令
 *     的属性，跳过它等于把「拿不到测量」读成「测量结果是它坏了」（§13.6.2 那条口径）。
 *
 * 为什么不能只判 `ETIMEDOUT` 一个：实测那台自托管节点上 `E2E 关键流程` 是**0.6 秒**
 * 就报 null 的 —— 10s 的超时走不到 0.6s，所以那一次不是超时，而是资源类失败
 * （满载节点上 `spawnSync` 直接给 `EAGAIN` / `UNKNOWN`）。两类都要按「没量到」办。
 *
 * @param {string | null} code `spawnSync` 给的错误码（`null` = 起得来）
 * @returns {boolean} true = 这一次失败**不构成**「候选不可用」的结论
 */
function isTransientSpawnCode(code: string | null): boolean {
  return code === null || TRANSIENT_SPAWN_CODES.has(code);
}

/** 默认探针：问这台真机器。 */
const realUsabilityProbe: UsabilityProbe = {
  access: (candidate) => fs.accessSync(candidate, fs.constants.X_OK),
  spawn: (candidate, args) => {
    const probe = spawnSync(candidate, args, {
      stdio: "ignore",
      windowsHide: true,
      timeout: USABILITY_PROBE_TIMEOUT_MS,
    });
    /** `spawnSync` 的 error 是 Error 的运行时子类（`code` 由 libuv 填）。
     *  怎么读这个 code（尤其 `ETIMEDOUT`）是**判据**的事，在 `usableCommand` 里。 */
    return (
      (probe.error as NodeJS.ErrnoException | null | undefined)?.code ?? null
    );
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

/* 是否是 Windows —— 定义搬到 `./platform.ts`，这里只 **re-export**（既有调用点
 * 一个都不用动）。
 *
 * 为什么必须搬（ISSUE #1961，实测红在平台侧 E2E 上）：`python-candidates.ts` 与
 * `python-resolve.ts` 只需要这一个判断，却**静态 import 本文件** —— 而本模块是
 * `.ts`，一个 `.mjs` 静态 import 它时 import 说明符**必须带 `.ts` 扩展名**才能被
 * Node 的 ESM 解析器找到。于是那条链（`e2e/support/preflight-python.mjs` →
 * `python-candidates.ts` → `./executable-resolve`）上就出现了同一份文件被
 * **两种形态**引用：本仓 TS 侧的惯例是省略扩展名，而 `.mjs` 侧只能用带扩展名的形态
 * —— 两种形态在「代码里 grep 字符串」这一层能对账，在**运行时**不能：`.mjs` 那条
 * 一旦真的走进去就是 `ERR_MODULE_NOT_FOUND`（实测报的那句是「找不到模块
 * `…/src/lib/process/executable-resolve`，它由 `python-candidates.ts` import」，
 * 1 秒就退 —— 平台侧 E2E 那一步的完整读数见规范 13 §13.5.3.10）。
 *
 * 所以判据躲进一个**叶子模块**：两边都 import 它（TS 侧照旧省略扩展名，
 * `.mjs` 侧写 `./platform.ts`），而 `python-candidates` 那条链上再没有需要
 * 跨「扩展名惯例」边界的边。这也让「哪个模块能被纯宿主直接加载」这件事有个
 * 可判的形状（见 `tests/esm-cross-host-imports.test.ts`）。 */
export { isWindows };

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
 * 读一个环境变量，**按平台的大小写语义**（windows 上不敏感）。
 *
 * ## 为什么非要有这一层（ISSUE #1961，平台侧 E2E 的最后一格）
 *
 * Windows 上 `process.env` 是一个**大小写不敏感**的代理，而 `{ ...process.env }`
 * 出来的是**普通对象** —— 键名按系统存的写法来（Windows 常把 `PATH` 存成 `Path`）。
 * 于是同一份环境「直接读」与「复制一份再读」会得到不同答案：
 *
 *   · `resolvePython()` 默认读 `process.env`（代理）⇒ `env.PATH` 拿得到；
 *   · `checkPythonReady({ env: { ...process.env } })` 传下来的是复制品 ⇒
 *     `env.PATH` 是 `undefined` ⇒ 这里扫一个**空 PATH** ⇒ 判「这台机没有 Python」。
 *
 * 现场：同一个 stage 里 `Python 探针读数` 报 `ok python → D:\Program Files\Python312\python.exe`，
 * 而 `E2E 关键流程` 报 `PATH 上没有可用的 Python` —— 差的正是「读的是代理还是复制品」。
 * 判据在 `tests/preflight-python-env-case.test.ts`。
 *
 * POSIX 上环境变量**大小写敏感**（`Path` 与 `PATH` 是两个变量），所以那一边只认
 * 精确写法 —— 这一层不改变 POSIX 的任何行为。
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
 * 上面那三步里，`.PS1` 此前与 `.CMD` / `.BAT` / `.COM` 一样要 `PATHEXT` 声明才进得来
 * —— 而 Windows 系统的默认 `PATHEXT` **从不含 `.PS1`**（`PowerShell.exe` 不是靠
 * 文件关联启动的，`.ps1` 也不在「敲名字就能跑」的那一类里）。于是：
 *
 *   · corepack 摆在 `.tools\pnpm\<ver>\bin` 的那三个形态里，**只有 `.ps1` 能被
 *     Node 起得来**（无扩展名 shim 是 shebang、libuv 不解析；`.CMD` 是批处理、
 *     只有 cmd.exe 解释）；
 *   · 候选表里却没有 `.ps1` ⇒ `whichCommand()` 一个都选不出 ⇒ 返回 `null`
 *     ⇒ 上层报「PATH 上没有任何可用的 pnpm 形态」，而**能跑的那个就摆在旁边**。
 *
 * 实测（自托管 Windows 节点，`PATHEXT=.COM;.EXE;.BAT;.CMD;.VBS;…`）：
 * `pnpmInvocation()` 返回 `null`，而同目录的 `pnpm.ps1` 一直在盘上 ——
 * 「工具链自证」因此报 `pnpm 不可用`，整条流水线在第 1 秒就停。
 *
 * 判据因此改成：**`.PS1` 与无扩展名 shim 一样，是本仓自己要找的形态，不由 PATHEXT
 * 决定**。理由与「为什么必须自己解析 PATH」同源（见 `whichCommand` 的注释）：
 * `PATHEXT` 描述的是「cmd.exe 敲名字会试哪些后缀」，而这里问的是
 * 「Node 能起得来哪些形态」—— 两个问题不同，答案也就不能共用一份。
 *
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
 * 候选名是拿 `PATHEXT` 拼出来的，而系统那份默认写成大写（`.COM;.EXE;.BAT;.CMD`），
 * 于是解析结果可能是 `node.EXE`。spawn 这件事对大小写无所谓，但这一份路径不只用来
 * spawn：控制台把它回显成「真正要起的那一份」、日志里写的也是它，而用户会拿它去比对
 * 与点开（大小写不一致时既对不上、也显得解析结果不可信）。NTFS 不敏感但**保留**原
 * 大小写，所以真实名字问目录本身要一次就够了 —— 只在命中后做一次，结果进 `whichCache`。
 * POSIX 的大小写是要紧的，原样返回。
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

/** 候选的**执行形态**：决定「要不要先确认它能跑」「跑不起来时怎么回退」。 */
export type ExecutableKind =
  | "shebang"
  | "batch"
  | "script"
  | "binary"
  | "unknown";

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
  // **`.ps1` 在 Windows 上必须交宿主起**（ISSUE #1961）：它与 `.cmd` 是同一类
  // 「Node 自己起不来、要别人解释」的形态，只是解释器不同（PowerShell 而不是
  // cmd.exe）。此前它落在「其余形态真起一次」那一档 —— 而**真起一次在开发机上
  // 判不出来**：POSIX 宿主的探针会把「起一个 .ps1」报成功（那边 `.ps1` 不过是个
  // 普通文本文件，压根不是本判据要问的问题），于是 `usableCommand` 返回
  // `{ok: true, command: <那个 .ps1>, prefixArgs: []}` —— 上层拿去 spawn 就是
  // 「拿 .ps1 当可执行文件起」，在 Windows 上必失败，而这一步的结论是「可用」。
  //
  // 修法与批处理同路：**不真起**，直接把该 `.ps1` 交 `powershellHost()`，给出
  // `-File <那个 .ps1>` 的完整形态。这也是「`.PS1` 进入候选表」之后必须同批补上的
  // 另一半 —— 只让它被找到、却给不出能 spawn 的形态，等于把缺陷从
  // 「找不到」挪成「找到了但起不来」。
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
  const code = probe.spawn(candidate, probeArgs);
  /* **「没量到」不等于「起不来」**（ISSUE #1961）。
   *
   * 照「非空 code 即失败」读的话，任何一次失败的起进程都会把这个候选跳过；候选全跳过
   * ⇒ `whichCommand()` 返回 `null` ⇒ 上层读成「这个命令不存在」。而失败码里有一类说的
   * 是**机器当时的状态**、不是这个命令的属性：撞上探针自己的 `timeout`（`ETIMEDOUT`），
   * 以及满载节点上起不了新进程（`EAGAIN` / `EMFILE` / `ENOMEM` / … / libuv 认不出的
   * `UNKNOWN`）。
   *
   * 现场（`cnb-5fd-1k50s26f3`）：同一次构建、同一台节点、同一个解释器，机器空着时
   * `Python 可用性` / `Python 探针读数` 都答得出来，而排在 `单元测试`（723s）与
   * `生产构建` 之后的 `E2E 关键流程` **0.6 秒**就报「PATH 上没有可用的 Python」——
   * 0.6s 走不到 10s 的超时，所以那一次是资源类失败，不是超时。两类都得按「没量到」办。
   *
   * 代价是「真有挂死的命令」被当可用，而那远小于「一台满机上所有 `resolvePython` /
   * `pnpmInvocation` 齐刷刷报不存在」—— 后者会让人去装一个本就装好的东西，报错还
   * 完全指不到负载（§13.6.2 那条「拿不到测量 ≠ 测量结果是红的」）。
   *
   * 其余 code（`ENOENT` / `EACCES` / `EINVAL` / `ENOEXEC`）照旧是结论：那是
   * 「起了一次、明确失败」，与「没来得及起」不是同一件事。
   *
   * 判据放这里而不是默认探针里：探针只负责**取事实**（libuv 给了什么 code），
   * 「这个 code 算不算不可用」是**判据**，对所有探针（含单测注入的那些）一视同仁。 */
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
  /** 是否经宿主（PowerShell）起 —— 排障时「为什么多了一层」的答案。 */
  viaHost: boolean;
  /** PATH 原文——**就是 `env` 里那一串**，不是本判据解析出来的那几段。 */
  pathRaw: string;
  /** 按**目标平台**分隔符切出来的 PATH 条目（空串已滤掉）。 */
  pathEntries: string[];
  /** 那些条目里 `pnpm<后缀>` 真的落在盘上的（只看「名字在不在」，`.ps1` 无条件在列）。 */
  onDisk: string[];
  /** 解释器宿主（PowerShell）的绝对路径；POSIX 上恒为 `null`。
   *
   *  它只在**多一种解释**时才要紧：`.ps1` 形态在盘上、而 `whichCommand` 复现不出
   *  它经宿主起的形态时，失败结论必须能说清「宿主在不在」，否则下一个人只能猜
   *  那是「没装 pnpm」还是「宿主没找到」（ISSUE #2281 那两份日志：一份说
   *  「一个都没命中」、另一份说「宿主: 找到」，两句话指向完全不同的下一步）。 */
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
 *
 * 返回 `null` = PATH 上没有任何可用的 pnpm 形态（调用方必须给出可见出口，
 * 不能静默 `null → 0`）。
 *
 * ## 为什么非空时还要带三条 `PATH` 读数（ISSUE #2281）
 *
 * 「探不到」这个结论在本仓曾经**同时**有三种成因，而日志里只留一句
 * `PATH 上没有可用的 pnpm`：① 真没装；② 环境变量表里的键名不是 `PATH`
 * （`{ ...process.env }` 复制品里 Windows 常写作 `Path`），于是判据扫了一个空串；
 * ③ PATH 那一串的平台形态读错了（`;` 与 `:` 分岔）。三种的下一动作完全不同
 * （装 / 修键名 / 修分隔符），而那一句对它们逐字同形。
 *
 * 所以这里一次把**原文**（`pathRaw`）、**切出来的条目**（`pathEntries`）、
 * **哪些条目上真有这个名字**（`onDisk`）一起交出去：取证面因此不必再自己读一遍
 * `env` 并「按它以为的方式」重新解析 —— 而正是那第二份读法把第②③类成因
 * 藏起来的（`scripts/ci-toolchain-selfcheck.mjs` 的 `pnpmForensics` 用过一份）。
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
  const osHost = isWindows(platform) ? powershellHost({ env, platform }) : null;
  const pathRaw = String(envVar(env, "PATH", platform) ?? "");
  const pathEntries = pathRaw
    .split(isWindows(platform) ? ";" : ":")
    .filter(Boolean);
  const onDisk: string[] = [];
  /* `.ps1` **无条件**在列（与 `executableExts` 里那一条同口径）：Windows 默认
   * `PATHEXT` 从不含它，而 corepack 摆在盘上的三个形态里只有它经宿主起得来 ——
   * 「盘上有没有这个名字」这一读数漏掉它，就会出现「一个都没命中」而旁边正躺着
   * 一个能用的 `pnpm.ps1`（ISSUE #2281 那两份日志里的同一处形状）。 */
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
    viaHost: invocation.command !== candidate,
    pathRaw,
    pathEntries,
    onDisk,
    osHost,
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
