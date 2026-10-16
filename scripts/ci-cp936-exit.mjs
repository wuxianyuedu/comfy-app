#!/usr/bin/env node
/**
 * `ci-cp936-exit.mjs` — 让**子进程的每一个字节以 CP936 出口**（ISSUE #1977）。
 *
 * ## 它补的是哪一格（以及为什么不是「再钉一次控制台编码」）
 *
 * `scripts/ci-console-encoding.mjs` 已经把控制台输出编码钉成 UTF-8 —— 那一句是
 * **必要不充分**：它让控制台里的 PS 与子进程写同一种字节（都是 UTF-8），而平台抓取
 * stage 输出那一跳读的是**不与宿主设置联动的 CP936**。三轮探针（控制台代码页 936→65001、
 * 宿主 ANSI 代码页也换成 UTF-8 并重启）读数**逐字未变**，把「机器侧改一处全好」这条路
 * 全部否掉了；同一份日志里还有一组硬对照 —— **runner 自己打的行（`script` 原文回显）
 * 是完好中文**，而**子进程输出的每一行**都是「UTF-8 字节按 CP936 解」。
 *
 * ⇒ 解码发生在**子进程输出那一跳**，仓库侧只剩一条出路：**让每个字节以 CP936 出口**。
 * 本文件就是那一条出路的执行者。
 *
 * ## 为什么它不是「一行 `chcp 936`」
 *
 * 把控制台钉成 936 会**先毁掉解码**：PowerShell 拿 936 去解 Node 的 UTF-8 字节，
 * 拿到的**已经是乱码串**，再按 936 写出去只是把乱码换个编码存下来（规范 §13.5.3.5
 * 「不先解对，转码那一步手里拿到的已经是乱码串」）。正确的链是**两段**：
 *
 *   ① PowerShell 按 **UTF-8** 读本进程的输出（这一半由 `ci-console-encoding.mjs`
 *      钉的 65001 负责），手里拿到的是**正确的中文**；
 *   ② 再按 **CP936** 把它写回 stdout —— 平台按它解，于是可读。
 *
 * ## 为什么转码这一步必须借 PowerShell（Node 没有 GBK 编码器）
 *
 * 实测：`new TextEncoder("gbk")` 不抛错，但**落到 UTF-8**（`NONSTANDARD_allowLegacyEncoding`
 * 也不认），所以 Node 侧编码不出 GBK 字节。而 `TextDecoder("gbk")` 是好的（Node 带全 ICU）
 * —— 也就是说这条链**只能借 PowerShell 的 `[Text.Encoding]::GetEncoding(936)`**。
 * 这也是规范里那句「Node 无 GBK 编码器，得靠 PowerShell 包一层」的由来。
 *
 * ## 形态
 *
 *   node scripts/ci-cp936-exit.mjs -- <命令> [参数...]
 *
 * 它起那条命令（stdout/stderr 合并抓）、把抓到的 UTF-8 文本交给 PowerShell 以 936
 * 重发，再把**子进程的退出码原样转出去**（转码是外壳，退出码是那条命令的结论 ——
 * 外壳不许吞它，这正是 `ci-toolchain-selfcheck.mjs` 踩过的那个坑）。
 *
 * ## 边界（刻意不做的事）
 *
 *   · **非 Windows 直通**：CP936 是中文 Windows 的事，别处没有这一跳；此时原样起子进程、
 *     原样转出退出码（不静默、也不多起一层 PowerShell）。
 *   · **转码失败不回退成「看起来成功」**：PowerShell 起不来时把原文照打一遍并说明
 *     （日志继续乱，但那是对的现象），退出码仍是子进程的。
 *   · **不做第二份「有没有乱码」的判据**：抓取端怎么解码本进程看不到，能判的只有
 *     「字节是 936 编出来的」这一件事 —— 那由 `encodeCp936Plan()` 的可测面判。
 *
 * ## 这一层自己踩过的两个坑（都在 Windows 那条路上，Linux 检出判不到）
 *
 *   · **抓输出那一跳没钉编码**：`"data"` 事件的入参是 `Buffer`，`String(d)` 走的是
 *     「按 `process.stdout` 的编码解字节」那条路 —— 在 Windows 上那是**宿主代码页
 *     （CP936）**，于是子进程的 UTF-8 字节在进 PowerShell 之前就已经被解错一遍，
 *     再按 936 编回去只是把乱码换个编码存下来（转码链条在**第一跳**就断了）。
 *     现在显式 `setEncoding("utf8")`（与 `ci-console-encoding.mjs` 同一条口径）。
 *   · **`resolve` 注入面被自己的 Promise executor 遮蔽**：executor 的形参恰好叫
 *     `resolve`，而 production 的 `resolve` 是 `undefined` 要回退到
 *     `commandInvocation` —— `undefined ?? commandInvocation` 本该走后者，可一旦
 *     有人把这一句挪进 executor 里，`resolve` 就变成 **Promise 的 resolve 函数**
 *     （一个恒真的值），解析直接消失、`invocation.command` 是 `undefined`，
 *     `spawn(undefined, …)` 当场 `ERR_INVALID_ARG_TYPE`。模块级取好别名再进 Promise。
 *   · **解析口选错了一层，于是回退成了「裸名字交给 spawn」**：`commandInvocation`
 *     的契约是「**候选** → spawn 形态」，解析不出来时它**原样退回候选**
 *     （`{command: candidate}`）—— 对一条已经在盘上的路径那是忠实的，对
 *     `pnpm` 这种**名字**却是把 `spawn("pnpm")` 直接扔给 Windows（ENOENT）。
 *     `.cnb.yml` 里那条 `-- pnpm install --frozen-lockfile` 踩的就是这一格：
 *     解析退化 ⇒ 起不来 ⇒ `[cp936-exit] 起不了这条命令：pnpm`。正确的那一层是
 *     `resolveCommandInvocation()`（它收**名字**、交 `{command, args, resolved}`，
 *     并用 `resolved: false` 把「查无此命令」变成一个可读出口）。
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/* ⚠️ **可执行形态的唯一判据**（ISSUE #638 / §2.1.1）：Windows 上 `pnpm` 是 `.cmd`/`.ps1`
 * 垫片，Node 直接 `spawn("pnpm")` **起不来**（`.cmd` 只有 cmd.exe 会解释，Node 给
 * `EINVAL`；`.ps1` 要给 PowerShell 宿主）。本文件是**包着别的命令起进程**的那一层，
 * 所以这里必须走同一份判据 —— 自己写一个「Windows 用 pnpm.cmd」就是第四次踩同一个坑
 * （§2.1.1 记着前三次）。
 *
 * 说明符**带 `.ts` 扩展名**是硬要求：`.mjs` 静态 import 一份 `.ts` 时 Node 的 ESM
 * 解析器不替你补扩展名（ISSUE #1961 实测的 `ERR_MODULE_NOT_FOUND` 就是这个形态的
 * 反面教材），口径见 `src/lib/process/platform.ts` 的文件头注。 */
import { resolveCommandInvocation } from "../src/lib/process/executable-resolve.ts";

/* 这个别名**不是**风格：`runWithCp936Exit` 的 Promise executor 有个形参也叫 `resolve`
 * （那是 Promise 的 settle 函数），production 的注入面默认值是 `undefined`、靠
 * `??` 回退到真解析口。一旦取默认值的那一句落进 executor 里，`resolve` 就会被那个
 * **恒真的 Promise resolve 函数**顶掉 —— `undefined ?? x` 本来是回退，换成「恒真有值」
 * 之后解析整段消失，`spawn(undefined, …)` 直接抛。模块级别名让这条回退不依赖
 * 「那两句写在 executor 外面」（`electron-package.mjs` 用同一处置避开同名遮蔽）。 */
const defaultResolver = resolveCommandInvocation;

/** 中文 Windows 的 ANSI 代码页 —— 平台那一跳读的就是它。 */
export const CP936_CODE_PAGE = 936;

/**
 * 一步转码的**计划**（纯函数，可测）：把「怎么把这批 UTF-8 文本以 936 写出去」
 * 表达成一条 PowerShell 脚本 + 它的入参。
 *
 * 刻意**不在 Node 侧编码**：Node 没有 GBK 编码器（见文件头），所以这里只产出
 * 「要交给 PowerShell 的那段脚本」。用它当可测面，是因为本仓没有第二处能判
 * 「这条链写出去的是不是 936 字节」—— 抓取端在本进程之外。
 *
 * 三处细节都不是风格：
 *   · `[Console]::OpenStandardOutput()` —— 绕过控制台对象**直接写原始字节**，
 *     否则 PS 又会按它自己的 `OutputEncoding` 重编一遍（探针第 4 行同一条路数）；
 *   · `$Input` 通道读 stdin —— 与下面的 `spawnSync(..., { input })` 配对，
 *     不经过命令行参数（那会被 PowerShell 再解一次引号与转义）；
 *   · `Flush()` 显式调用 —— 不解没有坏结论，但解了省得在管道里悬着。
 *
 * @param {number} [codePage]
 * @returns {{script: string, codePage: number}}
 */
export function encodeCp936Plan(codePage = CP936_CODE_PAGE) {
  return {
    codePage,
    script:
      `$enc=[Text.Encoding]::GetEncoding(${codePage}); ` +
      `$w=[Console]::OpenStandardOutput(); ` +
      `$in=[Console]::In.ReadToEnd(); ` +
      `$b=$enc.GetBytes($in); ` +
      `$w.Write($b,0,$b.Length); $w.Flush()`,
  };
}

/**
 * 把一段 UTF-8 文本以 CP936 写到 stdout —— **唯一一处真的落字节**。
 *
 * 两个注入面（`platform` / `run`）不是给测试凑数用的：本文件在 Linux 上跑不了真的
 * PowerShell，而这条链的**判据全是「起了什么、退了多少」**，所以必须有可注入的一层
 * （与 `ci-console-encoding.mjs` 的 `runImpl` 同一处置）。
 *
 * 失败时**不抛**：返回 `{ok:false}`，由调用方决定「原文照打」——转码是外壳，
 * 它不是判据，把流水线弄红于它无关。
 *
 * `spawnImpl` 是**第三**个注入面，专为一件在 Linux 上够不到的事存在：默认实现
 * 里那句 `spawnSync` 只会在 Windows 分支跑到，而平台侧第一次红正是它（见下）。
 * 有了它，这条链的**真实现**（起什么、`encoding` 是什么）在本地就能判。
 *
 * @param {string} text UTF-8 文本（子进程的原始输出）
 * @param {{platform?: NodeJS.Platform,
 *          run?: (cmd: string, args: string[], input: string) => {status: number|null},
 *          spawnImpl?: typeof spawnSync}} [ports]
 * @returns {{ok: boolean}}
 */
export function writeCp936(
  text,
  { platform = process.platform, run, spawnImpl = spawnSync } = {},
) {
  if (platform !== "win32") return { ok: false };
  const { script } = encodeCp936Plan();
  const exec =
    run ??
    ((cmd, args, input) => {
      /* `encoding` 要么是**编码名字符串**（如 `"utf8"`）、要么是 `null` 表示
       * 「stdout/stderr 给 Buffer」。`"buffer"` 与 `Buffer` **两者都不行** ——
       * 它们都会被当编码名去 `Buffer.isEncoding` 查表，而查不到时 `spawnSync`
       * 在 `Buffer.from(input, encoding)` 那里当场抛 `ERR_UNKNOWN_ENCODING`。
       * 这一句本是本文件第一次上平台唯一真炸的那一处（`工具链自证` stage 直接红），
       * 而本地全绿：`writeCp936` 在非 Windows **直接 return**，那条语句在 Linux
       * 检出一辈子都执行不到。
       *
       * 要的是 Buffer 输出，所以写 `null`（等价于省掉这个键）—— 不是 `Buffer`。
       * 判据见 `tests/ci-cp936-exit.test.ts` 的 `spawnImpl` 那一组。 */
      const r = spawnImpl(cmd, args, { input, encoding: null });
      return { status: r.status };
    });
  const r = exec(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    text,
  );
  return { ok: r.status === 0 };
}

/**
 * 「怎么把它的字节以 CP936 写出去」这件事在**应用层**的唯一形态。
 *
 * `--` 后面的每一个 token 都是**那条命令自己的**，本文件不解析、不改写 —— 这正是
 * `ci-toolchain-selfcheck.mjs` 踩过的「把探针参数拼进真命令」那一类的反面。
 *
 * @param {string[]} argv `process.argv.slice(2)`
 * @returns {{command: string | null, args: string[], usage: string}}
 */
export function parseInvocation(argv) {
  const usage =
    "用法：node scripts/ci-cp936-exit.mjs -- <命令> [参数...]\n" +
    "（`--` 不是可选的：它把「外壳的参数」与「那条命令的参数」分开）";
  const sep = argv.indexOf("--");
  if (sep === -1 || sep === argv.length - 1) {
    return { command: null, args: [], usage };
  }
  const rest = argv.slice(sep + 1);
  /* `--` 后面第一个不是 `undefined`（上面刚判过 `sep` 不在末尾），这里是给
   * 「参数类型是 `string | undefined`」那件事一个显式收口。 */
  const [command, ...args] = rest;
  return { command: command ?? null, args, usage };
}

/**
 * 从一段 stage 命令里剥掉本外壳，交出**被包的那条命令的原文**。
 *
 * 存在的理由只有一个具体调用方：`.cnb.yml` 现在每个 stage 都以
 * `node scripts/ci-cp936-exit.mjs -- <真命令>` 起，而那两处「这一步点名的入口真的
 * 在盘上吗」的判据按 `scripts/…` 抓入口 —— 不剥外壳，它们抓到的就是**外壳自己**
 * （它当然在盘上），于是判据从「接线对不对」退化成「外壳在不在」，而**真正要守的
 * 那条入口可以写错、甚至被删掉而没人知道**。这与 `python-probe.mjs` 头注里那句
 * 「只看一边的读数分不出是哪一边错」是同一类：判据的对象被中间层顶掉了。
 *
 * 不是外壳时原样返回——两处判据因此可以无条件先过它一遍。
 *
 * @param {string} command
 * @returns {string}
 */
export function unwrapCp936(command) {
  const m = /(?:^|;)\s*node\s+scripts\/ci-cp936-exit\.mjs\s+--\s+(.*)$/.exec(
    command.trim(),
  );
  return m?.[1]?.trim() ?? command;
}

/**
 * 起命令、抓输出、以 CP936 重发、转出退出码 —— 编排那一层（`main()` 调它）。
 *
 * **退出码走 `resolve` / `reject` 的第二个值**：`main()` 里那句 `process.exit(code)`
 * 是本文件唯一把结论转出去的地方（下游 stage 靠它判红绿）。
 *
 * @param {string[]} argv
 * @param {{platform?: NodeJS.Platform,
 *          spawnProc?: typeof spawn,
 *          write?: typeof writeCp936,
 *          resolve?: (cmd: string, args: string[]) =>
 *            {command: string, args: string[], resolved: boolean},
 *          out?: (chunk: string) => void}} [ports]
 * @returns {Promise<number>} 该转出去的退出码
 */
export function runWithCp936Exit(
  argv,
  {
    platform = process.platform,
    spawnProc = spawn,
    write = writeCp936,
    resolve,
    out,
  } = {},
) {
  const { command, args, usage } = parseInvocation(argv);
  const emit = out ?? ((chunk) => process.stdout.write(chunk));
  if (!command) {
    emit(`${usage}\n`);
    return Promise.resolve(2);
  }
  /* 解析成「这台机器上真被执行的那条命令」——判据是**仓里那一份**（`resolve` 是它的
   * 注入面）。用的必须是**收名字**的那一层 `resolveCommandInvocation()`：它的兄弟
   * `commandInvocation()` 收的是**候选路径**，解析不出来时**原样退回候选** ——
   * 那个「回退」对一条盘上的路径是忠实的，对 `pnpm` 这种名字却是把 `spawn("pnpm")`
   * 扔给 Windows（ENOENT，见头注第三个坑）。 */
  const invocation = (resolve ?? defaultResolver)(command, args);
  /* 解析口必须交出 `{command, args, resolved}`：`undefined` 悄悄流下去只会变成
   * `spawn(undefined, …)` 的 `ERR_INVALID_ARG_TYPE`（报错点离真因一整层）。
   * 生产路径另有护栏 —— `spawn` 传函数会抛，于是「拿 Promise resolve 当注入面」
   * 这条错法在**真跑一次**时就红，而不是等到 Windows 上才炸（见对应用例）。 */
  if (
    !invocation?.command ||
    !Array.isArray(invocation.args) ||
    typeof invocation.resolved !== "boolean"
  ) {
    throw new TypeError(
      "[cp936-exit] 命令解析口没有交出 {command, args, resolved} —— " +
        "它该是 resolveCommandInvocation 或一个同形状的注入面",
    );
  }
  /* PATH 上查无此命令 ⇒ **给出可读出口**（同一条处置：`resolved: false` 是「找不到」，
   * 不是「用裸名字再试一次」）。裸名字丢给 spawn 只会拿回一句信息量很低的 ENOENT，
   * 而那正是 `Install dependencies` 那一格上看到的形态。 */
  if (!invocation.resolved) {
    emit(
      `[cp936-exit] PATH 上找不到这条命令：${command} —— ` +
        "已按 PATH（含 PATHEXT）找过，它不在盘上\n",
    );
    return Promise.resolve(127);
  }
  const realCommand = invocation.command;
  /* 参数用**解析口交回来的那一份**（宿主前缀 + 原参数都由它拼好）。 */
  const realArgs = invocation.args;
  return new Promise((resolve) => {
    /* `shell: false` 是默认 —— 本文件**不**替调用方解释命令行。stage 里那条命令
     * 本身可能是 `pnpm run build` 这种带子命令的形态，但它的解析归它自己的宿主
     * （`.cnb.yml` 的 stage shell），这里只管把 token 原样递过去。 */
    const child = spawnProc(realCommand, realArgs, {
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    });
    /** @type {string[]} */
    const chunks = [];
    for (const stream of [child.stdout, child.stderr]) {
      /* **显式钉 UTF-8**：`String(buffer)` 走 `buf.toString()`，其默认编码取自
       * `process.stdout` 的 `writableEncoding` —— Windows 上那是**宿主代码页
       * （CP936）**。看着等价，实则这条链的**第一跳**就在这里断：子进程的 UTF-8
       * 字节被按 936 解成乱码串，后面拿 PowerShell 再按 936 编回去只是把乱码换个
       * 编码存下来（「先解对、再编回」两段里的第一段，`ci-console-encoding.mjs`
       * 钉的是控制台那一半，这里钉的是抓子进程这一半）。 */
      stream?.setEncoding?.("utf8");
      stream?.on("data", (d) => chunks.push(String(d)));
    }
    child.on("error", () => {
      /* 起不来（命令不存在）也是「这条命令的结论」，走同一个复核出口：
       * 原文照打 + 非零退出码（127 是壳里「命令没找到」的常规形态）。 */
      emit(`[cp936-exit] 起不了这条命令：${command}\n`);
      resolve(127);
    });
    child.on("close", (code) => {
      const text = chunks.join("");
      if (platform !== "win32") {
        /* 非 Windows：CP936 这一跳不存在，原样转出（不假装转过了）。 */
        emit(text);
        resolve(code ?? 0);
        return;
      }
      const { ok } = write(text);
      if (!ok) {
        emit(
          "[cp936-exit] 转码这一步没做成（PowerShell 起不来？）—— 原文照打，" +
            "日志可能仍是乱码；退出码不受影响\n",
        );
        emit(text);
      }
      resolve(code ?? 0);
    });
  });
}

/* 「是不是被直接执行」用**两侧都过 `path.resolve`** 的比较 —— 拼 `file://${argv[1]}`
 * 在 Windows 上恒不相等，那段就一次都不跑（与 `ci-toolchain-selfcheck.mjs`
 * /`python-probe.mjs` 同一条处置，它们的头注记着这个形态）。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const code = await runWithCp936Exit(process.argv.slice(2));
  /* 退出码**必须**转出去：外壳吞掉它等于把被包那条命令的结论一起吞掉
   * （`ci-toolchain-selfcheck.mjs` 的 `main()` 返回值被丢那一次就是这么红的）。 */
  process.exit(code);
}
