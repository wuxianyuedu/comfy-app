#!/usr/bin/env node
/**
 * ci-nsis-tool-probe.mjs — 把「作业里 bundler 到底去哪个目录找 makensis.exe」打成读数
 * （ISSUE #3297；恒退 0）。
 *
 * ## 它补的是哪一格
 *
 * 桌包档每一次都死在最后一格「打包·桌面成品构建」的 nsis 那一跳：
 *
 * ```
 * 原文第一行（bundler 自报要起的那条路径）：Running makensis to produce …\nsis\ComfyAPP_0.1.0_x64-setup.exe
 * 原文第二行（每次都停在这里）：Unable to start child process, error 0x2
 * ```
 *
 * 而它前面那一格「打包·桌包工具预置」逐字报 `√ 必需件齐全 → 不动任何东西`。
 * 两格对**同一棵树**给出互相矛盾的结论，仓里读不出答案：预置判的是
 * `resolveTauriCacheRoot()` 读 `%LOCALAPPDATA%` 拼出来的 `tauri\NSIS`，而 bundler
 * 走 `SHGetKnownFolderPath(FOLDERID_LocalAppData)`（规范 §7.7 早已记下「不读
 * `LOCALAPPDATA` 环境变量」）。普通会话里两者同值，`orange-runner`（LocalSystem）
 * 这一族未必。
 *
 * 本文件**只加读数、不改判据、不猜修法**：在工具预置之后、`pnpm tauri build` 之前
 * 把这三件事一次量出来（顺序与本单「期望」逐条对位）：
 *
 *   ① `ensure` 用的 `%LOCALAPPDATA%` 原值、以及它拼出来的 `tauri\NSIS` 落点；
 *   ② bundler 会用的 known folder（`[Environment]::GetFolderPath('LocalApplicationData')`
 *      —— 它就是 `SHGetKnownFolderPath` 的 .NET 面），以及那一处的 `tauri\NSIS` 落点；
 *   ③ 两处 `makensis.exe` 各自 `Test-Path` / `Length` / 真跑一次 `/VERSION` 的
 *      `$LASTEXITCODE` + 输出 / 整树文件数；外加两处是否同值。
 *
 * 评论补的两条读数判据也在这里落地：`0x2` 不等于「那个文件不在」（依赖 DLL 解析不到
 * 同码），所以不能只 `Test-Path`，得真跑一次并带上 `$LASTEXITCODE`；而
 * `NSIS_PLAN.required` 六件只是「bundler 会不会去重下」的判据、不是「完整」的判据，
 * 所以整树文件数要**独立数**，不复用 `missingRequired()` 的结论。
 *
 * ## 为什么是「读数」而不是判据
 *
 * 这一格要的是「下一次红就能定性」，不是「这次给它判过/判红」。两处不同值、或
 * `/VERSION` 跑不起来，都是**候选根因的读数**，处置（改 `resolveTauriCacheRoot` 口径
 * 还是查 ACL / 杀软）由人照读数定 —— 本单没有 Windows runner 可复现 spawn 那一层。
 * 与 `镜像身份` / `工作区复用读数` 同族：**恒退 0**，量不到也只如实记「没量到」，
 * 不冒充结论、不让桌包档多一处与它无关的红。
 *
 * ## 与兄弟脚本的边界（§12.18 复用优先）
 *
 *   · `scripts/tauri-tools-cache.mjs` —— 判「必需件齐不齐」并补缓存（有退码、会改盘）。
 *     本文件复用它的 `resolveTauriCacheRoot` 与 `NSIS_PLAN.cacheRel` 算**同一口径**的
 *     `ensure` 落点，不另抄一份路径推导；但**不**调 `missingRequired()`，因为那正是
 *     本单要独立复核的那一格结论。
 *   · 本文件 —— 只读、只量、只打印；不补缓存、不删树、不改 `NSIS_PLAN`、不改
 *     `resolveTauriCacheRoot`。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { NSIS_PLAN, resolveTauriCacheRoot } from "./tauri-tools-cache.mjs";

/**
 * 一次 PowerShell 把全部现场读数取回（**单个子进程**，不为每一问各起一次）。
 *
 * 输出是 `ConvertTo-Json -Compress` 的一行对象：中文路径 / 账号名都能原样回传，
 * Node 侧一个 `JSON.parse` 就够，不必逐行 `key=value` 正则（那一族遇到值里带 `=`
 * 或换行就分岔）。键名刻意全 ASCII —— 值里全是路径 / 数字 / 账号，不掺中文，
 * 所以这条读数自己不受 CP936 转码那一路的影响。
 *
 * `known` 侧落点完全由脚本里的 `[Environment]::GetFolderPath` 现算，不传进来 ——
 * 传进来就等于让 Node 替 bundler 猜一次 known folder，那正是本单要防的事。
 *
 * @param {{ensureDir: string | null}} roots `ensure` 侧 `tauri\NSIS` 落点
 * @returns {string} PowerShell 脚本原文
 */
export function probeScript(roots) {
  /* 落点以 JSON 字面量传进 PS：`ConvertFrom-Json` 读，避免把 Windows 路径里的
   * 反斜杠 / 引号拼进 PS 源码（那种拼法遇到 `'` 或 `$` 会当场改义）。 */
  const payload = JSON.stringify({
    ensure: roots.ensureDir,
    cacheRel: NSIS_PLAN.cacheRel,
    required: NSIS_PLAN.required,
  }).replaceAll("'", "''");
  return String.raw`
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$in = '${payload}' | ConvertFrom-Json

function Read-Tree([string] $nsisRoot) {
  $exe = if ($nsisRoot) { Join-Path $nsisRoot 'makensis.exe' } else { '' }
  $item = $null
  if ($exe) { try { $item = Get-Item -LiteralPath $exe -ErrorAction Stop } catch { } }
  $treeCount = -1
  if ($nsisRoot) {
    try { $treeCount = @(Get-ChildItem -LiteralPath $nsisRoot -Recurse -File -ErrorAction Stop).Count } catch { }
  }
  $versionOut = ''
  $versionExit = -1
  if ($item) {
    try {
      $versionOut = (& $exe /VERSION 2>&1 | Out-String).Trim()
      $versionExit = $LASTEXITCODE
    } catch {
      $versionOut = "(起不来: $($_.Exception.Message))"
      $versionExit = -1
    }
  }
  $aclOwner = ''
  if ($item) {
    try { $aclOwner = (Get-Acl -LiteralPath $exe).Owner } catch { $aclOwner = "(取不到)" }
  }
  $requiredMissing = @()
  if ($nsisRoot) {
    $requiredMissing = @(
      $in.required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $nsisRoot ($_ -replace '/', '\'))) }
    )
  }
  return @{
    exists = [bool]$item
    length = if ($item) { $item.Length } else { -1 }
    treeCount = $treeCount
    versionExit = $versionExit
    versionOut = $versionOut
    aclOwner = $aclOwner
    requiredMissing = $requiredMissing
  }
}

$knownLocal = [Environment]::GetFolderPath('LocalApplicationData')
$knownNsis = if ($knownLocal) { Join-Path (Join-Path $knownLocal 'tauri') $in.cacheRel } else { '' }
$account = ''
try { $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name } catch { $account = '(取不到)' }

@{
  knownLocalAppData = $knownLocal
  knownNsis = $knownNsis
  account = $account
  ensure = Read-Tree $in.ensure
  known = Read-Tree $knownNsis
} | ConvertTo-Json -Compress -Depth 8
`.trim();
}

/**
 * `readProbe` 的默认执行者（顶层 import `spawnSync`，保持模块顶层零副作用）。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{status: number | null, stdout: string, stderr: string, error: Error | null}}
 */
function defaultRun(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 120_000 });
  return {
    status: r.status,
    stdout: r.stdout === null ? "" : String(r.stdout),
    stderr: r.stderr === null ? "" : String(r.stderr),
    error: r.error ?? null,
  };
}

/**
 * 两处落点是否同一个目录（**不借 `path.resolve`**）。
 *
 * 那条按**当前进程平台**解释分隔符：Windows 上才认 `\`，而这一格在测试里会被注入
 * Windows 形状的路径、跑在 Linux 上（`path.resolve` 把 `C:\a\b` 当成一段文件名）。
 * 判「两处同值」要的是 Windows 语义，与 host 无关，所以自己归一：斜杠统一、去尾部分隔符、
 * 大小写不敏感（NTFS 默认不区分）。
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameWindowsPath(a, b) {
  /** @param {string} v @returns {string} */
  const norm = (v) =>
    String(v).replaceAll("/", "\\").replaceAll(/\\+/g, "\\").replace(/\\$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * 起一次 PowerShell 取现场读数。
 *
 * 宿主按 `pwsh` → `powershell` 的顺序试（与 `dev-drive-probe.mjs` 同一处置：
 * 自托管节点上装的是 Windows PowerShell 5.1，名字是 `powershell`）。
 *
 * @param {string} script
 * @param {{run?: (cmd: string, args: string[]) => {status: number | null, stdout?: string, stderr?: string, error?: Error | null}}} [io]
 * @returns {{ok: boolean, data: Record<string, unknown> | null, detail: string}}
 */
export function readProbe(script, io = {}) {
  const run = io.run ?? defaultRun;
  for (const shell of ["pwsh", "powershell"]) {
    const r = run(shell, ["-NoProfile", "-NonInteractive", "-Command", script]);
    const stdout = String(r.stdout ?? "").trim();
    if (r.error || r.status !== 0 || stdout === "") {
      continue;
    }
    try {
      /** @type {unknown} */
      const parsed = JSON.parse(stdout);
      if (isRecord(parsed)) {
        return { ok: true, data: parsed, detail: "" };
      }
      return { ok: false, data: null, detail: `${shell} 回了非对象 JSON` };
    } catch (error) {
      return {
        ok: false,
        data: null,
        detail: `${shell} 回了非 JSON：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return { ok: false, data: null, detail: "pwsh / powershell 都没跑起来或没回读数" };
}

/**
 * 是不是一个可按键读的对象（`no-unsafe-type-assertion` 要的守卫，不写 `as`）。
 *
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * 把一棵树的读数压成人读的一行（恒给得出，不因为某个字段缺就整行消失）。
 *
 * @param {string} label
 * @param {unknown} v
 * @returns {string}
 */
export function formatTree(label, v) {
  const o = isRecord(v) ? v : {};
  const missing = Array.isArray(o.requiredMissing) ? o.requiredMissing.map(String).join(", ") : "?";
  return (
    `[读数] ${label}：` +
    `Test-Path=${o.exists ?? "?"}·Length=${o.length ?? "?"}·整树文件数=${o.treeCount ?? "?"}·` +
    `/VERSION exit=${o.versionExit ?? "?"}·输出=${String(o.versionOut ?? "").trim() || "(空)"}·` +
    `缺必需件=${missing || "(无)"}·Owner=${o.aclOwner ?? "?"}`
  );
}

/**
 * 探针主体 —— **恒退 0**。
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   platform?: NodeJS.Platform,
 *   run?: (cmd: string, args: string[]) => {status: number | null, stdout?: string, stderr?: string, error?: Error | null},
 *   log?: (line: string) => void,
 * }} [io]
 * @returns {number} 恒 0
 */
export function nsisToolProbe(io = {}) {
  const env = io.env ?? process.env;
  const platform = io.platform ?? process.platform;
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));

  /* `ensure` 那一侧：复用 `tauri-tools-cache.mjs` 的同一份推导（§12.18），
   * 不另写 `path.join(env.LOCALAPPDATA, "tauri", "NSIS")`。 */
  const resolved = resolveTauriCacheRoot(env);
  const ensureDir = resolved.dir ? path.join(resolved.dir, NSIS_PLAN.cacheRel) : null;
  log(`[读数] ensure 侧 %LOCALAPPDATA%=${String(env.LOCALAPPDATA ?? "").trim() || "(未设)"}`);
  log(`[读数] ensure 侧落点来源=${resolved.from}`);
  log(`[读数] ensure 侧 tauri\\${NSIS_PLAN.cacheRel} 落点=${ensureDir ?? "(问不出)"}`);

  if (platform !== "win32") {
    log(
      "[读数] 非 Windows 宿主：known folder / makensis.exe / ACL 这一半没有对象，只留 ensure 侧读数",
    );
    log("[读数] 结论=没量到（这一格只在 Windows 桌包档上有意义）");
    return 0;
  }

  /* known folder 由 PowerShell 现场量（不读环境变量，与 bundler 同源）：
   * `[Environment]::GetFolderPath('LocalApplicationData')` 就是 `SHGetKnownFolderPath`
   * 的 .NET 封装。落点里的 `tauri\<cacheRel>` 与 ensure 侧同一个 `NSIS_PLAN`。 */
  const probe = readProbe(probeScript({ ensureDir }), { run: io.run });
  if (!probe.ok || !probe.data) {
    log(`[读数] 现场 PowerShell 没量到：${probe.detail}`);
    log("[读数] 结论=没量到（不据此判绿判红；下一次红回来读这一行）");
    return 0;
  }
  const d = probe.data;
  const knownLocal = String(d.knownLocalAppData ?? "").trim();
  const knownNsis = String(d.knownNsis ?? "").trim();
  log(`[读数] bundler known folder LocalApplicationData=${knownLocal || "(取不到)"}`);
  log(`[读数] bundler 侧 tauri\\${NSIS_PLAN.cacheRel} 落点=${knownNsis || "(取不到)"}`);
  log(`[读数] 进程账号=${String(d.account ?? "?")}`);
  const same =
    ensureDir && knownNsis
      ? sameWindowsPath(ensureDir, knownNsis)
        ? "是"
        : "**否**"
      : "没法比（有一侧问不出）";
  log(`[读数] 两处落点是否同值=${same}`);
  log(formatTree("ensure 侧 makensis.exe", d.ensure));
  log(formatTree("bundler 侧 makensis.exe", d.known));
  log(
    "[读数] 结论=以上全是读数，不判绿判红；两处不同值或 /VERSION 跑不起来 ⇒ 照本单期望分叉定处置",
  );
  return 0;
}

/* 直接执行才跑；判「是不是直接执行」用两侧 `path.resolve` 比较（与仓内那批
 * `main guard` 同一条：Windows 上拼 `file://` 会恒不相等）。 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(nsisToolProbe());
}
