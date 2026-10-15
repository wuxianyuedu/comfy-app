/**
 * 自托管节点上的「工具链自证」—— 流水线第一步，**必须能被 `node` 直接跑**。
 *
 * ## 为什么它是一份脚本，而不是 `.cnb.yml` 里的一段 PowerShell
 *
 * 那一步原先在 `.cnb.yml` 里就地写了 ~70 行 PowerShell：探 Python、缺失时用
 * `winget` 当场装、按安装根再找一遍。它红过一次，而**红的位置与它要回答的问题
 * 无关**（ISSUE #1959 第二轮首跑）—— 因为那段 PowerShell 里探的候选名与
 * `scripts/check-app-port-vectors.cjs` 那边**不是同一份**。判据的定义有两处，
 * 就会有两份答案；而那份配置**一条判据都测不到它**（`.cnb.yml` 只在平台上跑）。
 *
 * 收进本脚本之后：候选表来自 `src/lib/process/python-candidates.ts`（唯一一份），
 * 而本脚本**能被单测直接跑**（`tests/ci-toolchain-selfcheck.test.ts`）——
 * 平台侧那一步在合并前就有人验过，不再靠「推上去看看红不红」。
 *
 * ## 它判什么
 *
 * 宿主机上「门禁与 E2E 真正依赖的」那几件：git / node（在 `engines.node` 范围内）
 * / pnpm / Python（三处判据 + e2e 主链路都要它）。缺失时**非零退出**，并把
 * 「下一动作」打出来 —— 红要红在能指路的位置，不能只打几个版本号。
 *
 * ## 它为什么自己起子进程而不是 import `executable-resolve.ts`
 *
 * 可以 import（Node 24 默认类型擦除，本仓多处就是这么干的）。但这一步是**流水线第
 * 一步**：宿主机上 Node 版本不对、模块加载崩掉时，报错会落在一句 `Cannot find
 * module` 上，而那时真正要回答的「这台机器上有什么」一个都没答。所以工具链自证
 * 刻意只用 `node:child_process` 这一条最基础的路子 —— 它必须在「什么都还没装好」
 * 的机器上也能给出可读输出。候选名仍然只有一处事实源（下面的 `PY_CANDIDATES`）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
 * `engines.node` 的区间 —— `package.json` 里写的是
 * `^22.22.2 || ^24.15.0 || >=26.0.0`。
 *
 * 抄成**闭区间**而不是「只记下界」：caret 的上界是要紧的，`24.14.9` 不在范围里而
 * `24.15.0` 在 —— 只比下界的话这一格会被读成「过」，而 Node 版本的 gate 恰好是
 * 那种**不报错、只让某几条用例以奇怪的方式红**的东西（`useTypeScriptCli` 的配对
 * 判据就见 `tests/turbopack-tracing-excludes.test.ts`）。
 *
 * `min` 含、`max` 不含；`max: null` = 无上界（`>=26.0.0`）。
 * 与 `package.json` 同口径由 `tests/ci-toolchain-selfcheck.test.ts` 对账 —— 改了一侧
 * 另一侧会红，而不是让这条 gate 悄悄放过一个不该放的版本。
 */
const NODE_ENGINES =
  /** @type {Array<{min: number[], max: number[] | null}>} */ ([
    { min: [22, 22, 2], max: [23, 0, 0] },
    { min: [24, 15, 0], max: [25, 0, 0] },
    { min: [26, 0, 0], max: null },
  ]);

/**
 * 版本三元组比大小（`a < b` 为负）。
 *
 * @param {number[]} a
 * @param {number[]} b
 */
function cmpVersion(a, b) {
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** @type {string[]} */
const problems = [];
/** @type {string[]} */
const notes = [];

/**
 * 跑一条命令，返回 `{ ok, out }`；`ok` 判的是**退出码为 0**，不是「有没有抛」。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{ok: boolean, out: string}}
 */
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { ok: r.status === 0 && !r.error, out };
}

/**
 * 打一个小节标题。
 *
 * @param {string} title
 */
function section(title) {
  console.log(`== ${title} ==`);
}

/**
 * 版本号比大小（`v24.20.0` / `24.20.0` 都认）。
 *
 * @param {string} text
 * @returns {{major: number, minor: number, patch: number} | null}
 */
export function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text ?? "");
  if (!m) return null;
  return {
    major: Number(m[1] ?? 0),
    minor: Number(m[2] ?? 0),
    patch: Number(m[3] ?? 0),
  };
}

/**
 * 这个版本落不落在 `engines.node` 的任何一个区间里。
 *
 * `v` 取自 {@link parseVersion}（形如 `{major, minor, patch}`）。
 *
 * @param {{major: number, minor: number, patch: number}} v
 * @returns {boolean}
 */
export function nodeAllowed(v) {
  const trip = [v.major, v.minor, v.patch];
  return NODE_ENGINES.some(
    ({ min, max }) =>
      cmpVersion(trip, min) >= 0 && (max === null || cmpVersion(trip, max) < 0),
  );
}

/**
 * 挑一个**真能跑**的 Python（返回候选名与路径）。
 *
 * 「命令在」不等于「是可用解释器」：Microsoft Store 的占位别名 `python.exe` 在盘上、
 * `--version` 退非零 —— 那正是本步骤存在的理由（自证要回答的是「门禁要的那个解释器
 * 在不在」，不是「盘上有没有一个叫 python 的文件」）。所以要真起一次进程判退出码。
 */
export function findPython({ run: runCmd = run } = {}) {
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

/**
 * Windows 上 Python 的常见安装根 —— **取证与安装共用一份**。
 *
 * 比「我们指望它装在哪」多两个：`ProgramFiles(x86)` 与 machine-wide 的
 * `ProgramData\Python`。取证要覆盖「**别人**装在了哪」，而不只是我们自己去装的那个位置
 * —— 见下面的 {@link pythonForensics}。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function pythonInstallRoots(env) {
  return [
    path.join(env.LOCALAPPDATA ?? "", "Programs", "Python"),
    path.join(env.ProgramFiles ?? "", "Python"),
    path.join(env["ProgramFiles(x86)"] ?? "", "Python"),
    path.join(env.ALLUSERSPROFILE ?? "", "Python"),
  ].filter((p) => p.length > 0 && path.dirname(p) !== p);
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
 * 位置也没命中 ⇒ 才是这台机真没装（此时 `winget` 那条路是对的）。
 * 把这两条分岔打印出来，判读就不需要有人远程登进那台构建机。
 *
 * @param {{env?: Record<string, string | undefined>, account?: string, existing?: (p: string) => boolean, listDirs?: (p: string) => string[]}} [options]
 * @returns {string[]} 要逐行打印的取证内容
 */
export function pythonForensics({
  env = process.env,
  account = currentAccount(),
  existing = (p) => fs.existsSync(p),
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
  for (const root of pythonInstallRoots(env)) {
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

/** 当前执行账号（Windows 上取 WindowsIdentity，其余取 uid + user）。 */
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
 * 列出目录下的**子目录**全名（取证用：我们要看的是版本目录，不是一个具体文件）。
 *
 * @param {string} root
 * @returns {string[]}
 */
function listDirectories(root) {
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
 * 缺 Python 时按默认安装根再找一遍并**就地装**（Windows / `winget`，按用户，
 * 不需要管理员）。
 *
 * 自托管最大的成本是「这台机器要自己维护」，而它**不会因为少装了什么就报错**
 * （表现是某几条判据以「探测不到」的名义静默退出比对）。所以这里既判也装 ——
 * 但装完仍找不到就非零退出：**红是对的**，让机器自己修好它只是省一遍人工。
 *
 * 本进程的环境早于安装，所以装完要按安装根直接找可执行文件，不指望 PATH 自己刷新。
 */
export function installPython({ run: runCmd = run, env = process.env } = {}) {
  if (process.platform !== "win32") {
    return {
      installed: false,
      path: null,
      reason: "非 Windows：请自行安装 Python 3",
    };
  }
  const winget = runCmd("winget", ["--version"]).ok
    ? "winget"
    : /* `winget` 常年在盘上却**不在这个会话的 PATH 上** —— `WindowsApps` 那条
       * 按用户追加的路径要新会话才生效，而构建步骤是一个刚落地的会话。
       * 所以除了 `Get-Command` 还要按标准落点再找一遍，找到就用绝对路径起它。
       * 少了这一条，「机器上明明有 winget」在这里会被读成「没有」。 */
      wingetAtStandardLocation(env);
  if (!winget) {
    return {
      installed: false,
      path: null,
      reason:
        "winget 不在 PATH 上，也不在标准落点（%LOCALAPPDATA%\\Microsoft\\WindowsApps）",
    };
  }
  const r = runCmd(winget, [
    "install",
    "--id",
    "Python.Python.3.12",
    "--scope",
    "user",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements",
  ]);
  if (!r.ok) {
    return {
      installed: false,
      path: null,
      reason: `winget 安装失败：${r.out}`,
    };
  }
  for (const root of pythonInstallRoots(env)) {
    const found = findExeUnder(root);
    if (found) return { installed: true, path: found, reason: null };
  }
  return {
    installed: true,
    path: null,
    reason: "winget 报安装成功，但默认安装根下找不到解释器",
  };
}

/**
 * `winget` 在用户级标准落点上的绝对路径（不在盘上时返回 `null`）。
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

export function main() {
  section("OS");
  console.log(process.platform, process.arch, process.version);

  section("git");
  const git = run("git", ["-v"]);
  console.log(git.out || "(git 不可用)");
  if (!git.ok) problems.push("git 不可用 —— 它是自托管机的基本依赖");

  section("node");
  const node = run("node", ["-v"]);
  console.log(node.out || "(node 不可用)");
  const v = parseVersion(node.out);
  if (!node.ok || !v) {
    problems.push("node 不可用");
  } else if (!nodeAllowed(v)) {
    problems.push(
      `node ${node.out} 不在 engines.node 范围内（^22.22.2 || ^24.15.0 || >=26.0.0）`,
    );
  }

  section("pnpm");
  const pnpm = run("pnpm", ["-v"]);
  console.log(pnpm.out || "(pnpm 不可用)");
  if (!pnpm.ok) {
    problems.push("pnpm 不可用 —— 本仓门禁全走 pnpm（AGENTS 硬规则 1 禁 npm）");
  }

  section("python");
  /** @type {{command: string, path: string | null, version: string} | null} */
  let python = findPython();
  if (!python) {
    console.log("未发现可用解释器，尝试用 winget 当场装（按用户，无需管理员）");
    const attempt = installPython();
    if (attempt.path) {
      python = { command: attempt.path, path: attempt.path, version: "" };
    } else {
      notes.push(`自动安装未生效：${attempt.reason}`);
    }
  }
  if (python) {
    console.log(
      `python : ${python.path ?? python.command} ${python.version}`.trim(),
    );
  } else {
    /* 判定「真没装」之前，先把**这个执行账号看见了什么**摆出来 —— 这一跑就是取证现场。
     * 「装过但账号看不见」与「真的没装」在日志里逐字同形，处置却相反。 */
    for (const line of pythonForensics()) console.log(line);
    problems.push(
      "宿主机上没有可用的 Python（试过 " +
        PY_CANDIDATES.join(" / ") +
        "）。门禁的 Python 侧会以「探测不到」的名义**静默退出比对**，" +
        "E2E 主链路的假 comfy-cli 也起不来。" +
        "先照上面那份取证分岔：**位置命中而命令探不到** ⇒ 这个执行账号的 PATH 里没有它" +
        "（python.org 安装包默认「Install for me only」只写安装者那个用户的 PATH）——" +
        "改这个账号的 PATH 或机器级重装，**别重复装**；" +
        "**位置也没命中** ⇒ 才是这台机真没装，装 Python 3 并确认它在 PATH 上" +
        "（用 python.org 安装包时勾选「Add python.exe to PATH」）。",
    );
  }

  for (const note of notes) console.log(`（${note}）`);

  if (problems.length > 0) {
    console.error("\n工具链自证未通过：");
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error(
      "\n清单与背景见 docs/standards/13-提交与-code-review.md §13.5.3.5。",
    );
    process.exit(1);
  }
  console.log("\n工具链自证通过 ✓");
  return 0;
}

/* 只在被直接执行时跑 —— 单测要 import 上面那几个函数，import 不该顺手退进程。 */
if (
  process.argv[1] &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`
) {
  main();
}
