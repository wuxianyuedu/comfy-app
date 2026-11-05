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
 *   node scripts/ci-toolchain-selfcheck.mjs --rust-only   只答 Rust/cargo 那一格（打桌包之前那一步）
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

/* Python 那一层（候选探测 / 三条装通道 / 安装根 / winget 落点）在
 * `./ci-toolchain-python.mjs` —— 拆出去是按 §12.6 R5 的取向：本文件涨到 900 行以上，
 * 而那份是**机制**、本文件是**编排与打印**。两边的界线：本文件回答「这台机器够不够跑
 * 门禁链」，那份回答「哪个解释器能跑、弄不到时怎么弄到手」。 */
import { findPython, installPython, pythonForensics } from "./ci-toolchain-python.mjs";
/* 浏览器那一层（落点 / 复验 / 装）在 `./ci-toolchain-browser.mjs` —— 拆出去的边界与
 * `ci-toolchain-python.mjs` 相同：本文件回答「这台机器够不够跑门禁链」，
 * 那份回答「浏览器在不在、弄不到时怎么弄到手」。两件注入面（`find` / `exec`）
 * 由这里传进去 —— pnpm 那份探测在 `./ci-toolchain-pnpm.mjs`（§12.18：不造第二轮子）。 */
import {
  browserExecutableExists,
  httpDownloadProbe,
  pickPlaywrightRoots,
  playwrightBrowsersRoot,
  playwrightDownloadRoots,
  playwrightInstallHints,
  playwrightOnly as playwrightOnlyImpl,
  runPlaywrightInstall,
} from "./ci-toolchain-browser.mjs";

/* pnpm 那一层（PATH 读法 / 候选形态 / 可用性判 / 取证）在 `./ci-toolchain-pnpm.mjs` ——
 * 拆出去的边界与 `ci-toolchain-python.mjs` 相同：本文件回答「这台机器够不够跑门禁链」，
 * 那份回答「pnpm 在哪、探不到时现场长什么样」。拆的边界按职责不按长度（§12.6 R5）。 */
import { findPnpm, isFileOnDisk, pnpmForensics, pnpmPathValue } from "./ci-toolchain-pnpm.mjs";

/**
 * `engines.node` 的区间 —— `package.json` 里今天写的是 **`>=26.12.1`**
 * （2026-10-27 由 `#2531` / `#2532` 从 `^22.22.2 || ^24.15.0 || >=26.0.0` 收紧过来的一档）。
 *
 * 抄成**闭区间**而不是「只记下界」：caret 的上界是要紧的，`24.14.9` 不在范围里而
 * `24.15.0` 在 —— 只比下界的话这一格会被读成「过」，而 Node 版本的 gate 恰好是
 * 那种**不报错、只让某几条用例以奇怪的方式红**的东西（`useTypeScriptCli` 的配对
 * 判据就见 `tests/turbopack-tracing-excludes.test.ts`）。
 *
 * `min` 含、`max` 不含；`max: null` = 无上界。
 *
 * ⚠️ 这一份必须与 `package.json` 的 `engines.node` **两侧同时改**：`ISSUE #2552` 的现场就是
 * 声明收紧之后这一份没跟着动 —— 那一格的读数是「Node 26.12.0 / 24.20.0 都被判过」，
 * 与声明逐字冲突。与 `package.json` 对账的那一处判据是
 * `tests/ci-toolchain-selfcheck.test.ts` 的「与 package.json 的 engines.node 对账」
 * （改了一侧另一侧会红，别把用例改成「反正过」）。
 */
const NODE_ENGINES = /** @type {Array<{min: number[], max: number[] | null}>} */ ([
  { min: [26, 12, 1], max: null },
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
    if (x !== y) {
      return x - y;
    }
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
/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} [downloadHost] 浏览器那一层的镜像根，只有那一步会带
 * @returns {{ok: boolean, out: string}}
 */
function run(cmd, args, downloadHost) {
  /* `downloadHost` 是浏览器那一层的镜像根（`PLAYWRIGHT_DOWNLOAD_HOST`），只有
   * 「装浏览器」那一步会带 —— 它必须**逐次**给到子进程的 env 上，而不是在这里
   * 设一次全局：`playwrightInstallHints()` 要能报出「这一次试的是哪个根」，
   * 而 Playwright 读的正是子进程的 `PLAYWRIGHT_DOWNLOAD_HOST`（见
   * `ci-toolchain-browser.mjs` 的 `playwrightHostsToTry`）。 */
  const env = downloadHost
    ? { ...process.env, PLAYWRIGHT_DOWNLOAD_HOST: downloadHost }
    : process.env;
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    windowsHide: true,
    env,
  });
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout / stderr 实测为 undefined，@types/node 按 string 标
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
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- text 是组件自己测出来的版本串（外部输入），类型按 string 标窄
  const m = /(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)/.exec(text ?? "");
  if (!m) {
    return null;
  }
  return {
    major: Number(m.groups?.major ?? 0),
    minor: Number(m.groups?.minor ?? 0),
    patch: Number(m.groups?.patch ?? 0),
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
    ({ min, max }) => cmpVersion(trip, min) >= 0 && (max === null || cmpVersion(trip, max) < 0),
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
  for (const line of attempt.attempts ?? []) {
    console.log(`  · ${line}`);
  }
  if (attempt.path) {
    console.log(`（${attempt.channel} 通道报了路径，复验中）`);
  }
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
  const python =
    findPython({
      notes: /** @type {string[]} */ (/** @type {unknown} */ (notes)),
    }) ?? installAndReverify();
  if (python) {
    console.log(`python : ${python.path ?? python.command} ${python.version}`.trim());
    return 0;
  }
  for (const line of pythonForensics()) {
    console.log(line);
  }
  console.error(
    "\n这一档要用的解释器不在：假 comfy-cli 是一个 Python 包，主链路的两条 " +
      "@critical 用例会各报一遍「执行器收口失败」，而报错不指向这一行。" +
      "下一动作见上面那份取证（§13.5.3.5）。",
  );
  return 1;
}

/**
 * 「cargo 到底在哪」的取证（失败时打；成功即静默，与 `pythonForensics` 同形）。
 *
 * 为什么这一格也要有（ISSUE #2549）：桌包那一档的第二格今天只打了
 * `(cargo 不可用)` 五个字就退 1，而这台机上 cargo 明明装着 —— 差的是
 * **执行账号**（runner 是服务账号会话，`CARGO_HOME` 与它那只 `Path` 都是用户级的）。
 * 「这个账号看不见」与「这台机没装」在那一句里逐字同形，处置却完全相反。
 *
 * @param {{platform?: NodeJS.Platform,
 *          env?: Record<string, string | undefined>,
 *          isFile?: (p: string) => boolean}} [options]
 * @returns {string[]}
 */
export function cargoForensics({
  platform = process.platform,
  env = process.env,
  isFile = isFileOnDisk,
} = {}) {
  const lines = ["---- cargo 探测现场（供定位，非报错）----"];
  lines.push(`platform: ${platform}`);
  /* `PATH` 的读法**只有一份**（`pnpmPathValue`）：取证再读一遍会在「键名不是 PATH」
   * 与「分隔符读错」这两类成因上分岔（ISSUE #2281 的同一条）。 */
  const raw = pnpmPathValue({ platform, env });
  lines.push(
    raw.trim()
      ? `PATH 原文（${raw.length} 字符）：${raw}`
      : "PATH 原文：（空 —— 这个进程的变量表里没有 PATH，或键名是别的写法）",
  );
  for (const key of ["CARGO_HOME", "RUSTUP_HOME"]) {
    const value = String(env[key] ?? "").trim();
    lines.push(
      value
        ? `${key}：${value}`
        : `${key}：（这一格的变量表里没有它 —— 只按名字探 cargo 的那一类格在它缺席时必然落空）`,
    );
  }
  const cargoHome = String(env.CARGO_HOME ?? "")
    .trim()
    .replace(/^"(?<inner>.*)"$/, "$<inner>");
  if (cargoHome) {
    /* 候选扩展名**串行拼接**：`.exe` 排在无扩展名之前 —— 写成 `["", ".exe"]` 时无扩展名
     * 那个候选（`cargo`）会先入列，去重之后 `.exe` 那一份反而被挡掉，于是「盘上有哪个代理」
     * 这条读数指向一个**不带扩展名**的路径（Windows 上 `cargo` 不是可执行代理，`cargo.exe`
     * 才是）。`.EXE` 仍然在列：它不是第二个候选，而是用例要判的那一格（大小写不敏感 ⇒ 只算一个）。 */
    const exts = platform === "win32" ? [".exe", ".EXE", ""] : [""];
    /* Windows 的文件系统不分大小写 ⇒ `.exe` / `.EXE` 会命中**同一个**文件；逐去重才不会
     * 把「一个代理」读成「两个候选」（那是另一种形式的噪声）。 */
    const seen = new Set();
    const hits = [];
    for (const ext of exts) {
      /* 按**目标平台**拼：这条判据在 POSIX 上判 win32 形态，用宿主的 `path.join` 会拼出
       * `G:\\.cargo/bin/cargo` —— 一个两种平台都不认的形状（用例那条断言就断在这里）。 */
      const sep = platform === "win32" ? "\\" : "/";
      const candidate = [cargoHome, "bin", `cargo${ext}`].join(sep);
      /* 去重**按目标平台**的大小写语义（不按宿主）：这条判据在 POSIX 上判 win32 形态，
       * 拿宿主的语义去比会把 Windows 那一格读成两个候选 —— 而那个结论只在 Windows 上
       * 才成立，这正是「在错误的平台上判出一条看起来像真的读数」。 */
      const key = platform === "win32" ? candidate.toLowerCase() : candidate;
      if (seen.has(key) || !isFile(candidate)) {
        continue;
      }
      seen.add(key);
      hits.push(candidate);
    }
    lines.push(
      hits.length > 0
        ? `$CARGO_HOME\\bin 下命中的代理：${hits.join("、")}` +
            " —— **它在盘上，只是这一格的 PATH 上没有它**。修法是把这一对变量带进这一格" +
            "并把该目录前置到 PATH（`.cnb.yml` 里 `CARGO_HOME` / `RUSTUP_HOME` 必须成对给，" +
            "代理要 `RUSTUP_HOME` 才解析得到工具链，见 ISSUE #2192）。"
        : `盘上没有（限于 \`${cargoHome}\\bin\`）：要么工具链不在这台机上、要么 ` +
            "`CARGO_HOME` 这个值指错了地方。",
    );
  }
  lines.push("------------------------------------");
  return lines;
}

/**
 * 只答「Rust 工具链在不在」这一格（`.cnb.yml` 的 `打包·壳工具链自证`，ISSUE #2503）。
 *
 * 为什么这一档单独要有：`pnpm tauri build` 的编译段是整条链里唯一由 cargo 承担的一格，
 * 而缺件时的报错长在两分钟之后（`cargo: The term 'cargo' is not recognized` 混在 tauri
 * 自己的输出里，那一刻安装依赖的账已经花掉了）。本机实测那一段的墙钟：冷 5m01s ／
 * 暖 1m41s —— 先问一句是三秒，跑到一半才发现是两分钟起。
 *
 * 判据本身不重抄（`run()` / `section()` 是这份文件原有的），这里只是换一层壳（§12.18）。
 *
 * @returns {number}
 */
export function rustOnly() {
  section("rust");
  const cargo = run("cargo", ["--version"]);
  console.log(cargo.out || "(cargo 不可用)");
  if (!cargo.ok) {
    /* 「没装」与「这个执行账号看不见」在那一句里逐字同形（#2549 的现场：服务账号
     * 的 PATH 上没有 `G:\.cargo\bin`，而同一份脚本在开发者会话里是绿的）⇒ 先把
     * 这一格**看见了什么**摆出来，再去说下一动作那一句红话。 */
    for (const line of cargoForensics()) {
      console.log(line);
    }
    console.error(
      "\n打桌包那一档要有 cargo（`pnpm tauri build` 的编译段就是它）。这一跑不装任何东西：" +
        "壳工具链不是 pnpm 依赖，装它走 rustup，而它落在哪个账号的 PATH 上，" +
        "与上面 Python 那一格是同一条岔路（§13.5.3.5）。",
    );
    return 1;
  }
  const rustc = run("rustc", ["--version"]);
  console.log(rustc.out || "(rustc 不可用 —— cargo 在而 rustc 不在，工具链是残缺的)");
  return rustc.ok ? 0 : 1;
}

export function main() {
  /* 只答 Python 那一格（`.cnb.yml` 里 E2E 之前那一步用它）。 */
  if (process.argv.includes("--python-only")) {
    return pythonOnly();
  }
  /* 只答「打桌面成品包那一档要用的 Rust 工具链在不在」（ISSUE #2503）。 */
  if (process.argv.includes("--rust-only")) {
    return rustOnly();
  }
  /* 只答「Playwright 要用的浏览器在不在」（同一条链上更后面的那一格，见下）。 */
  if (process.argv.includes("--playwright-only")) {
    /* 两件注入面是本文件本来就有的判据与起进程那一步 —— 那份模块自己不 import
     * 仓库内任何东西（它的头注写着为什么）。 `--playwright-only` 那一步没有分节
     * 标题以外的输出需要，`section` 照常传下去。
     *
     * ⚠️ **`probe` 与 `pickRoots` 一个都不能省**（ISSUE #1959 第六跑）：这两件正对着
     * 「配着的下载根这台节点到不了、而日志里早就量到别的根是通的」那条缝 ——
     * 装那一步要**先量一次再决定试哪个根**。缺省值在 `playwrightOnly` 里是活的
     * （它自己会把 `probe` 绑进 `pickRoots`），但这两行**必须显式**写出来：
     * 让平台侧那条路上「量一次」这件事在源码里看得见，而不是靠缺省值猜。 */
    return playwrightOnlyImpl({
      find: findPnpm,
      exec: run,
      section,
      probe: httpDownloadProbe,
      pickRoots: pickPlaywrightRoots,
    });
  }

  section("OS");
  console.log(process.platform, process.arch, process.version);

  section("git");
  const git = run("git", ["-v"]);
  console.log(git.out || "(git 不可用)");
  if (!git.ok) {
    problems.push("git 不可用 —— 它是自托管机的基本依赖");
  }

  section("node");
  const node = run("node", ["-v"]);
  console.log(node.out || "(node 不可用)");
  const v = parseVersion(node.out);
  if (!node.ok || !v) {
    problems.push("node 不可用");
  } else if (!nodeAllowed(v)) {
    problems.push(`node ${node.out} 不在 engines.node 范围内（^22.22.2 || ^24.15.0 || >=26.0.0）`);
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
    })) {
      console.log(line);
    }
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
    console.log("未发现可用解释器，按序尝试三条安装通道（winget → scoop → 官方 embed 包）");
    python = installAndReverify();
  }
  if (python) {
    console.log(`python : ${python.path ?? python.command} ${python.version}`.trim());
  } else {
    /* 判定「真没装」之前，先把**这个执行账号看见了什么**摆出来 —— 这一跑就是取证现场。
     * 「装过但账号看不见」与「真的没装」在日志里逐字同形，处置却相反。 */
    for (const line of pythonForensics()) {
      console.log(line);
    }
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

  for (const note of notes) {
    console.log(`（${note}）`);
  }

  if (problems.length > 0) {
    console.error("\n工具链自证未通过：");
    for (const p of problems) {
      console.error(`  ✗ ${p}`);
    }
    console.error("\n清单与背景见 docs/standards/13-提交与-code-review.md §13.5.3.5。");
    process.exit(1);
  }
  console.log("\n工具链自证通过 ✓");
  return 0;
}

/* 只在被直接执行时跑 —— 单测要 import 上面那几个函数，import 不该顺手退进程。
 *
 * **判「是不是直接执行」必须走 `path.resolve(进程参数) ⇄ path.resolve(import.meta.filename)`，
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
 * `tests/script-main-guard.test.ts` 守着全仓不许再出现拼串的那一形态。
 *
 * ## ⚠️ 退出码必须**转出去**（ISSUE #1961，本文件自己的第二个坑）
 *
 * 这里此前是裸 `main();`，而 `main()` 的返回值就是退出码 —— 于是
 * `--python-only` / `--playwright-only` 里那些 `return 1` **全部被吞掉**，
 * 进程恒退 0。实测（本机）：把 `浏览器安装` 的复验指到一个空落点，它明明打了
 * 「`playwright install` 报了成功，但那一件二进制不在盘上」并 `return 1`，
 * **退出码仍是 0** —— 那一段话是给人看的，判据读的是退出码。
 *
 * 这与本文件反复在修的形态**是同一个**：「这一步报了绿」与「这一步做成了那件事」
 * 之间差的正是这一层。整机自证那条路侥幸避开了它（`main()` 内部用的是
 * `process.exit(1)`，见上面那段），而两个 `--xxx-only` 档走的就是 `return` ——
 * 也就是说 `Python 可用性` / `浏览器安装` 这两步**从来不会红**，恰好是它们存在
 * 的全部意义。修法只有一处：把返回值交给 `process.exit()`。
 *
 * 判据见 `tests/ci-toolchain-selfcheck.test.ts` 的「退出码真的转出去了」那一条。 */
/* 浏览器那一层原样转出去，保持既有调用方与用例的导入路径不变（与
 * `launcher-core/shell.mjs` 转出 `executable-resolve.ts` 那几个同形）。 */
export {
  browserExecutableExists,
  playwrightBrowsersRoot,
  playwrightDownloadRoots,
  playwrightInstallHints,
  runPlaywrightInstall,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main());
}
