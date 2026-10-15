/**
 * Python 候选名与启动参数 —— 与 `src/lib/process/python-candidates.ts` 同口径。
 *
 * 这里**不 import 那个文件**（理由见文件头：这一步要在「Node 模块链还没被证明可用」
 * 的机器上跑）。两份文本由 `tests/ci-toolchain-selfcheck.test.ts` 逐项对账 ——
 * 漂了那一侧就红，而不是等到下一次流水线跑出一次看不懂的红。
 */
const PY_CANDIDATES =
  process.platform === "win32"
    ? ["python", "py", "python3"]
    : ["python3", "python"];
/** 裸 `py` 是「列出已装版本」并退非零，必须带 `-3`。 */
const PY_PROBE_ARGS = /** @type {Record<string, string[]>} */ ({
  py: ["-3", "--version"],
});

/**
 * 自托管构建节点的 Python **解析与安装**：候选探测、三条真装通道、「装完必须复验」。
 *
 * 从 `scripts/ci-toolchain-selfcheck.mjs` 拆出来（规范 §12.6 R5 的同一取向：那一份涨到
 * 900 行以上，而这一层是**机制**、留着的那一份是**编排与打印**）。拆的边界按职责，
 * 不按长度：本文件只回答「这台机器上哪个解释器能跑」「弄不到时怎么把它弄到手」，
 * 而「这台机器够不够跑门禁链」的判据与话术仍在 selfcheck 里。
 *
 * ## 为什么是三条通道，而不是一句 `winget install`
 *
 * 上游那几笔把 `winget` 那条路修得很扎实（入口按**一串落点**找、`--scope user` →
 * `--scope machine` 两条都试），但它的失败模式**不是「没找到它」，而是它自己装不成**：
 * 仓库没有与 `msstore` 源达成协议 ⇒ 交互式询问被非交互宿主读成「否」；
 * `--scope user` 走 `msstore` 源时要 `--accept-msstore-source-agreements`，而那
 * **要管理员**（`--silent` 下起不来）。这些形态与「这台机压根没装」在日志里逐字同形，
 * 而处置是两件事 —— 只留「平台侧人工动作」一条出口时，连「装了但没进 PATH」那一档
 * 都还没被排除。
 *
 * 所以按序三条，找到一条能用的就停：
 *
 *   1. `winget`（一串落点 + 两个 scope，实现来自本文件的 `installViaWinget`）；
 *   2. `scoop install python`（开发机常见，按用户、无管理员）；
 *   3. **按需下载官方 embed 包解到检出本地**（`python-embeded/`，**固定版本号**）——
 *      这台节点上唯一真跑通过的一条：zip 解出来就在那儿，不碰系统、不需要管理员、
 *      不依赖任何包管理器。本仓只需要解释器本身（`zipfile` / `json` 都是标准库），
 *      所以 embed 包**不带 pip** 也不影响。
 *
 * 固定版本号是刻意的：取 `latest` 会让同一个提交在两台节点上装出两个不同的 Python，
 * 而这一步的读数（`== python ==` 那行版本号）是要拿来比对的。三条各自的断点写进
 * `attempts` 逐条打印，不糊成一句「装不上」——那正是前几轮「红得指不出真因」的形态。
 *
 * ## 「装上了」不等于「能用了」
 *
 * 安装器报成功、而解释器仍然起不来（解压坏了、杀软拦了、PATH 还没生效）都是真有的形态，
 * 而下一个人读的是 `== python ==` 那行的版本号。所以**复验不采信安装器的退出码** ——
 * 调用方装完一律回到 `findPython()` 再探一遍。
 *
 * ## 只用 `node:child_process` / `node:fs` / `node:path`
 *
 * 与 `ci-toolchain-selfcheck.mjs` 同一条硬约束：这一步是**流水线第一步**，宿主机上 Node
 * 版本不对、模块加载崩掉时报错会落在一句 `Cannot find module` 上，而那时真正要回答的
 * 「这台机器上有什么」一个都没答。所以这里**不 import 任何仓库内模块**。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * 跑一条命令的**注入面**（形状与 selfcheck 的 `run()` 逐字相同，但不共享 —— 两端都要
 * 能独立加载）。
 *
 * @typedef {{ok: boolean, out: string}} RunResult
 */
/**
 * @typedef {{run: (cmd: string, args: string[]) => RunResult}} RunCtx
 */

/**
 * 跑一条命令，返回 `{ ok, out }`；`ok` 判的是**退出码为 0**，不是「有没有抛」。
 *
 * 与 selfcheck 的同名函数是**两份**（本模块刻意不 import 它，见文件头）：都是
 * `spawnSync` 的十行包装，共享的收益比不上「这一步必须在 Node 模块链还没被证明可用的
 * 机器上也能加载」这条约束。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {RunResult}
 */
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { ok: r.status === 0 && !r.error, out };
}

/**
 * Windows 上 Python 的常见安装根 —— **取证与安装共用一份**。
 *
 * 这份清单的教训是「**按这台机的实际布局问，不按我们指望它装在哪问**」
 * （#1959 第三轮，取证第一次上线时当场订正的）：最初只列标准落点
 * （`LOCALAPPDATA\Programs\Python` 一族），而现场那台机的读数是——标准落点
 * **一族零命中**、PATH 里却带着 `D:\Users\<name>\...` 与 `D:\Program Files\...`。
 * 也就是说这台机把用户数据与程序放在 `D:` 盘，解释器（如果装了）根本不在标准落点上；
 * 只查标准落点会**反向误导**成「这台机真的没装」。
 *
 * 所以清单扩成三类：**标准落点** + **本机 PATH 上真实出现过的盘符下的同类位置**
 * + **其他账号 profile 里的按用户安装**（`<盘>:\Users\*\AppData\Local\Programs\Python`）
 * —— 最后一类正是「`yuedu` 会话答得出来、`NT AUTHORITY\SYSTEM` 构建账号答不出来」
 * 的那一格，也是这一整条路径最初的症状。
 *
 * 盘符**从 PATH 里反推**而不是写死 `C:` / `D:`：写死等于把「这台机怎么装」又假设
 * 了一遍，而 PATH 是现成的、这台机自己的事实。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
/**
 * 本机 PATH 上真实出现过的盘符（`C:\\` / `D:\\`，去重）—— **一处定义、多处用**。
 *
 * 为什么不能写死 `C:`：那等于把「这台机怎么装」又假设了一遍，而 PATH 是这台机
 * 自己的事实（现场那台就把用户数据与程序放在 `D:` 盘）。调用方目前有两处
 * （Python 安装根、winget 落点），两处问的是同一个问题。
 *
 * ⚠️ **不要按分隔符切**：`path.delimiter` 是**跑这段的宿主**的分隔符（开发机是
 * `:`），而盘符自带 `:` —— 一按 `:` 切就把 `C:\\` 切成 `C` 与 `\\`，盘符一个都
 * 认不出来（实测踩过）。这里改成**在整串 PATH 上直接找盘符**：取「行首或 `;` 之后
 * 紧跟 `X:\\` / `X:/`」的位置，与切分解耦。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]} 形如 `["C:\\\\", "D:\\\\"]`
 */
function pathDrives(env) {
  const drives = new Set();
  for (const m of String(env.PATH ?? "").matchAll(/(^|;)([A-Za-z]:)[\\/]/g)) {
    drives.add(`${m[2]}\\`);
  }
  return [...drives];
}

/**
 * 机器上所有账号的 profile 根（`<盘>:\\Users`）—— **一处定义、多处用**。
 *
 * 另附 `C:\\Users`：PATH 里不一定有 `C:`，纯 PATH 反推会漏掉系统盘上的 profile。
 * 「其他账号的 profile」正是这条路径最初的症状所在 —— `yuedu` 会话答得出来、
 * `NT AUTHORITY\\SYSTEM` 构建账号答不出来。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function userRoots(env) {
  const roots = new Set(["C:\\Users"]);
  for (const drive of pathDrives(env)) {
    roots.add(path.join(drive, "Users"));
  }
  return [...roots];
}

/**
 * Windows 上 Python 的常见安装根 —— **取证与安装共用一份**。
 *
 * 这份清单的教训是「**按这台机的实际布局问，不按我们指望它装在哪问**」
 * （#1959 第三轮，取证第一次上线时当场订正的）：最初只列标准落点
 * （`LOCALAPPDATA\\Programs\\Python` 一族），而现场那台机的读数是——标准落点
 * **一族零命中**、PATH 里却带着 `D:\\Users\\<name>\\...` 与 `D:\\Program Files\\...`。
 * 也就是说这台机把用户数据与程序放在 `D:` 盘，解释器（如果装了）根本不在标准落点上；
 * 只查标准落点会**反向误导**成「这台机真的没装」。
 *
 * 所以清单扩成三类：**标准落点** + **本机 PATH 上真实出现过的盘符下的同类位置**
 * + **其他账号 profile 里的按用户安装**（`<盘>:\\Users\\*\\AppData\\Local\\Programs\\Python`）
 * —— 最后一类正是「`yuedu` 会话答得出来、`NT AUTHORITY\\SYSTEM` 构建账号答不出来」
 * 的那一格，也是这一整条路径最初的症状。
 *
 * 盘符与用户根取自 {@link pathDrives} / {@link userRoots}（与 `wingetCandidates`
 * 共用同一份证据 —— PATH 反推，不写死 `C:`）。
 *
 * @param {Record<string, string | undefined>} env
 * @param {(p: string) => string[]} [listDirs] 列目录（单测注入；默认真读 `fs`）
 * @returns {string[]}
 */
function pythonInstallRoots(env, listDirs = listDirectories) {
  const roots = [
    path.join(env.LOCALAPPDATA ?? "", "Programs", "Python"),
    path.join(env.ProgramFiles ?? "", "Python"),
    path.join(env["ProgramFiles(x86)"] ?? "", "Python"),
    path.join(env.ALLUSERSPROFILE ?? "", "Python"),
  ];
  // 本机 PATH 上出现过的盘符 ——「这台机把东西装在哪」的现成证据，比假设 `C:` 强。
  for (const drive of pathDrives(env)) {
    roots.push(path.join(drive, "Program Files", "Python"));
    roots.push(path.join(drive, "Python"));
    roots.push(path.join(drive, "Programs", "Python"));
  }
  // 展开 `<盘>:\\Users\\<账号>\\AppData\\Local\\Programs\\Python`。
  for (const usersRoot of userRoots(env)) {
    for (const profile of listDirs(usersRoot)) {
      roots.push(path.join(profile, "AppData", "Local", "Programs", "Python"));
    }
  }
  return [...new Set(roots)].filter(
    (p) => p.length > 0 && path.dirname(p) !== p,
  );
}

/**
 * 「这个执行账号到底看得见什么」——失败时的取证（#1959 第三轮）。
 *
 * 触发它的是一对**相反的读数**：同一台机器上，人在自己的会话里跑 `python -V` 答
 * `Python 3.12.2`，而这里报「一个都没有」。两者不矛盾，是**执行身份不同** ——
 * Runner 以服务 / 代理账号跑、用的是机器 PATH，而 python.org 安装包的默认选项
 * 「Install for me only」只写进**安装者那个用户**的 PATH。
 *
 * 这两种情形（装过但账号看不见 / 真的没装）在日志里逐字同形，处置却相反：
 * 位置命中而命令探不到 ⇒ 改这个账号的 PATH 或机器级重装，**别重复装**；
 * 位置也没命中 ⇒ 才是这台机真没装（此时三条装通道才是对的）。把这两条分岔打印出来，
 * 判读就不需要有人远程登进那台构建机。
 *
 * @param {{env?: Record<string, string | undefined>, account?: string,
 *          existing?: (p: string) => boolean,
 *          listDirs?: (p: string) => string[]}} [options]
 * @returns {string[]} 要逐行打印的取证内容
 */
export function pythonForensics({
  env = process.env,
  account = currentAccount(),
  existing = (/** @type {string} */ p) => fs.existsSync(p),
  listDirs = listDirectories,
} = {}) {
  const lines = ["---- python 探测现场（供定位，非报错）----"];
  lines.push(`执行账号: ${account}`);
  lines.push("PATH 条目:");
  for (const entry of String(env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)) {
    lines.push(`  ${entry}`);
  }
  const hits = [];
  for (const root of pythonInstallRoots(env, listDirs)) {
    if (existing(root)) hits.push(...listDirs(root));
  }
  lines.push("常见安装位置在盘上的（有则说明装过、只是这个账号 PATH 里没有）:");
  if (hits.length === 0) {
    lines.push("  （一个都没找到 —— 更像「这台机真的没装」）");
  } else {
    for (const hit of hits) lines.push(`  ${hit}`);
  }
  lines.push("----------------------------------------");
  return lines;
}

/**
 * 当前执行账号（Windows 上取 WindowsIdentity，其余取 uid + user）。
 *
 * @returns {string}
 */
export function currentAccount() {
  if (process.platform !== "win32") {
    return `${process.env.USER ?? process.env.USERNAME ?? "?"} (uid ${process.getuid?.() ?? "?"})`;
  }
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "[System.Security.Principal.WindowsIdentity]::GetCurrent().Name",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return (r.stdout ?? "").trim() || "(取不到)";
}

/**
 * 列出一个目录下的**子目录**全名（安装根那一层要的是版本目录，不是一个具体文件）。
 *
 * 列出一个目录下的**子目录**全名（安装根那一层要的是版本目录，不是一个具体文件）。
 *
 * @param {string} root
 * @returns {string[]}
 */
function listDirectories(/** @type {string} */ root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name));
  } catch {
    return [];
  }
}

/**
 * 缺 Python 时按序试**三条真装通道**并**就地装**（Windows / POSIX 各一套）。
 *
 * 头注见本文件开头：「为什么是三条通道」与「装完必须复验」。
 *
 * @param {{run?: (cmd: string, args: string[]) => RunResult,
 *          env?: Record<string, string | undefined>,
 *          platform?: NodeJS.Platform,
 *          existing?: (p: string) => boolean,
 *          findExe?: (env: Record<string, string | undefined>) => string | null,
 *          mkdir?: (p: string) => void,
 *          download?: (url: string, dest: string) => void,
 *          unzip?: (zip: string, dest: string) => void,
 *          cwd?: string,
 *          listDirs?: (p: string) => string[],
 *          findExeUnder?: (root: string) => string | null}} [options]
 * @returns {{installed: boolean, path: string | null, reason: string | null,
 *            channel?: string | null, attempts?: string[]}}
 */
export function installPython({
  run: runCmd = run,
  env = process.env,
  platform = process.platform,
  existing = (/** @type {string} */ p) => fs.existsSync(p),
  /* 「装完找解释器」这一步读真 fs。给它一个注入面：真实现扫安装根，
   * 判据里注入一个**确定**的替身 —— 否则「探过哪两条 scope」会取决于
   * 跑判据的那台机器上碰巧有没有装 Python（本文件最初就踩了这格）。 */
  findExe = findExeUnderAllRoots,
  /* 「在某个 root 下找一个解释器」—— 与上面那个是**两层**：`findExe` 回答
   * 「这台机器上有没有」（扫全部安装根），这个回答「这个目录下有没有」。
   * `scoop` 通道按落点逐个问它，所以它**必须**是一个独立注入面：
   * 少了它，那一半会绕过 `findExe` 直取模块实现去读真 fs，判据的结论于是
   * 又变成「跑判据那台机器上碰巧有什么」。 */
  findExeUnder: findUnder = findExeUnder,
  listDirs = listDirectories,
  mkdir = (/** @type {string} */ p) => fs.mkdirSync(p, { recursive: true }),
  download = downloadFile,
  unzip = unzipArchive,
  cwd = process.cwd(),
} = {}) {
  /* 非 Windows：只有**认得出**包管理器时才动手，认不出就如实说「请自行安装」——
   * 猜一个可能不存在的包管理器（或替人 `sudo`）比不打这一枪更糟：无人值守的流水线里
   * 一次权限提示就是一次挂死，而本地开发机上「装一个系统 Python」不该由测试入口替人决定。 */
  if (platform !== "win32") {
    return installPythonPosix({ run: runCmd, platform });
  }
  /* **按序三条通道**，找到一条能用的就停（#1959 第三轮）。为什么不是一句
   * `winget install`：实测这台节点上它按用户装走不通（msstore 源没达成协议 /
   * `--accept-msstore-source-agreements` 要管理员），而只留「平台侧人工动作」
   * 一条出口时，连「装了但没进 PATH」那一档都还没被排除。三条各自把断点写进
   * `attempts` 逐条打印，不糊成一句「装不上」。 */
  const attempts = [];
  for (const channel of [
    () =>
      viaWinget({
        run: runCmd,
        env,
        platform,
        findExe,
        findExeUnder: findUnder,
        impl: installViaWinget,
        listDirs,
        existing,
      }),
    () => viaScoop({ run: runCmd, env, existing, findExeUnder: findUnder }),
    () => viaEmbed({ env, existing, mkdir, download, unzip, cwd }),
  ]) {
    const result = channel();
    attempts.push(result.reason ?? "(无说明)");
    if (result.path) return { ...result, installed: true, attempts };
  }
  return {
    installed: false,
    path: null,
    channel: null,
    reason: `三条通道都没装出可用的解释器：${attempts.join("；")}`,
    attempts,
  };
}

/**
 * 通道 1：`winget`（能过就走它，最省事）。实现是上游那一套 —— 按**一串落点**找
 * `winget`、再按 `user` / `machine` 两个 scope 各试一次；本函数只把它包成「通道」
 * 的形状（`{path, channel, reason}`），逻辑不重写。
 *
 * @param {{run: (cmd: string, args: string[]) => {ok: boolean, out: string},
 *          env: Record<string, string | undefined>,
 *          platform: NodeJS.Platform,
 *          findExe: (env: Record<string, string | undefined>) => string | null,
 *          findExeUnder: (root: string) => string | null,
 *          listDirs: (p: string) => string[],
 *          existing: (p: string) => boolean,
 *          impl: (input: {run: (cmd: string, args: string[]) => RunResult,
 *                          env: Record<string, string | undefined>,
 *                          platform: NodeJS.Platform,
 *                          findExe: (env: Record<string, string | undefined>) => string | null,
 *                          findExeUnder: (root: string) => string | null,
 *                          listDirs: (p: string) => string[],
 *                          existing: (p: string) => boolean}) => {installed: boolean,
 *                                                            path: string | null,
 *                                                            reason: string | null}}} ctx
 */
function viaWinget({
  run: runCmd,
  env,
  platform,
  findExe,
  findExeUnder,
  impl,
  listDirs,
  existing,
}) {
  const r = impl({
    run: runCmd,
    env,
    platform,
    findExe,
    findExeUnder,
    listDirs,
    existing,
  });
  return {
    path: r.path,
    channel: "winget",
    reason: r.path ? null : (r.reason ?? "winget 通道未给出原因"),
  };
}

/**
 * 上游那段 winget 安装逻辑 —— 名字带 `installViaWinget` 是为了让「通道壳 ⇄ 实现」
 * 的关系在调用点一眼看得出来（`installPython` 的 `impl: installViaWinget`）。
 *
 * @param {{run: (cmd: string, args: string[]) => {ok: boolean, out: string},
 *          env: Record<string, string | undefined>,
 *          findExe: (env: Record<string, string | undefined>) => string | null,
 *          findExeUnder: (root: string) => string | null,
 *          listDirs?: (p: string) => string[],
 *          existing?: (p: string) => boolean}} input
 * @returns {{installed: boolean, path: string | null, reason: string | null}}
 */
function installViaWinget({
  run: runCmd,
  env,
  findExe,
  findExeUnder,
  listDirs = listDirectories,
  existing = (/** @type {string} */ p) => fs.existsSync(p),
}) {

  /**
   * 判一个候选路径在不在盘上 —— 读不动（别人的 profile 常常权限不足）与不存在
   * 都当没有，不抛。落点是一串，这一步要逐个问。
   *
   * @param {string} p
   */
  const existsOnDisk = (p) => {
    try {
      return existing(p);
    } catch {
      return false;
    }
  };

  const winget = runCmd("winget", ["--version"]).ok
    ? "winget"
    : /* `winget` 常年在盘上却**不在这个会话的 PATH 上** —— `WindowsApps` 那条
       * 按用户追加的路径要新会话才生效，而构建步骤是一个刚落地的会话。
       * 所以除了 PATH 还要按落点再找一遍，找到就用绝对路径起它。
       * **落点是一串而不是一个**：winget 按用户装，而构建账号（实测是
       * `NT AUTHORITY\\SYSTEM`）的 profile 里结构上不可能有它 —— 只探本账号会把
       * 「找错 profile」报成「这台机没有 winget」。见 {@link wingetCandidates}。 */
      wingetCandidates(env, listDirs).find((p) => existsOnDisk(p)) ?? null;
  if (!winget) {
    return {
      installed: false,
      path: null,
      reason:
        "winget 不在 PATH 上，也不在任何一个落点上（本账号 / 其他账号 / 各盘 " +
        "%ProgramFiles% 的 WindowsApps）—— 这台节点没有可用的自动安装入口",
    };
  }
  const tried = [];
  for (const scope of ["user", "machine"]) {
    const r = runCmd(winget, [
      "install",
      "--id",
      "Python.Python.3.12",
      "--scope",
      scope,
      "--silent",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ]);
    if (!r.ok) {
      tried.push(`--scope ${scope} 失败（${firstLine(r.out)}）`);
      continue;
    }
    const found =
      findExe(env) ??
      /* 机器级安装会把解释器放到 Program Files，而**这个进程的 PATH 是安装前的** ——
       * 按安装根找不到时再按 winget 的链接目录找一次，别把刚装好的读成没装。
       *
       * ⚠️ **这一档走注入的 `findExeUnder`，不许直呼模块实现**：直呼等于在这条
       * 路径上留了**第二个通到真 fs 的口** —— 前面刚补齐的两层接缝（`findExe` /
       * `findExeUnder`）只堵住了各自的调用点，这一处漏掉的话，判据的结论仍然
       * 取决于「跑判据那台机上碰巧有没有 Python」。实测复现：造一个 winget 链接
       * 目录下**真有** `python.exe` 的形态，两个接缝**都**注入 `() => null` 之后
       * 仍然是 `installed: true`（path 指向那个真文件）。 */
      findExeUnder(
        path.join(env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links"),
      );
    if (found) return { installed: true, path: found, reason: null };
    tried.push(`--scope ${scope} 报成功，但安装根下找不到解释器`);
  }
  return {
    installed: false,
    path: null,
    reason: `winget 两条 scope 都试过，仍没拿到可用解释器：${tried.join("；")}`,
  };
}

/**
 * 官方 embed 包的固定版本号。
 *
 * 刻意**不取 latest**：这一步的读数（`== python ==` 那行的版本号）是要在两次构建之间
 * 比对的，而「某天 latest 换了」会让同一个提交在两台节点上装出两个不同的 Python。
 */
export const PYTHON_EMBED_VERSION = "3.12.8";

/**
 * 通道 2：`scoop install python`（开发机常见，按用户、无管理员）。
 *
 * @param {{run: (cmd: string, args: string[]) => {ok: boolean, out: string},
 *          env: Record<string, string | undefined>,
 *          existing: (p: string) => boolean,
 *          findExeUnder: (root: string) => string | null}} ctx
 * @returns {{path: string | null, channel: string, reason: string | null}}
 */
function viaScoop({ run: runCmd, env, existing, findExeUnder: findExe }) {
  if (!runCmd("scoop", ["--version"]).ok) {
    return { path: null, channel: "scoop", reason: "盘上没有 scoop" };
  }
  const r = runCmd("scoop", ["install", "python"]);
  if (!r.ok) {
    return {
      path: null,
      channel: "scoop",
      reason: `scoop 安装失败：${firstLine(r.out)}`,
    };
  }
  // scoop 的默认落点不在 `findExeUnderAllRoots()` 的覆盖面里，单独找一遍。
  const userProfile = env.USERPROFILE ?? env.HOME ?? "";
  for (const root of [
    path.join(userProfile, "scoop", "shims"),
    path.join(userProfile, "scoop", "apps", "python", "current"),
  ]) {
    const candidate = path.join(root, "python.exe");
    if (existing(candidate)) {
      return { path: candidate, channel: "scoop", reason: null };
    }
    const found = findExe(root);
    if (found) return { path: found, channel: "scoop", reason: null };
  }
  return {
    path: null,
    channel: "scoop",
    reason: "scoop 报安装成功，但找不到解释器",
  };
}

/**
 * 通道 3：按需下载官方 embed 包解到**检出本地**（前两条都够不着时的兜底）。
 *
 * 这是本节点上唯一真跑通过的一条 —— 不碰系统、不需要管理员、不依赖任何包管理器。
 * 本仓只需要解释器本身（`zipfile` / `json` 都是标准库），所以 embed 包**不带 pip**
 * 也不影响。落点固定（`python-embeded/`），装了就不再下第二遍。
 *
 * @param {{env: Record<string, string | undefined>,
 *          existing: (p: string) => boolean,
 *          mkdir: (p: string) => void,
 *          download: (url: string, dest: string) => void,
 *          unzip: (zip: string, dest: string) => void,
 *          cwd: string}} ctx
 * @returns {{path: string | null, channel: string, reason: string | null}}
 */
function viaEmbed({ env, existing, mkdir, download, unzip, cwd }) {
  const root = path.join(cwd, "python-embeded");
  const exe = path.join(root, "python.exe");
  if (existing(exe)) return { path: exe, channel: "embed", reason: null };
  const zip = path.join(
    env.TEMP ?? env.TMP ?? root,
    `python-${PYTHON_EMBED_VERSION}-embed-amd64.zip`,
  );
  const url = `https://www.python.org/ftp/python/${PYTHON_EMBED_VERSION}/python-${PYTHON_EMBED_VERSION}-embed-amd64.zip`;
  try {
    mkdir(root);
    download(url, zip);
    unzip(zip, root);
  } catch (e) {
    return {
      path: null,
      channel: "embed",
      reason: `embed 包下载/解压失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return existing(exe)
    ? { path: exe, channel: "embed", reason: null }
    : { path: null, channel: "embed", reason: `embed 包解出来没有 ${exe}` };
}

/**
 * 真下一份文件（落盘）。
 *
 * **用 `curl.exe` 而不是 `node:https`**：本模块的所有外部动作都走同一个同步 `run()`
 * （见文件头「它为什么自己起子进程」），而下载要么把这套改成异步、要么自己驱动流 ——
 * 两者都会让这一步多一层与「工具链自证」本身无关的失败面。`curl.exe` 是 Windows 10
 * 1803 起的系统自带件，与 `tar` 同一档可得性。
 *
 * `-L` 跟随重定向（python.org 的下载链接会 302 到 CDN），`--fail` 把 4xx/5xx 变成
 * 非零退出（否则错误页会被当成 zip 存下来，失败推迟到解压那一步、报错指不到真因）。
 *
 * @param {string} url
 * @param {string} dest
 */
export function downloadFile(url, dest, { run: runCmd = run } = {}) {
  const r = runCmd("curl", [
    "-L",
    "--fail",
    "--silent",
    "--show-error",
    "-o",
    dest,
    url,
  ]);
  if (!r.ok) throw new Error(r.out || `curl 下载失败（${url}）`);
}

/**
 * 解一个 zip 到目标目录（`tar` 在 Windows 10+ 自带，且认 zip）。
 *
 * @param {string} zip
 * @param {string} dest
 */
function unzipArchive(zip, dest) {
  const r = run("tar", ["-xf", zip, "-C", dest]);
  if (!r.ok) throw new Error(r.out || "tar -xf 解压失败");
}

/**
 * POSIX 上的安装分支：macOS 只认 `brew`，Linux 在 `apt-get` / `dnf` / `apk` 里挑
 * **第一个真存在**的；一个都没有就返回「请自行安装」而不是去猜。
 *
 * 刻意**不调 `sudo`**：本入口有两个消费方 —— 自托管节点（无人值守）与本地开发机
 * （人的会话）。前者遇到权限提示就是挂死，后者不该被测试入口替它做系统级决定；
 * 权限那一层归平台侧的人（规范 §13.5.3.5）。
 *
 * @param {{run: (cmd: string, args: string[]) => {ok: boolean, out: string}, platform: NodeJS.Platform}} input
 * @returns {{installed: boolean, path: string | null, reason: string | null}}
 */
function installPythonPosix({ run: runCmd, platform }) {
  /** 元组是 `[命令, 判断它在不在时带的参数, 真要装时带的参数]` ——
   *  `apt-get --version` 与 `apt-get install -y python3` 是两件事，别糊成一个数组。 */
  /** @type {Array<[string, string[], string[]]>} */
  const plans =
    platform === "darwin"
      ? [["brew", ["--version"], ["install", "python@3.12"]]]
      : [
          ["apt-get", ["--version"], ["install", "-y", "python3"]],
          ["dnf", ["--version"], ["install", "-y", "python3"]],
          ["apk", ["--version"], ["add", "python3"]],
        ];
  for (const [cmd, probeArgs, args] of plans) {
    /* 用 `--version` 判它在不在，而不是 `shutil.which`：本脚本刻意只用
     * `node:child_process`（见文件头），少一层平台差异。 */
    if (!runCmd(cmd, probeArgs).ok) continue;
    const r = runCmd(cmd, args);
    if (!r.ok) {
      return {
        installed: false,
        path: null,
        reason: `${cmd} 安装失败（多半是没有权限 —— 本步刻意不替你 sudo）：${r.out}`,
      };
    }
    /* 装完**复验**：本进程的环境早于安装，PATH 不一定会自己刷新（Windows 上
     * 机器级安装要新会话才生效；POSIX 上包管理器装的多半已在 PATH 上）。 */
    const after = findPython({ run: runCmd });
    return after
      ? { installed: true, path: after.path, reason: null }
      : {
          installed: true,
          path: null,
          reason: `${cmd} 退 0，但装完仍解析不到解释器（PATH 要新会话才刷新时属正常，重跑一次即可）`,
        };
  }
  return {
    installed: false,
    path: null,
    reason:
      platform === "darwin"
        ? "找不到 brew —— 请用 python.org 的安装包装 Python 3"
        : "apt-get / dnf / apk 都不在 —— 请用发行版的包管理器或 python.org 装 Python 3",
  };
}

/**
 * 第一条非空输出行（winget 的报错常常多行，取出最能说明问题的那一行）。
 *
 * @param {string} text
 * @returns {string}
 */
function firstLine(text) {
  return (
    String(text ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)[0] ?? "(无输出)"
  );
}

/**
 * 在所有常见安装根下找一个解释器（找第一个命中）。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
function findExeUnderAllRoots(env) {
  for (const root of pythonInstallRoots(env)) {
    const found = findExeUnder(root);
    if (found) return found;
  }
  return null;
}

/**
 * `winget` 的候选绝对路径 —— **按「本账号 → 其他账号 → 机器级」排列**。
 *
 * 只探**当前账号**的 `%LOCALAPPDATA%` 是不够的，这一条**已被节点自己的日志证伪**
 * （ISSUE #1959 第四轮）：那台机器的构建步骤跑在 `NT AUTHORITY\\SYSTEM` 下，而
 * `winget` 是**按用户**安装的 MSIX 别名 —— 它的落点在**装它的那个用户**的 profile
 * 下。`SYSTEM` 的 `%LOCALAPPDATA%` 是
 * `C:\\Windows\\system32\\config\\systemprofile\\AppData\\Local`，
 * 那里**结构上不可能**有它。于是「只探本账号」在日志上表现为「这台机没有 winget」，
 * 真因却是「找错了账号的 profile」—— 与 `pythonInstallRoots` 那一格是**同一个错认**
 * （见 {@link pythonForensics}），只是那次它红在**取证打印**上、这次红在
 * **查找本身**上。
 *
 * 修法沿用上面那套证据（{@link pathDrives} / {@link userRoots}），**不另写第二份
 * 落点清单** —— 两处问的是同一个问题，答案也该是同一份来源（现场那台把用户数据放在
 * `D:` 盘，用 PATH 反推正好拿到它，写死 `C:` 就会漏）。
 *
 * 三种「基」的拼法**不同**，所以分开拼而不是拿一个 base 套通用后缀：本账号的
 * `%LOCALAPPDATA%` 已经是 `…\\AppData\\Local`；其他账号还要补 `AppData\\Local`；
 * 机器级直接就在 `WindowsApps\\` 下。套通用后缀会把用户 profile 那几条拼成不存在的
 * 路径。找到谁的 `winget` 都能用：`--scope user` 装进的是**当前执行账号**的 profile，
 * 与那个 `winget.exe` 属于谁无关。
 *
 * @param {Record<string, string | undefined>} env
 * @param {(p: string) => string[]} [listDirs] 列目录（单测注入；默认真读 `fs`）
 * @returns {string[]} 候选路径（可能为空；调用方逐个判在不在盘上）
 */
export function wingetCandidates(env, listDirs = listDirectories) {
  /* 列目录一步**按「少几个候选」处理**：别人的 profile 常常读不动（权限），
   * 那不是这一步的失败 —— 本函数是导出的、注入的 `listDirs` 也可能自己抛，
   * 都当空。 */
  const profiles = userRoots(env).flatMap((root) => {
    try {
      return listDirs(root);
    } catch {
      return [];
    }
  });
  const bases = [
    // 本账号的 `%LOCALAPPDATA%` 本身就已经是 `…\\AppData\\Local`。
    env.LOCALAPPDATA,
    // 其他账号：`<盘>:\\Users\\<名>` 还要补 `AppData\\Local`。
    ...profiles.map((profile) => path.join(profile, "AppData", "Local")),
    // 机器级：`Program Files\\WindowsApps\\`。
    ...pathDrives(env).map((drive) => path.join(drive, "Program Files")),
    env.ProgramFiles,
  ];
  const out = [];
  for (const base of bases) {
    if (!base) continue;
    out.push(path.join(base, "Microsoft", "WindowsApps", "winget.exe"));
    out.push(path.join(base, "WindowsApps", "winget.exe"));
  }
  return [...new Set(out)];
}

/**
 * `winget` 在**本账号**用户级标准落点上的绝对路径（不在盘上时返回 `null`）。
 *
 * 保留这一条是因为「本账号的落点」仍然是最常见的那一档（人机同账号时它就是答案）；
 * 找不到时的完整回退链见 {@link wingetCandidates}。
 *
 * @param {Record<string, string | undefined>} env
 * @param {(p: string) => boolean} [existing] 盘上有没有它（单测注入；默认真 `fs`）
 * @returns {string | null}
 */
export function wingetAtStandardLocation(env, existing = fs.existsSync) {
  const base = env.LOCALAPPDATA;
  // 没有 `LOCALAPPDATA` 时**不**拼出一个相对路径来冒充绝对路径。
  if (!base) return null;
  const p = path.join(base, "Microsoft", "WindowsApps", "winget.exe");
  return existing(p) ? p : null;
}

/**
 * 在 `root` 下递归找 `python.exe`（找第一个）。
 *
 * @param {string} root
 * @returns {string | null}
 */
function findExeUnder(root) {
  if (!root || !fs.existsSync(root)) return null;
  for (const name of ["python.exe", "python3.exe"]) {
    const hit = walk(root, name);
    if (hit) return hit;
  }
  return null;
}

/**
 * 递归找一个文件名。
 *
 * @param {string} dir
 * @param {string} wanted
 * @returns {string | null}
 */
function walk(dir, wanted) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === wanted) return p;
    if (e.isDirectory()) {
      const hit = walk(p, wanted);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 挑一个**真能跑**的 Python（返回候选名与路径）。
 *
 * 「命令在」不等于「是可用解释器」：Microsoft Store 的占位别名 `python.exe` 在盘上、
 * `--version` 退非零 —— 那正是本步骤存在的理由（自证要回答的是「门禁要的那个解释器
 * 在不在」，不是「盘上有没有一个叫 python 的文件」）。所以要真起一次进程判退出码。
 */
export function findPython({
  run: runCmd = run,
  notes = /** @type {string[]} */ ([]),
} = {}) {
  for (const name of PY_CANDIDATES) {
    const args = PY_PROBE_ARGS[name] ?? ["--version"];
    const r = runCmd(name, args);
    if (r.ok) return { command: name, path: null, version: r.out };
    // 「在盘上但起不来」只说一句：它与「压根没装」的处置不同（换探测方式 vs 去装）。
    if (r.out) {
      notes.push(`${name} 在盘上但起不来（${r.out.split("\n")[0]}）`);
    }
  }
  return null;
}
