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
 * 缺 Python 时它会**按平台挑一个安装器当场装**（Windows 是 `winget`，**机器级**
 * —— Runner 是服务账号，按用户装只写安装者的 PATH，那正是「人在自己会话里看得见、
 * 构建步骤一个都探不到」的成因；Linux 在 apt-get / dnf / apk 里挑第一个存在的，
 * 且**不替人 sudo**；macOS 只认 brew），装完**复验**：安装器退 0 不等于解释器已在
 * PATH 上。**装完仍找不到就非零退出 —— 红是对的**，让机器自己修好它只是省一遍人工。
 *
 * ## 两种调用形态
 *
 *   node scripts/ci-toolchain-selfcheck.mjs               整机自证（流水线第一步）
 *   node scripts/ci-toolchain-selfcheck.mjs --python-only 只答 Python 那一格（E2E 之前那一步）
 *
 * 后者不是第二套判据：它调的是同一份 `findPython` / `installPython` / `pythonForensics`，
 * 只是把「整机」那几格让给已经答过它的第一步（§12.18）。
 *
 * ## 它为什么自己起子进程而不是 import `executable-resolve.ts`
 *
 * 可以 import（Node 24 默认类型擦除，本仓多处就是这么干的）。但这一步是**流水线第
 * 一步**：宿主机上 Node 版本不对、模块加载崩掉时，报错会落在一句 `Cannot find
 * module` 上，而那时真正要回答的「这台机器上有什么」一个都没答。所以工具链自证
 * 刻意只用 `node:child_process` 这一条最基础的路子 —— 它必须在「什么都还没装好」
 * 的机器上也能给出可读输出。Python 那一层（候选表、三条装通道）已拆到
 * `./ci-toolchain-python.mjs`，那边同样不 import 仓库内模块。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* Python 那一层（候选探测 / 三条装通道 / 安装根 / winget 落点）在
 * `./ci-toolchain-python.mjs` —— 拆出去是按 §12.6 R5 的取向：本文件涨到 900 行以上，
 * 而那份是**机制**、本文件是**编排与打印**。两边的界线：本文件回答「这台机器够不够跑
 * 门禁链」，那份回答「哪个解释器能跑、弄不到时怎么弄到手」。 */
import {
  findPython,
  installPython,
  pythonForensics,
} from "./ci-toolchain-python.mjs";



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
 * 「既判也装」+ **装完复验**：三条通道走完，一律回到 `findPython()` 再探一遍。
 *
 * **不采信安装器的结论**是这一条的关键：安装器报成功、而解释器仍然起不来（解压坏了、
 * 杀软拦了、PATH 还没生效）都是真有的形态，而下一个人读的是 `== python ==` 那一行的
 * 版本号。所以判据只有 `findPython()` 那一个 —— 它与「这台机器有没有 Python」用的是
 * 同一个探针、同一张候选表。
 *
 * @returns {{command: string, path: string | null, version: string} | null}
 */
function installAndReverify() {
  const attempt = installPython();
  for (const line of attempt.attempts ?? []) console.log(`  · ${line}`);
  if (attempt.path) console.log(`（${attempt.channel} 通道报了路径，复验中）`);
  const python = findPython();
  if (python && attempt.channel) {
    notes.push(`Python 由 ${attempt.channel} 通道当场装上`);
  } else if (!python) {
    notes.push(`三条通道都未生效：${attempt.reason}`);
  }
  return python;
}

/**
 * 只答「Python 这一格」并据此退码 —— 给「E2E 依赖的解释器在不在」那一步用。
 *
 * 为什么不复用 `main()`：`main()` 判的是**整机**（git / node / pnpm / python 四件），
 * 那四件在流水线里已经由第一步答过；E2E 前那一步只关心一件事，重答一遍别的是噪音。
 * 两处的**判据本身**是同一份（`findPython` / `installPython` / `pythonForensics`），
 * 这里只是换一层壳（§12.18：不造第二套判据）。
 *
 * @returns {number}
 */
export function pythonOnly() {
  section("python");
  /** @type {{command: string, path: string | null, version: string} | null} */
  let python = findPython({
    notes: /** @type {string[]} */ (/** @type {unknown} */ (notes)),
  });
  if (!python) {
    python = installAndReverify();
  }
  if (python) {
    console.log(
      `python : ${python.path ?? python.command} ${python.version}`.trim(),
    );
    return 0;
  }
  for (const line of pythonForensics()) console.log(line);
  console.error(
    "\n这一档要用的解释器不在：假 comfy-cli 是一个 Python 包，主链路的两条 " +
      "@critical 用例会各报一遍「执行器收口失败」，而报错不指向这一行。" +
      "下一动作见上面那份取证（§13.5.3.5）。",
  );
  return 1;
}

export function main() {
  /* 只答 Python 那一格（`.cnb.yml` 里 E2E 之前那一步用它）。 */
  if (process.argv.includes("--python-only")) return pythonOnly();

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
  let python = findPython({
    notes: /** @type {string[]} */ (/** @type {unknown} */ (notes)),
  });
  if (!python) {
    console.log(
      "未发现可用解释器，按序尝试三条安装通道（winget → scoop → 官方 embed 包）",
    );
    python = installAndReverify();
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
        "python / py / python3" +
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

/* 只在被直接执行时跑 —— 单测要 import 上面那几个函数，import 不该顺手退进程。
 *
 * **判「是不是直接执行」必须走 `path.resolve(进程参数) ⇄ path.resolve(fileURLToPath(import.meta.url))`，
 * 不许拼 `file://${path.resolve(argv[1])}`**：`import.meta.url` 在 Windows 上是
 * `file:///F:/…/x.mjs`（三斜杠 + 正斜杠 + 盘符），而拼出来的那份是
 * `file://F:\…\x.mjs`（两斜杠 + 反斜杠）—— **两者恒不相等**，于是 `main()`
 * 一次都不跑、**退出码恒 0 且一行输出都没有**。
 *
 * 这不是推演：`工具链自证` 与 `Python 可用性` 两步在自托管 Windows 节点上因此
 * 双双变成空转（实测 runner 日志 `exit code: 0, duration: 544ms` 且零输出，
 * 而它们各自的第一行 `== OS ==` / `== python ==` 本该无条件打出来）。
 * 后果是**缺 Python 这件事在「最便宜的位置」报不出来**，一路滑到 18 分钟后的
 * `E2E 关键流程` 才以「执行器起不来」的形态暴露。
 *
 * 本仓已有三处（`check-merge-parents.mjs` / `check-merged-side-loss.mjs` /
 * `check-pending-merge-loss.mjs`）为此写了同一条注释，这里按同一份写法对齐；
 * `tests/script-main-guard.test.ts` 守着全仓不许再出现拼串的那一形态。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
