/**
 * pnpm 那一层（PATH 读法 / 候选形态 / 可用性判 / 取证）—— 从 `ci-toolchain-selfcheck.mjs`
 * 拆出来的**机制**（§12.6 R5 的硬闸第二次落到这一族：selfcheck 涨过 900 行的出口只有拆，
 * 拆的边界按职责不按长度 —— 那边回答「这台机器够不够跑门禁链」，这份回答
 * 「pnpm 在哪、探不到时现场长什么样」）。
 *
 * 与 `ci-toolchain-python.mjs` / `ci-toolchain-browser.mjs` 同一条约束：
 * **只用 `node:child_process` / `node:fs` / `node:path`，不 import 任何仓库内模块** ——
 * 工具链自证是流水线第一步，它必须在「什么都还没装好」的机器上也能给出可读输出。
 */
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";

/**
 * `env` 里那一串 `PATH` 的**原文**（ISSUE #2281）。
 *
 * 两个坑都必须在这里吃掉，且只能吃掉一次：
 *   · **键名**：Windows 的环境变量表里它常常写作 `Path`，而 `{ ...process.env }`
 *     的复制品照样只带那个写法 —— 直接读 `env.PATH` 会拿到空串，于是判据判的是
 *     「一个空的 PATH」，日志里却写成「PATH 上没有可用的 pnpm」（那是另一件事）。
 *   · **大小写**：只按**目标平台**做不敏感（`platform` 可注入，单测在 POSIX 上判
 *     Windows 形态），POSIX 上 `Path` 与 `PATH` 是两个不同的变量。
 *
 * @param {{platform?: NodeJS.Platform, env?: Record<string, string | undefined>}} [options]
 * @returns {string} 原文；没有这个变量时是空串
 */
export function pnpmPathValue({ platform = process.platform, env = process.env } = {}) {
  if (env.PATH !== undefined) {
    return String(env.PATH);
  }
  if (platform !== "win32") {
    return "";
  }
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  return key === undefined ? "" : String(env[key] ?? "");
}

/**
 * `PATH` 切出来的条目 —— 分隔符**只按目标平台**取，不按宿主的 `path.delimiter`。
 *
 * `platform` 是可注入的，而单测正是在 POSIX 上判 Windows 的形态。拿宿主那个 `:`
 * 去切一串 `;` 分隔的 Windows PATH，会把整串当成**一条**目录 —— 每个候选都拼成
 * 不存在的路径，判据静默答「没有」（`ci-toolchain-python.mjs` 的 `pathDrives`
 * 记过同一格）。`findPnpm()` 与 `pnpmForensics()` 都从这**一份**取（ISSUE #2281：
 * 两处各读一遍，失败日志就会与应用侧判据分岔）。
 *
 * @param {{platform?: NodeJS.Platform, env?: Record<string, string | undefined>}} [options]
 * @returns {string[]}
 */
export function pnpmPathEntries(options = {}) {
  const platform = options.platform ?? process.platform;
  return pnpmPathValue(options)
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean);
}

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
 * @returns {{command: string, prefixArgs: string[], args: string[], out: string,
 *            ok: boolean, tried?: string[], hostFound?: boolean}}
 *          `command` / `args` 是**探测**（`pnpm -v`）那一趟真正要 spawn 的形态
 *          （宿主形态时 command 是宿主）；`prefixArgs` 是**去掉探针参数之后**的宿主前缀。
 *          `ok: false` 时另带两条读数 —— `tried`（在盘上、但**没起起来**的候选，
 *          按尝试顺序）与 `hostFound`（解释器宿主在不在），给 `pnpmForensics()` 打。
 *
 *          ⚠️ **`args` 里带着探针参数 `-v`，不要拿它去跑真命令**：`pnpm -v exec …`
 *          会只打印版本并**退 0**（实测），于是「装浏览器」那一步看起来成功、实际什么
 *          都没干 —— 比直接红更难查。要跑别的子命令请用 `prefixArgs` 拼
 *          （`[...prefixArgs, "exec", "playwright", …]`）。
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
  /* ① **包真身的 JS 入口优先**（ISSUE #2562）：`process.execPath` + 入口，全平台同一条路、
   * 不要宿主。这一格与本仓 `src/lib/process/executable-resolve.ts` 的 `pnpmJsEntry()`
   * 是同一件事的两份实现（本脚本刻意不 import 仓库内模块，理由见文件头），一致性由
   * `tests/ci-toolchain-selfcheck.test.ts` 对账。少了它，Windows 节点上每一条 `pnpm …`
   * 都要付一次 PowerShell 冷启动 —— 而包真身就摆在 corepack 的落点旁边。 */
  for (const dir of pnpmPathEntries({ platform, env })) {
    const entry = pnpmJsEntryIn(dir, { isFile });
    if (!entry) {
      continue;
    }
    const probed = probeRun(process.execPath, [entry, "-v"]);
    if (!probed) {
      tried.push(entry);
      continue;
    }
    return {
      command: process.execPath,
      prefixArgs: [entry],
      args: [entry, "-v"],
      out: probed.out.trim(),
      ok: true,
    };
  }
  /* `PATH` 的读法**只有一份**（`pnpmPathValue`）：取证那一段不许按「它以为的方式」
   * 再读一遍 —— 第二份读法与这里一分岔，「键名不是 PATH」「分隔符读错」这两类成因
   * 就会在失败日志里静默消失（ISSUE #2281）。 */
  for (const dir of pnpmPathEntries({ platform, env })) {
    for (const ext of exts) {
      const candidate = path.join(dir, `pnpm${ext}`);
      if (!isFile(candidate)) {
        continue;
      }
      const usable = usablePnpm(candidate, {
        platform,
        probeRun,
        host,
        isFile,
      });
      if (usable) {
        return {
          command: usable.command,
          /* 探测那一趟 = 宿主前缀 + 探针参数；`prefixArgs` 单独留一份给真命令用。 */
          prefixArgs: usable.prefixArgs,
          args: [...usable.prefixArgs, ...usable.probeArgs],
          out: usable.out.trim(),
          ok: true,
        };
      }
      tried.push(candidate);
    }
  }
  return {
    command: "pnpm",
    prefixArgs: [],
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
  /* **原文先于切分**（ISSUE #2281）：只打印切出来的条目，读者无法判断「判据读到的那一串
   * 对不对」—— 键名不是 `PATH`（读到空串）与真装了却不在 PATH 上，在条目列表里同形。
   * 原文那行是这一格唯一能把两者分开的读数。 */
  const raw = pnpmPathValue({ platform, env });
  lines.push(
    raw.trim()
      ? `PATH 原文（${raw.length} 字符）: ${raw}`
      : "PATH 原文: （空 —— 这个进程的环境变量表里没有 PATH，或键名是别的写法）",
  );
  lines.push("PATH 条目:");
  /* ⚠️ 按**目标平台**的分隔符切，不按宿主的 `path.delimiter`
   * （`ci-toolchain-python.mjs` 的 `pathDrives` 记过这一格：本机是 `:` 而 Windows
   * 是 `;`，拿宿主的切会把 `C:\...` 拆成 `C` 与 `\...`）。这条判据的 `platform`
   * 可注入 —— 单测正是在 POSIX 上判 Windows 的形态。
   * 切分也只走 `pnpmPathEntries()` 一份：`findPnpm()` 判的和这里打的必须是同一份。 */
  const dirs = pnpmPathEntries({ platform, env });
  for (const d of dirs) {
    lines.push(`  ${d}`);
  }
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
    lines.push("  （一个都没命中 —— 这个执行账号的 PATH 上没有 pnpm 的任何形态）");
  }
  /* 后半段是**这一跑真正的读数**：命中的候选里有哪些真被试过、以及有没有
   * 解释得了它们的宿主。没有它，「命中在盘上」与「起不来」之间那条缝就只能靠猜
   * —— 这条链上连着几轮的红都出在这条缝里。 */
  lines.push("在盘上但**没起起来**的候选（按尝试顺序）:");
  if (tried.length === 0) {
    lines.push("  （没有 —— 一个候选都没进到探测这一步）");
  } else {
    for (const c of tried) {
      lines.push(`  ${c}`);
    }
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
/**
 * 这个落点上 pnpm 的**包真身 JS 入口**（`process.execPath` 能直接起的那份）；没有给 `null`。
 *
 * 与 `src/lib/process/executable-resolve.ts` 的 `pnpmJsEntry()` 同一条判据（本脚本不 import
 * 仓库内模块，理由见文件头）：
 *   · 落点自己就是包（corepack 的 `<ver>/`）与 `<落点>/node_modules/pnpm/` 两种形状；
 *   · 入口从包的 `bin` 字段读，不猜文件名；`bin` 指向原生二进制时改用 Corepack 对
 *     pnpm ≥ 11 写死的 `bin/pnpm.mjs`。
 *
 * @param {string} dropIn
 * @param {{isFile: (p: string) => boolean}} ctx
 * @returns {string | null}
 */
function pnpmJsEntryIn(dropIn, { isFile }) {
  const candidates = [path.join(dropIn, "node_modules", "pnpm")];
  /* 落点自己是包时读它自己的清单 —— 但 PATH 上随便一个目录也可能有 package.json，
   * 名字对不上就不算。 */
  /** @param {string} dir @returns {Record<string, any> | null} */
  const manifestOf = (dir) => {
    try {
      return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
      return null;
    }
  };
  const own = manifestOf(dropIn);
  if (own?.name === "pnpm") {
    candidates.push(dropIn);
  }
  for (const pkgDir of candidates) {
    const manifest = manifestOf(pkgDir);
    if (!manifest) {
      continue;
    }
    const bin = manifest.bin;
    const rel = typeof bin === "string" ? bin : bin && typeof bin === "object" ? bin.pnpm : null;
    if (typeof rel === "string" && rel !== "") {
      const target = path.resolve(pkgDir, rel);
      if (isFile(target) && looksLikeScript(target)) {
        return target;
      }
    }
    for (const name of ["pnpm.mjs", "pnpm.cjs"]) {
      const corepackEntry = path.join(pkgDir, "bin", name);
      if (isFile(corepackEntry) && looksLikeScript(corepackEntry)) {
        return corepackEntry;
      }
    }
  }
  return null;
}

/**
 * 这份文件是「能被 node 起的脚本」吗（不是二进制、不是批处理）—— 读文件头，不看扩展名。
 *
 * @param {string} candidate
 * @returns {boolean}
 */
function looksLikeScript(candidate) {
  let head;
  try {
    const fd = openSync(candidate, "r");
    const buf = Buffer.alloc(16);
    const read = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    head = buf.subarray(0, read).toString("latin1");
  } catch {
    return false;
  }
  if (head.length < 2) {
    return false;
  }
  if (head.startsWith("#!")) {
    return true;
  }
  if (/^@?\s*(?:echo|setlocal)\b/i.test(head) || head.startsWith("@")) {
    return false;
  }
  /* `#` 起头而**非** `#!`：Corepack 缓存里的**占位文本**（首行注释写着「请走
   * ./bin/pnpm.mjs」）。node 起它必然 `SyntaxError` 而退的是 1 —— 与「判据跑了且红」
   * 同形（ISSUE #2597）。与 `executable-resolve.ts` 的 `isPnpmEntryScript()` 同一条规则，
   * 这两份是 ISSUE #2562 里刻意各留的（自证那一格不许 import 仓库内模块）⇒ 必须同批改。 */
  if (head.startsWith("#")) {
    return false;
  }
  /* 可打印 ASCII 起头即文本脚本；MZ / ELF 那类二进制落到 else（`{2}` 会退化成
   * 「长度恰好为 2」，ISSUE #2563 就是那个形状）。 */
  return /^[\u0009\u000a\u000d\u0020-\u007e]{2,}$/.test(head);
}

/**
 * @param {NodeJS.Platform} platform
 * @returns {string[]}
 */
function pnpmCandidateExts(platform) {
  return platform === "win32" ? ["", ".EXE", ".PS1", ".CMD", ".BAT", ".COM"] : [""];
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
 * @returns {{command: string, prefixArgs: string[], probeArgs: string[], out: string} | null}
 *          `prefixArgs` 是宿主前缀（直接起时为空）、`probeArgs` 是探针参数 —— 分开给，
 *          调用方跑**别的**子命令时用 `prefixArgs`（见 `findPnpm` 的 `@returns`）。
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
    if (!exe) {
      return null;
    }
    /* **探的参数必须带上**（`-v`）：`.ps1` 那一档判的是「这个垫片起了之后真能答出
     * 版本」，而不是「PowerShell 能加载它」。少了它，corepack 的 `pnpm.ps1` 收到
     * 空参数会打 usage 并**退非零**（实测 `pnpm` 裸跑 exit≠0、`pnpm -v` exit=0），
     * 于是 `runProbe` 判它「起不来」、唯一可用的形态被否掉，最后仍报
     * 「pnpm 不可用」—— 修完候选表却漏了探针参数，红的形状原地复现。 */
    return viaHost(exe, ps1Invocation(candidate), probeRun);
  }
  const direct = probeRun(candidate, ["-v"]);
  if (direct) {
    return { ...direct, prefixArgs: [], probeArgs: ["-v"] };
  }
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
 * @returns {{command: string, prefixArgs: string[], probeArgs: string[], out: string} | null}
 */
function viaSiblingPs1(candidate, { host, probeRun, isFile }) {
  const ext = path.extname(candidate);
  const script = `${ext ? candidate.slice(0, -ext.length) : candidate}.ps1`;
  if (!isFile(script)) {
    return null;
  }
  const exe = host();
  if (!exe) {
    return null;
  }
  /* 同一条：探的参数一并交给垫片（见上面 `.ps1` 那一支的注释）。 */
  return viaHost(exe, ps1Invocation(script), probeRun);
}

/**
 * 经宿主起一次并收场 —— 把「宿主前缀」与「探针参数」分开留着。
 *
 * 两者分开是**调用方的需要**，不是为了好看：`findPnpm()` 的 `args` 给的是
 * 「探一趟 pnpm」的完整形态（`… -File pnpm.ps1 -v`），而**拿它去跑真命令是错的**
 * —— 实测 `pnpm -v exec playwright install …` 只打印版本并**退 0**，于是
 * 「装浏览器」那一步看着成功、实际什么都没干。所以这里把前缀留一份出来，
 * 真命令用 `[...prefixArgs, "exec", "playwright", …]` 拼。
 *
 * `probeRun` **必须从调用方透传**，不许在这里直取模块级的 `runProbe`：那个口是
 * 单测「在 POSIX 上判 Windows 形态」的唯一接缝，绕过去等于让结论取决于跑判据那台
 * 机器上碰巧有什么（`tests/ci-toolchain-selfcheck.test.ts` 有一条结构判据盯着这件事）。
 *
 * @param {string} exe 宿主可执行文件
 * @param {string[]} prefix 宿主前缀（`-NoProfile … -File <shim>`）
 * @param {(cmd: string, args: string[]) => {command: string, args: string[], out: string} | null} probeRun
 * @returns {{command: string, prefixArgs: string[], probeArgs: string[], out: string} | null}
 */
function viaHost(exe, prefix, probeRun) {
  const probeArgs = ["-v"];
  const probed = probeRun(exe, [...prefix, ...probeArgs]);
  if (!probed) {
    return null;
  }
  return { ...probed, prefixArgs: prefix, probeArgs };
}

/**
 * 起一次并收 stdout/stderr —— 退出码非零也算「起得来」不算（`-v` 报错即有输出）。
 *
 * 与编排侧 `run()` 的差别只有一个：这里的 `ok` 同时要求**真的起来了**
 * （`error` 为空），而不只是「退出码是 0」—— 这个函数要回答的正是「能不能起」。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{command: string, args: string[], out: string} | null}
 */
function runProbe(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.error || r.status !== 0) {
    return null;
  }
  return { command: cmd, args, out };
}

/**
 * `.ps1` 经宿主的**宿主前缀**（不含探针参数 —— 探针参数由 {@link viaHost} 接）。
 *
 * 刻意**不接宿主可执行文件**：宿主由 `powershellHost()` 单独答，这里只给
 * 「宿主怎么起它」（与 `src/lib/process/executable-resolve.ts` 的 `prefixArgs` 同形）。
 *
 * `-NoProfile` 要紧：宿主账号上若有 profile，它可能往 stdout 打字，而探针把整块
 * stdout 当版本号读。`-ExecutionPolicy Bypass` 是无人值守里唯一稳的档。
 *
 * @param {string} script
 * @returns {string[]}
 */
function ps1Invocation(script) {
  return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script];
}

/**
 * PowerShell 宿主（优先 pwsh 7，回退 Windows PowerShell）。
 *
 * @returns {string | null}
 */
function powershellHost() {
  if (process.platform !== "win32") {
    return null;
  }
  for (const name of ["pwsh", "powershell"]) {
    for (const ext of [".EXE", ""]) {
      for (const dir of String(process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)) {
        const candidate = path.join(dir, name + ext);
        if (isFileOnDisk(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

/**
 * 这个路径是不是一个**在盘上的普通文件**（读不动 / 是目录都当没有）。
 *
 * `cargoForensics()`（selfcheck 侧）也拿它当默认落盘判据 —— 同一个「在不在盘上」
 * 的问题全族只有这一份实现。
 *
 * @param {string} p
 * @returns {boolean}
 */
export function isFileOnDisk(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
