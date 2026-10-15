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
import { statSync } from "node:fs";
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
 * `pnpm -v` 探到了什么 —— **不是**一句裸起名字的 `spawnSync` 能回答的（ISSUE #1961）。
 *
 * ## 为什么裸起一个名字在这里必然不够
 *
 * 本脚本刻意不 import 仓库内模块（见文件头），所以这里也得自己走一遍解析。
 * 而「自己走一遍」的形态**不能**是 `run("pnpm", ["-v"])` —— 那在 Windows 上
 * 与 `whichCommand()` 判的根本不是同一件事：
 *
 *   · Node 的 `spawn` **不认 PATHEXT**，也不解析 shebang：裸名字 `pnpm` 交给
 *     CreateProcess 时，corepack 摆在盘上那三个形态里**一个都用不上**
 *     —— 无扩展名 shim 是 `#!/usr/bin/env node`、`.CMD` 只有 cmd.exe 解释
 *     （Node 起它实测 `EINVAL`）、`.ps1` 要宿主；
 *   · 而**能被 Node 起起来的那一个恰好是 `.ps1`**，且它多半**不在 PATH 上**
 *     （corepack 装在 `%LOCALAPPDATA%\node\corepack\…`），
 *     连 `PATHEXT` 都不含 `.PS1`（Windows 默认值从不含它）。
 *
 * 实测（自托管 Windows 节点 `cnb-t62-1k50merp0`）：这一步打的是
 * `== pnpm == (pnpm 不可用)` 而**同一台机器上 `pnpm install` 后来跑得好好的**
 * —— 于是一整条流水线在第 1 秒就停在一个**不成立的结论**上。
 *
 * 所以探测按 `whichCommand()` 的同一套判据走一遍（PATH × 扩展名候选 → 取第一个
 * **真的能起**的；`.CMD` 这类批处理在 Windows 上直接跳过，改用它旁边的 `.ps1`
 * 经宿主起）。这与 `src/lib/process/executable-resolve.ts` 是**两份实现**，
 * 理由与 Python 那边逐字相同（本脚本要能在「Node 模块链还没被证明可用」的机器上
 * 加载）；一致性由 `tests/ci-toolchain-selfcheck.test.ts` 对账。
 *
 * @param {{
 *   platform?: NodeJS.Platform,
 *   env?: Record<string, string | undefined>,
 *   isFile?: (p: string) => boolean,
 *   probeRun?: (cmd: string, args: string[]) => {command: string, args: string[], out: string} | null,
 *   host?: () => string | null}} [options]
 * @returns {{command: string, args: string[], out: string, ok: boolean, tried?: string[], hostFound?: boolean}}
 *          `command` / `args` 是**真正要 spawn 的形态**（宿主形态时 command 是宿主）；
 *          `ok: false` 时另带两条读数 —— `tried`（在盘上、但**没起起来**的候选，
 *          按尝试顺序）与 `hostFound`（解释器宿主在不在），给 `pnpmForensics()` 打。
 */
export function findPnpm({
  platform = process.platform,
  env = process.env,
  /* 落盘与起进程两个注入面 —— 单测要在 POSIX 上判 **Windows** 的形态
   * （`whichCommand` 那套判据同样是可注入的，理由见其 `probe` 注释）。 */
  isFile = isFileOnDisk,
  probeRun = runProbe,
  host = powershellHost,
} = {}) {
  /* 候选顺序与 `executableExts()` 同口径：能直接被 CreateProcess 起的在前，
   * `.PS1` 紧随（Node 起不了 shim / `.CMD` 时它是唯一出路），批处理垫底。
   * `.PS1` **无条件**在列：默认 PATHEXT 不含它，由它决定就是「永远选不出来」。 */
  const exts = pnpmCandidateExts(platform);
  /* ⚠️ 按**目标平台**的分隔符切，不按宿主的 `path.delimiter`：`platform` 是可注入的，
   * 而单测正是在 POSIX 上判 Windows 的形态。拿宿主那个 `:` 去切一串 `;` 分隔的
   * Windows PATH，会把整串当成**一条**目录 —— 每个候选都拼成不存在的路径，
   * 判据静默答「没有」（`ci-toolchain-python.mjs` 的 `pathDrives` 记过同一格）。 */
  /* 逐候选的结论 —— **只为失败时的读数收集**（成功即丢）。
   * 报「pnpm 不可用」时，日志里此前只有「PATH 上命中在哪几个目录」，回答不了
   * **下一个**问题：那几处命中里有哪个真的被试过、各自怎么败的。没有这条读数，
   * 下一个人只能再猜一轮修法 —— 而这条链上连着几轮的红都出在这条缝里，
   * 「候选全对、败在探它的方式」那一轮（`.ps1` 少收了 `-v`）尤其只有它照得出来。 */
  const tried = [];
  for (const dir of String(env.PATH ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, `pnpm${ext}`);
      if (!isFile(candidate)) continue;
      const usable = usablePnpm(candidate, {
        platform,
        probeRun,
        host,
        isFile,
      });
      if (usable) return { ...usable, out: `${usable.out}`.trim(), ok: true };
      tried.push(candidate);
    }
  }
  return {
    command: "pnpm",
    args: ["-v"],
    out: "",
    ok: false,
    /* 在盘上、但**一个都没起来**的候选（按尝试顺序）。 */
    tried,
    /* 解释器宿主在不在 —— `.ps1` 要 PowerShell 才起得来。它单独就能收口一整档猜测：
     * 「宿主都不在 ⇒ 这几个形态谁也解释不了」，不必再回去翻候选表。 */
    hostFound: Boolean(host()),
  };
}

/**
 * 「pnpm 到底在哪」的取证（失败时打；成功即静默，与 `pythonForensics` 同形）。
 *
 * 为什么需要它（ISSUE #1961 平台侧）：`findPnpm()` 落地之后那一步**仍然**报
 * `pnpm 不可用`，而**历史上**同一次构建里 `Install dependencies` 用
 * `pnpm install --frozen-lockfile` 是跑得通的。两次猜测（「谁解析名字」、
 * 「扩展名候选全不全」）都没修好它 —— 说明真正缺的不是又一条候选规则，而是
 * **一条读数**：这一步看到的 `PATH` 是什么、逐条命中在哪些目录上。
 *
 * 那台机上人答得出来而这里答不出来的，只可能是**执行上下文不同**（服务账号读的是
 * 机器 PATH、PowerShell 的 profile / node 进程的继承 PATH 不是同一份）。把 PATH
 * 逐条打出来，下一个人一眼就能判「是真没有，还是这个账号看不见」，而不是再猜一轮。
 *
 * 与 `pythonForensics` 同口径：`PATH` 条目 + 每个候选落点的命中情况。
 *
 * @param {{
 *   platform?: NodeJS.Platform,
 *   env?: Record<string, string | undefined>,
 *   isFile?: (p: string) => boolean,
 *   tried?: string[],
 *   hostFound?: boolean,
 * }} [options]
 * @returns {string[]}
 */
export function pnpmForensics({
  platform = process.platform,
  env = process.env,
  isFile = isFileOnDisk,
  tried = [],
  hostFound = false,
} = {}) {
  const lines = ["---- pnpm 探测现场（供定位，非报错）----"];
  lines.push(`platform: ${platform}`);
  lines.push("PATH 条目:");
  /* ⚠️ 按**目标平台**的分隔符切，不按宿主的 `path.delimiter`
   * （`ci-toolchain-python.mjs` 的 `pathDrives` 记过这一格：本机是 `:` 而 Windows
   * 是 `;`，拿宿主的切会把 `C:\...` 拆成 `C` 与 `\...`）。这条判据的 `platform`
   * 可注入 —— 单测正是在 POSIX 上判 Windows 的形态。 */
  const dirs = String(env.PATH ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean);
  for (const d of dirs) lines.push(`  ${d}`);
  /* 每个 PATH 目录里 `pnpm*` 的命中 —— 判的是「这个目录下真有这个名字吗」，
   * 不判它起不起得起来（那是 `findPnpm` 的事）。两者分开，人才能判出
   * 「名字在但起不来」与「名字根本不在」这一格分岔。 */
  lines.push("PATH 各目录里 pnpm* 的命中:");
  let hits = 0;
  for (const d of dirs) {
    /* 与 `findPnpm()` 共用同一份后缀表（一处定义）——判的是「这个目录下真有哪个形态」，
     * 与「选谁去起」是两件事。 */
    for (const ext of pnpmCandidateExts(platform)) {
      const candidate = path.join(d, `pnpm${ext}`);
      if (isFile(candidate)) {
        lines.push(`  ${candidate}`);
        hits += 1;
      }
    }
  }
  if (hits === 0) {
    lines.push(
      "  （一个都没命中 —— 这个执行账号的 PATH 上没有 pnpm 的任何形态）",
    );
  }
  /* 后半段是**这一跑真正的读数**：命中的候选里有哪些真被试过、以及有没有
   * 解释得了它们的宿主。没有它，「命中在盘上」与「起不来」之间那条缝就只能靠猜
   * —— 这条链上连着几轮的红都出在这条缝里。 */
  lines.push("在盘上但**没起起来**的候选（按尝试顺序）:");
  if (tried.length === 0) {
    lines.push("  （没有 —— 一个候选都没进到探测这一步）");
  } else {
    for (const c of tried) lines.push(`  ${c}`);
  }
  lines.push(
    hostFound
      ? "解释器宿主: 找到（PowerShell 在 PATH 上）"
      : "解释器宿主: **没找到** —— `.ps1` 要 PowerShell 才起得来；" +
          "它不在 PATH 上时，这几个形态谁也解释不了（这本身就是一条结论，" +
          "不必再回去翻候选表）",
  );
  lines.push("------------------------------------");
  return lines;
}

/**
 * `pnpm` 在 PATH 上可能的**形态后缀**（一处定义，`findPnpm` 与 `pnpmForensics` 共用）。
 *
 * 顺序与 `executableExts()` 同口径：能直接被 CreateProcess 起的在前，
 * `.PS1` 紧随（Node 起不了 shim / 批处理时它是唯一出路），批处理垫底。
 * `.PS1` **无条件**在列：默认 `PATHEXT` 不含它，由它决定就是「永远选不出来」。
 *
 * **刻意只写后缀、不写整名字面量**：本仓有一条判据
 * （`tests/dev-launcher-toolchain-gate.test.ts`）禁止 `scripts/**` 里写死 pnpm 的
 * 可执行名 —— 那正是「Windows 上选中 Node 起不来的批处理形态」这条缺陷的形态本身。
 * 这里表达的是**候选面**而不是「选谁」，所以按后缀拼出来：既是同一份事实，
 * 也不会被那条按文本扫的判据误伤（它剥行注释但不剥块注释）。
 *
 * @param {NodeJS.Platform} platform
 * @returns {string[]}
 */
function pnpmCandidateExts(platform) {
  return platform === "win32"
    ? ["", ".EXE", ".PS1", ".CMD", ".BAT", ".COM"]
    : [""];
}

/**
 * 这个候选**现在**起不起得来（与 `usableCommand()` 同口径的简化版）。
 *
 * Windows 上的批处理**不真起**（只有 cmd.exe 解释它，Node 起它必然 `EINVAL`），
 * 直接改用它旁边的 `.ps1` 经 PowerShell 宿主 —— 那正是 `siblingFallback()` 的形态。
 * `.ps1` 本身也要宿主，同样经 `powershellHost()` 找。
 *
 * @param {string} candidate
 * @param {{platform: NodeJS.Platform,
 *          probeRun: (cmd: string, args: string[]) => {command: string, args: string[], out: string} | null,
 *          host: () => string | null,
 *          isFile: (p: string) => boolean}} ctx
 * @returns {{command: string, args: string[], out: string} | null}
 */
function usablePnpm(candidate, { platform, probeRun, host, isFile }) {
  const ext = path.extname(candidate).toLowerCase();
  /* Windows 上「Node 起不起来」与形态强相关：
   *   · `.cmd` / `.bat` —— 批处理，Node 起不了（实测 EINVAL），**不真试**；
   *   · `.ps1` —— 要宿主，交给 `powershellHost()`；
   *   · 无扩展名 shim —— 是 `#!/usr/bin/env node`，libuv 不解析 shebang；
   *     起不来会自然落到下面的「真起一次」把它否掉。 */
  if (platform === "win32" && (ext === ".cmd" || ext === ".bat")) {
    return viaSiblingPs1(candidate, { host, probeRun, isFile });
  }
  if (platform === "win32" && ext === ".ps1") {
    const exe = host();
    if (!exe) return null;
    /* **探的参数必须带上**（`-v`）：`.ps1` 那一档判的是「这个垫片起了之后真能答出
     * 版本」，而不是「PowerShell 能加载它」。少了它，corepack 的 `pnpm.ps1` 收到
     * 空参数会打 usage 并**退非零**（实测 `pnpm` 裸跑 exit≠0、`pnpm -v` exit=0），
     * 于是 `runProbe` 判它「起不来」、唯一可用的形态被否掉，最后仍报
     * 「pnpm 不可用」—— 修完候选表却漏了探针参数，红的形状原地复现。 */
    return probeRun(exe, ps1Invocation(candidate, ["-v"]));
  }
  const direct = probeRun(candidate, ["-v"]);
  if (direct) return direct;
  /* 真起不来（无扩展名 shim 在 Windows 上就是这一档）时，同目录的 `.ps1` 是出路。 */
  return viaSiblingPs1(candidate, { host, probeRun, isFile });
}

/**
 * 同目录的 `<名字>.ps1`（去扩展名再拼，不是 `pnpm.CMD.ps1`）经宿主起。
 *
 * @param {string} candidate
 * @param {{probeRun: (cmd: string, args: string[]) => {command: string, args: string[], out: string} | null,
 *          host: () => string | null,
 *          isFile: (p: string) => boolean}} ctx
 * @returns {{command: string, args: string[], out: string} | null}
 */
function viaSiblingPs1(candidate, { host, probeRun, isFile }) {
  const ext = path.extname(candidate);
  const script = (ext ? candidate.slice(0, -ext.length) : candidate) + ".ps1";
  if (!isFile(script)) return null;
  const exe = host();
  if (!exe) return null;
  /* 同一条：探的参数一并交给垫片（见上面 `.ps1` 那一支的注释）。 */
  return probeRun(exe, ps1Invocation(script, ["-v"]));
}

/**
 * 起一次并收 stdout/stderr —— 退出码非零也算「起得来」不算（`-v` 报错即有输出）。
 *
 * 与上面 `run()` 的差别只有一个：这里的 `ok` 同时要求**真的起来了**
 * （`error` 为空），而不只是「退出码是 0」—— 这个函数要回答的正是「能不能起」。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{command: string, args: string[], out: string} | null}
 */
function runProbe(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.error || r.status !== 0) return null;
  return { command: cmd, args, out };
}

/**
 * `.ps1` 经宿主的完整参数（宿主前缀 + **探针要传的参数**）。
 *
 * 刻意**不接宿主可执行文件**：宿主由 `powershellHost()` 单独答，这里只给「宿主接什么」
 * （与 `src/lib/process/executable-resolve.ts` 的 `prefixArgs` 同形）。
 *
 * `args` 是**要紧的**那一半：`.ps1` 垫片的退出码取决于它收到什么参数
 * （`pnpm.ps1` 裸跑打 usage 并退非零、带 `-v` 才退 0），而 `runProbe` 以退出码判
 * 「起没起来」。只给宿主前缀、忘了把 `-v` 接上去，等于把唯一能用的形态判成起不来。
 *
 * @param {string} script
 * @param {string[]} [args] 垫片自己要收的参数（`-v`）
 * @returns {string[]}
 */
function ps1Invocation(script, args = []) {
  return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args];
}

/**
 * PowerShell 宿主（优先 pwsh 7，回退 Windows PowerShell）——`powershellHost()` 同口径。
 *
 * @returns {string | null}
 */
function powershellHost() {
  if (process.platform !== "win32") return null;
  for (const name of ["pwsh", "powershell"]) {
    for (const ext of [".EXE", ""]) {
      for (const dir of String(process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)) {
        const candidate = path.join(dir, name + ext);
        if (isFileOnDisk(candidate)) return candidate;
      }
    }
  }
  return null;
}

/**
 * 这个路径是不是一个**在盘上的普通文件**（读不动 / 是目录都当没有）。
 *
 * @param {string} p
 * @returns {boolean}
 */
function isFileOnDisk(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

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
  /* 走 `findPnpm()` 而**不是**裸 `run("pnpm", …)`：后者在 Windows 上问的
   * 不是同一个问题（见 `findPnpm` 的头注）—— 实测它会把一台 `pnpm install`
   * 跑得好好的机器判成「pnpm 不可用」，流水线于是停在一个不成立的结论上。 */
  const pnpm = findPnpm();
  console.log(pnpm.out || "(pnpm 不可用)");
  if (!pnpm.ok) {
    for (const line of pnpmForensics({
      tried: pnpm.tried,
      hostFound: pnpm.hostFound,
    }))
      console.log(line);
    problems.push(
      "pnpm 不可用 —— 本仓门禁全走 pnpm（AGENTS 硬规则 1 禁 npm）。" +
        "探的是 PATH × 扩展名候选（含 .ps1 与同目录回退），不是裸起一个名字；" +
        "若机器上确有 pnpm 而这里报没有，先在同一个执行账号下跑 " +
        "`pnpm -v` 与 `pnpm check:toolchain` 对比（两处判据不同源，见规范 §2.1.1）。",
    );
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
