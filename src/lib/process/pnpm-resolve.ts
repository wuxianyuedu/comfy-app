/**
 * pnpm 那一族的「路径上的落点怎么挑」：包真身 JS 入口 → 垫片，以及它们的顺序。
 *
 * 为什么单独一份：本模块此前与 `executable-resolve.ts` 同住一份文件，而两份合起来
 * 在 oxlint `curly` 那批机械改写后越过文件长度硬闸（规范 §12.6）。拆的边界是**职责**：
 * `executable-resolve.ts` 回答「任意命令在这台机器上怎么起」（PATH × PATHEXT、形态
 * 判定、可用性确认），这里回答「pnpm 那几种落点里先挑哪一个」—— 后者只服务
 * `pnpmInvocation()` / `pnpmJsInvocation()` 两个调用点，且大半代码是「读那份
 * `package.json` 的 `bin` 字段」这类与 pnpm 包形状强绑定的判据。
 *
 * ⚠️ **本文件不是跨宿主模块**：`scripts/launcher-core/*.mjs` 只静态 import
 * `executable-resolve.ts`（那条链的每个节点都必须是叶子，见
 * `tests/esm-cross-host-imports.test.ts`）。所以说明符按 TS 侧惯例省略扩展名。
 */
import fs from "node:fs";
import path from "node:path";

/* 版本目录排序：纯字符串比较，与「怎么挑落点」无关，单独一份。 */
import { compareVersionDesc } from "./version-compare.ts";
import {
  envVar,
  executableExts,
  executableKind,
  isWindows,
  powershellHost,
  realUsabilityProbe,
  usableCommand,
  whichCommand,
  type WhichCommandOptions,
} from "./executable-resolve.ts";

/** 「这个名字在盘上是个**文件**吗」—— 落点探测只看它。
 *
 *  与 `executable-resolve.ts` 里那一份逐字相同，但它在那里是**模块私有**、而跨宿主
 *  叶子链只允许 `.mjs → executable-resolve.ts` 单向（不允许反向导出给它）。三行的
 *  无分支判据，抄一份的代价低于为它开一条跨模块导出（那条导出会被「任意命令怎么起」
 *  之外的调用点顺手拿去用）。 */
function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** `pnpmInvocation()` 的结论。 */
export interface PnpmInvocation {
  /** 完整参数（宿主参数在前）。 */
  args: Array<string>;
  /** PATH 上选中的候选（`.ps1` 回退时是那个脚本，不是宿主）。 */
  candidate: string;
  /** 真正要 spawn 的可执行文件（可能是 PowerShell 宿主）。 */
  command: string;
  /** 那些条目里 `pnpm<后缀>` 真的落在盘上的（只看「名字在不在」，`.ps1` 无条件在列）。 */
  onDisk: Array<string>;
  /** 解释器宿主（PowerShell）的绝对路径；POSIX 上恒为 `null`。失败结论要能分清
   *  「没装 pnpm」与「宿主没找到」—— 那两句指向完全不同的下一步（ISSUE #2281）。 */
  osHost: string | null;
  /** 按**目标平台**分隔符切出来的 PATH 条目（空串已滤掉）。 */
  pathEntries: Array<string>;
  /** PATH 原文——**就是 `env` 里那一串**，不是本判据解析出来的那几段。 */
  pathRaw: string;
  /** 这一跳是不是**经宿主（PowerShell）**起的 —— 排障时「为什么多了一层」的答案。
   *
   *  判据是「真正要 spawn 的那个可执行文件是不是宿主」，**不是**「它等不等于
   *  `candidate`」：走包真身 JS 入口时 `command` 是 `process.execPath`、`candidate`
   *  是落点目录，两者本来就不相等，而那条路上一个宿主也没有（ISSUE #2562）。 */
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
  args: Array<string> = [],
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
  if (!candidate) {
    return null;
  }
  const usable = js
    ? { ok: true, command: js.command, prefixArgs: js.prefixArgs, reason: null }
    : usableCommand(candidate, ["-v"], { env, platform });
  const invocation = usable.ok
    ? { command: usable.command, prefixArgs: usable.prefixArgs }
    : { command: candidate, prefixArgs: [] };
  const osHost = isWindows(platform) ? powershellHost({ env, platform }) : null;
  const pathRaw = String(envVar(env, "PATH", platform) ?? "");
  const pathEntries = pathRaw.split(isWindows(platform) ? ";" : ":").filter(Boolean);
  const onDisk: Array<string> = [];
  /* `.ps1` **无条件**在列（与 `executableExts` 同口径）：Windows 默认 `PATHEXT` 从不含它，
   * 漏掉这一读数就会出现「一个都没命中」而旁边正躺着一个能用的 `pnpm.ps1`（ISSUE #2281）。 */
  for (const dir of pathEntries) {
    for (const ext of [...executableExts(env, platform), ".ps1"]) {
      const hit = path.join(dir, name + ext);
      if (isFile(hit) && !onDisk.includes(hit)) {
        onDisk.push(hit);
      }
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
  if (!pkgDir) {
    return null;
  }
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
  if (typeof bin === "string") {
    rel = bin;
  } else if (bin && typeof bin === "object") {
    rel = /* SAFETY: 类型断言已复核 */ (bin as Record<string, unknown>).pnpm;
  }
  if (typeof rel === "string" && rel !== "") {
    const target = path.resolve(pkgDir, rel);
    if (isPnpmEntryScript(target)) {
      return target;
    }
  }
  /* `bin` 指向原生二进制时（pnpm 11+ 把 `pnpm` 写成 `{ "pnpm": "pnpm" }`，那个文件是
   * MZ / ELF），**同包的 Corepack 入口**在 `bin/pnpm.mjs` —— 它对 pnpm ≥ 11 写死这一个
   * 相对路径。名字照 Corepack 的约定抄，不是本仓替包做决定：读不到就老实返回 `null`，
   * 调用方照旧走「直接起可执行形态」那条路。 */
  for (const name of ["pnpm.mjs", "pnpm.cjs"]) {
    const corepackEntry = path.join(pkgDir, "bin", name);
    if (isPnpmEntryScript(corepackEntry)) {
      return corepackEntry;
    }
  }
  return null;
}

/** 落点上那个 pnpm 包的目录（两种形状，见 {@link pnpmJsEntry} 头注）。 */
function pnpmPackageDir(dropIn: string): string | null {
  for (const dir of [path.join(dropIn, "node_modules", "pnpm"), dropIn]) {
    if (!isFile(path.join(dir, "package.json"))) {
      continue;
    }
    /* 落点自己是包时，这份 `package.json` 可能是别的包（PATH 上随便一个目录）；
     * 名字对不上就不算。 */
    if (dir !== dropIn) {
      return dir;
    }
    try {
      const pkg = /* SAFETY: 类型断言已复核 */ JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (pkg.name === "pnpm") {
        return dir;
      }
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
  if (!isFile(candidate) || kind === "binary" || kind === "batch") {
    return false;
  }
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
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  name: string;
  platform: NodeJS.Platform;
}): {
  candidate: string;
  command: string;
  entry: string;
  prefixArgs: Array<string>;
} | null {
  /* 只有 pnpm 有「包真身 + 垫片」这一形（`pnpmInvocation()` 的 `name` 还被 `cnb`
   * 复用，那是另一种落点形状），所以按名字收口。 */
  if (name !== "pnpm") {
    return null;
  }
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
  const home = String(envVar(env, "USERPROFILE", platform) ?? envVar(env, "HOME", platform) ?? "");
  const roots = [
    localAppData && path.join(localAppData, "node", "corepack", "v1", "pnpm"),
    localAppData && path.join(localAppData, "pnpm"),
    home && path.join(home, "AppData", "Local", "node", "corepack", "v1", "pnpm"),
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
          .sort((a, b) => compareVersionDesc(path.basename(a), path.basename(b))),
      );
    } catch {
      /* 落点不存在（这台机没装 corepack / 没装 pnpm）：看下一个。 */
    }
    for (const dropIn of dropIns) {
      const entry = pnpmJsEntry(dropIn);
      if (entry) {
        return {
          command: process.execPath,
          prefixArgs: [entry],
          entry,
          candidate: dropIn,
        };
      }
    }
  }
  return null;
}

export interface ResolvedInvocation {
  /** 完整参数（宿主参数在前）。 */
  args: Array<string>;
  /** 真正要 spawn 的可执行文件（可能是绝对路径或 PowerShell 宿主）。 */
  command: string;
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
  args: Array<string> = [],
  {
    env = process.env,
    platform = process.platform,
    probe = realUsabilityProbe,
    probeArgs = ["--version"],
  }: WhichCommandOptions = {},
): ResolvedInvocation {
  const candidate = whichCommand(file, { env, platform, probe, probeArgs });
  if (!candidate) {
    return { command: file, args, resolved: false };
  }
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
