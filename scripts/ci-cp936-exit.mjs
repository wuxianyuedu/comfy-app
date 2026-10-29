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
 * 外壳不许吞它，这正是 `ci-toolchain-selfcheck.mjs` 踩过的那个坑；也不许**编出**一个，
 * 那是 ISSUE #2571 修的那一格：子进程被信号终止时 `code` 是 `null`，按 `?? 0` 落进
 * 「成功」等于替那条从没退出过的命令报了一条通过 —— 折算规则在
 * `exitCodeFromTermination()`）。
 *
 * ## 边界（刻意不做的事）
 *
 *   · **非 Windows 直通**：CP936 是中文 Windows 的事，别处没有**转码**这一跳；此时
 *     原样起子进程、原样转出退出码（不静默、也不多起一层 PowerShell）。
 *     ⚠️ 这里直通的只有转码：**退出码那一条链两个平台是同一个 `close` 回调**，
 *     所以 ISSUE #2571 那一格在 Linux 上同样成立（不是「Windows 专属」）。
 *   · **转码失败不回退成「看起来成功」**：PowerShell 起不来时把原文照打一遍并说明
 *     （日志继续乱，但那是对的现象），退出码仍是子进程的。
 *   · **不做第二份「有没有乱码」的判据**：抓取端怎么解码本进程看不到，能判的只有
 *     「字节是 936 编出来的」这一件事 —— 那由 `encodeCp936Plan()` 的可测面判。
 *
 * ## 这一层自己踩过的坑（都在 Windows 那条路上，Linux 检出判不到）
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
 *     `spawn(undefined, …)` 当场 `ERR_INVALID_ARG_TYPE`。**根因是重名**，所以处置是
 *     把 executor 的形参改名为 `settle`（解析口在 executor 之外就已经调完，改完这条
 *     遮蔽不可能再发生），而不是靠「模块级别名 + 那两句写在 executor 外面」这种得
 *     有人记得住的约定。
 *   · **解析口选错了一层，于是回退成了「裸名字交给 spawn」**：`commandInvocation`
 *     的契约是「**候选** → spawn 形态」，解析不出来时它**原样退回候选**
 *     （`{command: candidate}`）—— 对一条已经在盘上的路径那是忠实的，对
 *     `pnpm` 这种**名字**却是把 `spawn("pnpm")` 直接扔给 Windows（ENOENT）。
 *     `.cnb.yml` 里那条 `-- pnpm install --frozen-lockfile` 踩的就是这一格：
 *     解析退化 ⇒ 起不来 ⇒ `[cp936-exit] 起不了这条命令：pnpm`。正确的那一层是
 *     `resolveCommandInvocation()`（它收**名字**、交 `{command, args, resolved}`，
 *     并用 `resolved: false` 把「查无此命令」变成一个可读出口）。
 *   · **「该不该问 PATH」与「怎么起」是两件事，只做前一半会漏掉后半**：
 *     `node_modules/.bin/tsc` 是**相对路径**，拿它去问 PATH 当然「找不到」（那不是
 *     找不到、是问错了对象）；而把它**原样**交给 `spawn` 在 Windows 上照样起不来 ——
 *     pnpm 给 `.bin/<工具>` 摆的三个垫片（`.cmd` / `.ps1` / 无扩展名 shim）Node 一个
 *     都起不了。两半都要：路径**不问 PATH**（`isPathLike()`），但**要过形态判据**
 *     （`commandInvocation`，它会把同目录的 `.ps1` 回退找出来）。
 *     ⇒ 这就是 `resolveShellInvocation()` 按 token 形状分两条的由来。
 *   · **转码「成功」时输出被吞掉**（第五次上平台，2026-10-16）：`writeCp936` 的默认
 *     实现是 `spawnSync(..., { input, encoding: null })` —— 那个 `null` 是**对的**
 *     （要 Buffer 输出的唯一写法，见下），可它同时意味着 `spawnSync` 的 `stdio`
 *     仍是默认的 `pipe`：PowerShell 编对的那批 936 字节落进 `r.stdout` 这个 Buffer，
 *     然后**整份丢掉**。于是平台侧那条 stage 的日志**一个字都没有**（连成功时也是），
 *     而退出码照转 —— 「输出被吞」与「命令没输出」在日志上同形，读的人只能去猜。
 *     正确取值是 `stdio: ["pipe", "inherit", "inherit"]`：**只把 stdout / stderr
 *     接出去**，stdin 必须留在管道上 —— 那份原文就是从 stdin 递给 PowerShell 的
 *     （`input`），而 `stdio: "inherit"` 配 `input` 用时会把 `input` **静默丢掉**
 *     （stdin 变成真终端），PowerShell 的 `[Console]::In.ReadToEnd()` 读到空串 ⇒
 *     **修完第一次仍然全空**（`E2E 关键流程` 那一格：退出 1、日志零行）。
 *     「标准输出落日志」与「整个 stdio 都别管」是两句话。
 *     ⚠️ 这一格**Linux 上永远判不到**（非 Windows 直接 return），所以判据钉在
 *     「默认实现交出去的那三路是什么」这个形状上（`spawnImpl` 注入面）。
 *   · **「起不了」那条出口不给真因**（第四次上平台）：报的是
 *     `起不了这条命令：node_modules/.bin/npx tsc --noEmit`，而真因是那次调用把
 *     **两条命令**当成了一条 —— 盘上没有那个文件。`resolved: true` 只表示
 *     「调用方写的是**路径**」、**不表示它在盘上**（这是上一处刻意选的方向：路径不进
 *     PATH 查找，让盘自己回答）—— 于是「盘说没有」这一格全靠 spawn 的结论，而它
 *     原来的出口只有命令名。现在 `formatSpawnFailure()` 把三样东西一起打出来：
 *     `err.code`（`ENOENT` 与 `EACCES` / `EINVAL` 要做的处置完全不同）、解析口
 *     交回的**绝对路径**、以及**当前目录 + 调用方的原文**（相对路径是相对谁的，
 *     不写出来只能猜；`cwd` 由调用方注入，见 `process.cwd()`）。
 *   · **输出攒到 `close` 才发**（第六次上平台，2026-10-16）：那时 `close` 是唯一
 *     的发送点，而**外壳自己被平台按 stage 墙钟掐掉**时它不会来 —— 于是
 *     `E2E 关键流程` 跑了 36 分钟、平台日志**零行**，读到的唯一结论是平台那句
 *     `timeout of 2160000ms exceeded`（与真因无关）。
 *     「输出被吞」在长跑这一格上的形态**不是「发不出去」，是「发得太晚」**：
 *     秒级 stage 上完全看不出来（命令退出了，输出就发出去了），分钟级 stage 上
 *     代价是**整轮日志**。处置是**边到边发**（`splitStreamChunk()` 按 `\n` 切整行、
 *     行尾残余留到下一块）—— 按块发会在多字节字符中间截断，GBK 是变长的，编出来
 *     就是乱码字节。
 *     ⚠️ **这一条当时给出的因果是错的**（ISSUE #2571 当场复现推翻）：写的理由是
 *     「被 kill 的进程上 `close` 永远不会来」，而实测**子进程**被信号终止时 `close`
 *     照来，带的是 `code=null` + `signal=SIGTERM`。不来的那一档是**外壳自己被杀**
 *     —— 那一档里本文件没有任何一句会执行。错前提的代价不止是一句注释：它让
 *     `settle(code ?? 0)` 看起来「只在正常路径上被读到」，于是「被终止的一跑」在
 *     这台机器上被转成了**退出 0**（假绿）。折算规则现在收在 `exitCodeFromTermination()`，
 *     判据也补了「信号终止 ⇒ 非零」那一格（真起子进程再 kill，不是假执行者）。
 *     「第一块到就发出去」那条判据仍然只判时机 —— 「被 kill 之后还能不能读到」
 *     在单测里没有对应的时刻，那件事由流式本身保证。
 */
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/* ⚠️ **可执行形态的唯一判据**（ISSUE #638 / §2.1.1）：Windows 上 `pnpm` 是 `.cmd`/`.ps1`
 * 垫片，Node 直接 `spawn("pnpm")` **起不来**（`.cmd` 只有 cmd.exe 会解释，Node 给
 * `EINVAL`；`.ps1` 要给 PowerShell 宿主）。本文件是**包着别的命令起进程**的那一层，
 * 所以这里必须走同一份判据 —— 自己写一个「Windows 用 pnpm.cmd」就是第四次踩同一个坑
 * （§2.1.1 记着前三次）。
 *
 * 说明符**带 `.ts` 扩展名**是硬要求：`.mjs` 静态 import 一份 `.ts` 时 Node 的 ESM
 * 解析器不替你补扩展名（ISSUE #1961 实测的 `ERR_MODULE_NOT_FOUND` 就是这个形态的
 * 反面教材），口径见 `src/lib/process/platform.ts` 的文件头注。 */
import {
  commandInvocation,
  resolveCommandInvocation,
} from "../src/lib/process/executable-resolve.ts";
import {
  describeGlyphReplacements,
  normalizeCp936Glyphs,
} from "./ci-cp936-glyphs.mjs";

/* 这两个别名只为一件事：模块里那两兄弟的名字都长，而它们各自要表达的是**收什么**——
 * `resolveCommandInvocation` 收**名字**（PATH 查找 + 形态），`commandInvocation`
 * 收**已定位的候选路径**（只问形态）。职责不同、不可互换，用在哪见
 * `resolveShellInvocation()`。
 *
 * ⚠️ 别名**不承担**「避开同名遮蔽」的职责：那件事已由 executor 的形参改名解决
 * （`settle`，见头注第三个坑），不再依赖读者记住「某两句必须写在 executor 外面」。 */
const resolveByName = resolveCommandInvocation;
const resolveByPath = commandInvocation;

/** 中文 Windows 的 ANSI 代码页 —— 平台那一跳读的就是它。 */
export const CP936_CODE_PAGE = 936;

/**
 * 转码那一步（起 PowerShell 把一批字节按 936 重发）的**墙钟预算**（毫秒）。
 *
 * 它不是一个性能旋钮，是**外壳不会把流水线停住**的边界：`writeCp936` 用的是
 * `spawnSync`（同步），而它跑在子进程 `data` 回调里 —— 挂住一次就等于把整条链
 * 停在那里（子进程的管道随即填满、它也卡住，`close` 永不到来）。正常形态是
 * 「PowerShell 冷启动 + 编一批字节」，本机实测几十到几百毫秒；给两个数量级的余量，
 * 撞上它只会退化成「原文照打 + 说明」那条既有出口（转码失败不是判据）。
 */
export const TRANSCODE_TIMEOUT_MS = 30_000;

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
 * 有了它，这条链的**真实现**（起什么、`encoding` / `stdio` 是什么）在本地就能判。
 *
 * `stdio` **只作用于 stdout / stderr**（stdin 恒留在管道上）：它默认 `"inherit"`，
 * 由调用方在 Windows 那条路上显式传同一个值。生产**必须**是 `"inherit"` —— 否则
 * PowerShell 编好的那批 936 字节收进 `r.stdout` 就没了（见文件头那条坑）。
 * 而 stdin 不能跟着 `"inherit"`：那份 UTF-8 原文就是从 stdin 递给 PowerShell 的
 * （`input`），两者配在一起时 `input` 会被**静默丢掉**（stdin 变成真终端），
 * PowerShell 的 `[Console]::In.ReadToEnd()` 读到空串 ⇒ 日志仍然一个字都没有。
 *
 * @param {string} text UTF-8 文本（子进程的原始输出）
 * @param {{platform?: NodeJS.Platform,
 *          run?: (cmd: string, args: string[], input: string) => {status: number|null},
 *          spawnImpl?: typeof spawnSync,
 *          stdio?: "inherit" | "pipe"}} [ports]  `stdio` 只作用于 stdout / stderr
 * @returns {{ok: boolean}}
 */
export function writeCp936(
  text,
  {
    platform = process.platform,
    run,
    spawnImpl = spawnSync,
    stdio = "inherit",
  } = {},
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
      const r = spawnImpl(cmd, args, {
        input,
        encoding: null,
        /* **PowerShell 的 stdout 已经就是那批 936 字节** —— 让它直接落到本进程的
         * stdout，不要再经我们手里过一道。
         *
         * 这一格此前是 `pipe`（`spawnSync` 的默认）+ `encoding: null`：字节确实
         * 编对了，却被收进 `r.stdout` 这个 Buffer，然后**整份丢掉** —— 平台的
         * stage 日志里因此**一个字都没有**（外壳把子进程的输出吞了，正是「退出码
         * 转了、输出没转」那种形态）。`"inherit"` 是这一格的正确取值：
         * 我们要的是「原样落到日志」，不是「取回来再加工」。
         *
         * 判据钉在「默认实现交出去的 stdio 是 inherit」（`spawnImpl` 注入面）。 */
        /* **只把 stdout / stderr 接出去，stdin 必须留在管道上** —— 那份 UTF-8
         * 原文就是从 stdin 递给 PowerShell 的（`input`），而 `stdio: "inherit"`
         * 是一句「三路都别再管」的话：配 `input` 用时它会**静默丢掉** `input`
         * （stdin 变成真终端），PowerShell 的 `[Console]::In.ReadToEnd()` 于是
         * 读到空串、一个字节都不发。那就是本条出口第一次修完之后**依然全空**的
         * 原因（平台侧 `E2E 关键流程` 那一格：退出 1、日志零行）。
         * ⇒ 要表达的是「标准输出那两路落日志」，不是「整个 stdio 都别管」。 */
        stdio: ["pipe", stdio, stdio],
        /* **转码这一步必须有预算**（ISSUE #1977 第八轮）：`spawnSync` 无 `timeout`
         * 就是「挂住就一直挂」—— 而它是**同步**的，挂在 `data` 回调里等于把整条链
         * 停住：子进程那一侧的管道很快填满、它卡在 `write()` 上，`close` 永不到来，
         * 平台那 36 分钟读到的就是**零行**（与「攒到 `close` 才发」那一处同形、
         * 但坏在更早的一跳）。判到预算即放弃转码：调用方会走「原文照打 + 说明」
         * 那条路 —— 转码是外壳、不是判据，退出码不受影响。 */
        timeout: TRANSCODE_TIMEOUT_MS,
      });
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
 * 把一块刚到的字节切成「整行 + 行尾残余」——**流式转码的那一半**（ISSUE #1977 第六跑）。
 *
 * ## 为什么需要它：外壳此前把整段输出攒到 `close` 才发
 *
 * 前几跑每一次都是「退出码转了、日志一个字都没有」，而当时代码是对的（`stdio`
 * 三路已修）。真因在**时序**上：`runWithCp936Exit` 原来的写法是
 * `chunks.push(...)` → `close` 时 `chunks.join("")` → 一次 `write()`。对**秒级**
 * 的 stage（`类型检查` / `文件结构硬规则`…）那是看不出差别的：命令退出了，输出就发出去了。
 * 对**分钟级**的 stage 则是灾难 —— `E2E 关键流程` 那一步跑到 36 分钟被平台按 stage
 * 超时 **kill**（`timeout of 2160000ms exceeded`），`close` 那个回调**再也不会来**，
 * 攒了一整轮的 `chunks` 随进程一起消失：日志**零行**，而唯一能读到的错误是平台那句
 * 与真因无关的「超时」。
 *
 * ⇒ 「输出被吞」在**长跑 + 被 kill** 这一格上的形态不是「发不出去」，是「发得太晚」。
 * 处置是**边到边发**：每来一块就切出**整行**立刻转码 / 落盘，行尾那份可能被截断的
 * 残余留在 `carry` 里等下一块（**不能**把半个字符按 CP936 编出去 —— GBK 是变长的，
 * 截断在多字节序列中间会编出乱码字节；按 `\n` 切天然避开这一格）。
 *
 * 纯函数 + 显式出入参：本文件的两条出口（转码、退出码）各有注入面，而「怎么切」这件事
 * 与它们正交，单独判得动。
 *
 * @param {string} carry 上一块没切完的行尾残余（首块传空串）
 * @param {string} chunk 这一块新到的文本
 * @returns {{text: string, carry: string}}  `text` 是要立刻发出去的**整行**（含换行符）
 */
export function splitStreamChunk(carry, chunk) {
  const joined = carry + chunk;
  const lastBreak = joined.lastIndexOf("\n");
  if (lastBreak === -1) return { text: "", carry: joined };
  return {
    text: joined.slice(0, lastBreak + 1),
    carry: joined.slice(lastBreak + 1),
  };
}

/**
 * 这一 token 是**路径**还是**名字**？
 *
 * 判据只影响「解析口说找不到时算不算失败」，而不是「怎么起」：
 *
 *   · 清单里的命令**两类对象都有**，而**路径**那一类今天只剩 `scripts/check-*.cjs`
 *     与 `node scripts/*.mjs` 这一种形态 —— `pnpm` / `node` 是**名字**（要靠 PATH +
 *     PATHEXT 解析，Windows 上这才是那条会踩坑的）；
 *   · `resolveCommandInvocation()` 是**纯 PATH 查找**，对一条相对路径它当然
 *     报 `resolved: false` —— 那不是「找不到」，是「这条不是名字、不该问 PATH」。
 *     把两者混作一谈，就会在类型检查那一格上误红（本文件第一次上平台之后的现场：
 *     `PATH 上找不到这条命令：node_modules/.bin/tsc`）。
 *
 * 含分隔符即按路径处理（Windows 两种分隔符都认），**不判它存不存在** ——
 * 起不起来由 spawn 自己的结论回答（ENOENT 照样是可见出口），这里只回答
 * 「该不该拿 PATH 去找它」。
 *
 * ⚠️ **「不问 PATH」只是这一半**：一条**盘上确实存在的**路径在 Windows 上同样可能
 * 起不来 —— `node_modules/.bin/<工具>` 是 pnpm 摆的三个垫片（`.cmd` / `.ps1` /
 * 无扩展名 shim），Node 一个都起不来（`.cmd` 只有 cmd.exe 解释、shim 是 shebang）。
 * 所以路径这一步还要交给**形态判据**（`commandInvocation`）把 `.ps1` 回退找出来，
 * 否则「不问 PATH」换来的只是「不误报」，命令照样起不来。见 `resolveShellInvocation()`。
 *
 * @param {string} token
 * @returns {boolean}
 */
function isPathLike(token) {
  return token.includes("/") || token.includes("\\");
}

/**
 * 「这条命令在这台机器上怎么起」—— 本文件唯一一次解析。按 token 形状分两条：
 *
 *   · **名字**（`pnpm` / `node`）→ `resolveByName()`：PATH 查找 + 形态。
 *   · **路径**（`node_modules/.bin/tsc` / `scripts/check-*.cjs`）→ 先 `path.resolve`
 *     绝对化，再交 `resolveByPath()` 问形态。这一层**必须**在，不能把路径原样丢给
 *     `spawn`：同目录的 `.ps1` 回退（`siblingFallback`）才是 Windows 上唯一能起的
 *     形态（见 `isPathLike()` 的注释）。绝对化那一步在 POSIX 上是恒等的 —— 它的
 *     用处是让形态判据的同目录查找与 cwd 解耦。
 *
 * 探针参数刻意用 `["--version"]` 而**不是**那条命令的真实参数：形态判据判「这个候选
 * 起不起来」的方式是**真起一次**，拿 `pnpm install --frozen-lockfile` 当探针等于把
 * 整个安装跑两遍。这里要的只是「起不起来」，非零退出也算起得来。
 *
 * @param {string} command `.cnb.yml` 里写的那条命令
 * @param {string[]} args 那条命令自己的参数（原样转交，本函数不改写）
 * @param {{platform?: NodeJS.Platform,
 *          env?: NodeJS.ProcessEnv | Record<string, string | undefined>}} [options]
 *   往下交给 `resolveCommandInvocation()` / `commandInvocation()`。
 *   **缺省仍是 `process.env` / `process.platform` ⇒ 生产侧一个字不改。**
 *   这一跳以前一个 options 都不接，于是调用方注入的 `env` 停在半路：
 *   「默认解析口接没接上」那条判据实际问的是**这台机器的 PATH**（Windows 上
 *   解析到 corepack 那句 `pnpm.ps1`、经宿主起 ⇒ 起的是 `pwsh.EXE`），
 *   换一台机器换一个答案 —— 那是「判据与宿主绑死」那一族（#1397 同形）。
 *
 * ⚠️ 这一层**只接 `env`，不接 `platform`**（`runWithCp936Exit` 那侧的调用点写死只传 env），
 *   理由是同一份文件里那两条「模拟非 Windows」的用例**真起外部命令**（`echo`）：
 *   把 `platform` 也交给解析口，POSIX 规则下 `executableExts` 只剩无扩展名那一档，
 *   Windows 的 PATH 上一个都找不到 ⇒ 那两条从「判转码」变成「判这台机器有没有
 *   一个叫 `echo` 的无扩展名文件」。它们要模拟的是**出口那一半**（转码 vs 原样转出），
 *   从来不是解析层。所以这里的边界是刻意的，代价与出处见 `runWithCp936Exit`。
 * @returns {{command: string, args: string[], resolved: boolean}}
 */
export function resolveShellInvocation(command, args, options = {}) {
  if (!isPathLike(command)) return resolveByName(command, args, options);
  const { command: c, prefixArgs } = resolveByPath(
    path.resolve(command),
    ["--version"],
    options,
  );
  return { command: c, args: [...prefixArgs, ...args], resolved: true };
}

/**
 * 「这条命令为什么起不来」的可读出口 —— 一句，带真因。
 *
 * 它存在的理由是一次**明明有结论、却指不出真因**的现场（ISSUE #1977 第四次上平台）：
 * 外壳只回 `起不了这条命令：node_modules/.bin/npx tsc --noEmit`，而真因是那次调用
 * 把**两条命令**当成了一条（盘上根本没有 `node_modules/.bin/npx tsc` 这个文件）
 * —— 报错点与真因隔着一整层，读日志的人只能去猜。
 *
 * 三件东西都摆出来，各自回答一个不同的问题，一个都不能省：
 *
 *   · `code`（`err.code`）—— **判据**：`ENOENT` 是「盘上没这件东西」（多半是名字 /
 *     入参写错），`EACCES` / `EINVAL` 是「有，但起不来」（Windows 上那是批处理 /
 *     shim 形态，处置是走 `resolveCommandInvocation`，见 §2.1.1）。两者混在一句
 *     「起不了」里，人就只能靠试；
 *   · 解析口交回的**绝对路径**（`通过解析口` 那一行，只在解析发生时才打）—— 这条路径
 *     是不是一行 `module.exports` 的 shim，看它一眼就知道；
 *   · **当前目录 + 原文**（`命令` 那一行）—— 相对路径是相对**谁**的，不写出来就得猜
 *     （stage 的工作目录由平台给，本壳看不到）。
 *
 * 参数都显式传（不用 `process.*` 兜底）：**不写代码进 spawn 事件里**是 §11.8 那条
 * 「代码要不要进代码」的默认答案，也是让这条出口能被单测直接喂假错误码的原因。
 *
 * @param {{err: unknown, command: string, realCommand?: string,
 *          cwd?: string}} input
 * @returns {string}
 */
export function formatSpawnFailure({ err, command, realCommand, cwd }) {
  /** `spawn` 的 error 是 Error 的运行时子类，`code` 由 libuv 填
   *  （与 `executable-resolve.ts` 里读它那一处同一形状）。 */
  const spawnError = /** @type {NodeJS.ErrnoException | undefined} */ (err);
  const code = spawnError?.code ?? "未知";
  const where = cwd ? `（当前目录 ${cwd}）` : "";
  const lines = [
    `[cp936-exit] 起不了这条命令：${command}${where}`,
    `  失败码 ${code} —— ` +
      (code === "ENOENT"
        ? "盘上没有这个文件（名字 / 入参对不上？）"
        : "文件在、但起不来（形态不对？见 resolveCommandInvocation）"),
  ];
  /* 解析口交回的那一份只在**解析真的发生过**时才有意义：路径原样交出去时
   * `realCommand` 就是原文，再打一遍只是噪音。 */
  if (realCommand && realCommand !== command) {
    lines.push(`  通过解析口起的：${realCommand}`);
  }
  return lines.join("\n");
}

/** 「怎么结束的」没交代到号时转出去的那个非零退出码。 */
export const UNKNOWN_TERMINATION_EXIT = 128;

/**
 * 把子进程的结束方式折算成外壳要转出去的退出码（ISSUE #2571）。
 *
 * `code === null` **不是一档结果，而是「没有结果」**：它只说明这条命令不是自己退出的
 * （被信号终止，或连终止方式都没交代）。把它按 `?? 0` 落进「成功」，外壳就从
 * 「不替子进程编结论」变成「替它编了一条通过」—— 与 §13.6.4.1 那句
 * 「拿不到测量 ≠ 测量结果是红的」是同一条区分，只是方向反过来：拿到的既不是红、
 * 也不该被念成绿。
 *
 * 号按 POSIX 惯例折算（`128 + 信号号`，与 shell 报给调用方的那套一致），查表用
 * `os.constants.signals`；查不到号时**仍然不许落回 0** —— 退到 `UNKNOWN_TERMINATION_EXIT`，
 * 让「被终止但号拿不到」与「干净退出」在账面上是两件事。
 *
 * @param {number | null} code
 * @param {string | null} signal —— 声明成 `string` 而**不是** `NodeJS.Signals`：那个联合是
 *   按 POSIX 列的，而 Windows 上 libuv 能报出没登记的号。把「查不到」写进类型之外，
 *   这一档就只在类型里存在、在运行时不存在 —— 而它恰恰是本函数要保证非零的那一档。
 * @returns {number}
 */
export function exitCodeFromTermination(code, signal) {
  if (typeof code === "number") return code;
  if (!signal) return UNKNOWN_TERMINATION_EXIT;
  const table = /** @type {Record<string, number | undefined>} */ (
    os.constants.signals
  );
  return 128 + (table[signal] ?? 0);
}

/**
 * 起命令、抓输出、以 CP936 重发、转出退出码 —— 编排那一层（文件尾的直接执行入口调它）。
 *
 * **退出码是这条 Promise 的唯一值**：入口里那句 `process.exit(code)` 是本文件唯一把
 * 结论转出去的地方（下游 stage 靠它判红绿）。
 *
 * @param {string[]} argv
 * @param {{platform?: NodeJS.Platform,
 *          env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *          spawnProc?: typeof spawn,
 *          write?: typeof writeCp936,
 *          resolve?: (cmd: string, args: string[], options?: {
 *            platform?: NodeJS.Platform,
 *            env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *          }) => {command: string, args: string[], resolved: boolean},
 *          out?: (chunk: string) => void}} [ports]
 * @returns {Promise<number>} 该转出去的退出码
 */
export function runWithCp936Exit(
  argv,
  {
    platform = process.platform,
    env = process.env,
    spawnProc = spawn,
    write = writeCp936,
    resolve = resolveShellInvocation,
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
  /* 解析口自己就是那位执行者（默认值 `resolveShellInvocation`：名字查 PATH、路径过
   * 形态判据）。这里只负责把它交出的形状校验一遍。
   *
   * ⚠️ **只把 `env` 交下去，`platform` 刻意不交**。两条都是「注入面」，但只有一条是
   * 解析层的事实：`env` 决定**问哪张 PATH**（不交，用例造的自己那个假 PATH 根本不参与，
   * 于是「默认解析口接没接上」那条判据实际判的是这台机器上恰好装着什么 —— Windows 上
   * 它解析到 corepack 的 `pnpm.ps1`、经宿主起，`seen[0]` 成了 `pwsh.EXE`，实测红）。
   * 而 `platform` 交下去会**改掉另一批用例判的东西**：同一份文件里那两条
   * 「模拟非 Windows」的用例真起 `echo`，POSIX 的 `executableExts` 只剩无扩展名那一档，
   * Windows 的 PATH 上一个都找不到 ⇒ 它们从「判转码不转码」变成「判这台机器有没有
   * 一个叫 `echo` 的无扩展名文件」。那两条要模拟的是出口那一半，从来不是解析层。
   * 边界写在代码里而不是靠人记得，见 `resolveShellInvocation` 的那条 ⚠️。 */
  const invocation = resolve(command, args, { env });
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
  /* 形参叫 `settle` 而**不是** `resolve`：上面那个 `resolve` 是解析口的名字，同名会
   * 让「谁在调谁」变成读者要推的事（这条遮蔽本文件真踩过，见头注第三个坑）。 */
  return new Promise((settle) => {
    /* `shell: false` 是默认 —— 本文件**不**替调用方解释命令行。stage 里那条命令
     * 本身可能是 `pnpm run build` 这种带子命令的形态，但它的解析归它自己的宿主
     * （`.cnb.yml` 的 stage shell），这里只管把 token 原样递过去。 */
    const child = spawnProc(realCommand, realArgs, {
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    });
    /* **边到边发**，不是攒到 `close` 再发一次（见 `splitStreamChunk()` 的文件头）：
     * 攒着的那一版在**分钟级 + 外壳被平台按 stage 墙钟掐掉**的 stage 上会把整轮日志
     * 一起带走（那一档里本文件一句都不会执行）—— `E2E 关键流程` 那 36 分钟零行
     * 就是这么来的。⚠️ 当时归因为「被 kill 时 `close` 不再来」是**错的**：子进程被
     * 信号终止时 `close` 照来，见头注那一条与 ISSUE #2571。
     *
     * `carry` 是**行尾那半截**：按 `\n` 切而不是按块切，是因为一块可能正好截在
     * 多字节字符中间，按 CP936 编出去就是乱码字节（GBK 变长）。
     *
     * `warnedTranscodeFailure` 的作用是**让「转码没做成」那条提示只说一次**：
     * 它原来是每跑收尾一句，现在成了按行发，每行都重复一遍会把真输出埋掉。 */
    let carry = "";
    let warnedTranscodeFailure = false;
    /* 字形归一化的**跨块累计**（ISSUE #1977 那一族之外的一件事，见下）。
     *
     * 为什么要单独记一份：转码是**边到边发**的，一个 stage 的输出会分成很多块，
     * 而「这一跑里有哪些字符没有 CP936 字形」是**整跑**的性质。记在这里 ⇒
     * 收尾时能打一条**总数**；即时读数则只对**第一次出现的那个字符**打一条
     * （同一个字符重复出现几百次，逐次打会把真输出埋掉）。
     *
     * ⚠️ 记的是**原字符**而不是替代物：`✓` 与 `✔` 都归到 `√`，但它们在原文里
     * 是两回事，汇总时要能分辨。 */
    const glyphTotals = new Map();
    /**
     * 发一批**整行**文本：Windows 上过 PowerShell 转码、其余平台原样。
     *
     * `ok: false` 时原文照打（转码是外壳、不是判据），退出码不受影响。
     *
     * @param {string} text
     */
    const flush = (text) => {
      if (!text) return;
      if (platform !== "win32") {
        /* 非 Windows：CP936 这一跳不存在，原样转出（不假装转过了）。 */
        emit(text);
        return;
      }
      /* **先把没有 CP936 字形的字符换成读得出来的写法，再交给转码**。
       *
       * 这一步放在**转码之前**而不是之后：CP936 编不出来的字符，.NET 的编码器
       * 会把它们各自写成**一个问号**（单字节 `0x3F`）—— 而那个问号与「原文里本来
       * 就有的问号」逐字同形。放在之后就已经晚了（信息在那一步就没了）。
       *
       * 被吃掉的往往不是装饰，是判决：vitest 的**绿色通过标记** `✓` 就在这一列
       * （而红色失败标记 `×` 有字形、活得好好的）—— 于是「这一条过了」在日志上
       * 打印成一个问号。详见 `scripts/ci-cp936-glyphs.mjs` 的文件头。 */
      const normalized = normalizeCp936Glyphs(text);
      if (normalized.replaced.length > 0) {
        const fresh = [];
        for (const item of normalized.replaced) {
          const prev = glyphTotals.get(item.from);
          glyphTotals.set(item.from, {
            from: item.from,
            to: item.to,
            count: (prev?.count ?? 0) + item.count,
          });
          /* 第一次出现的字符才打即时读数：重复的那个只进总数。 */
          if (!prev) fresh.push(item);
        }
        if (fresh.length > 0) {
          /* ⚠️ **读数必须走 `write`（CP936 那一跳），不能走 `emit`** ——
           * `emit` 是本进程 stdout 的直写（UTF-8 字节），而平台按 CP936 解一切：
           * 走 `emit` 的中文会在日志里变成乱码，那正是这一层要治的病。
           * 这句话自己的字符也必须**全是 CP936 编得出来的**（`describeGlyphReplacements`
           * 保证了这一点）。 */
          const said = describeGlyphReplacements(fresh);
          /* 空串 = 这批全在登记表里（换法本来就读得出来）⇒ **整行不发**，
           * 发一个空行比不发更吵（ISSUE #2326）。 */
          if (said !== "") {
            const line = `${said}\n`;
            const { ok } = write(line, { stdio: "inherit" });
            if (!ok) emit(line);
          }
        }
      }
      /* 转码成功时**不必再 emit** —— `write()` 已经把 PowerShell 那份 936 字节
       * 直接接到本进程的 stdout 上了（`stdio: "inherit"`）。这里只在没做成时
       * 兜底把原文照打一遍。 */
      const { ok } = write(normalized.text, { stdio: "inherit" });
      if (ok) return;
      if (!warnedTranscodeFailure) {
        warnedTranscodeFailure = true;
        emit(
          "[cp936-exit] 转码这一步没做成（PowerShell 起不来？）—— 原文照打，" +
            "日志可能仍是乱码；退出码不受影响\n",
        );
      }
      emit(normalized.text);
    };
    for (const stream of [child.stdout, child.stderr]) {
      /* **显式钉 UTF-8**：`String(buffer)` 走 `buf.toString()`，其默认编码取自
       * `process.stdout` 的 `writableEncoding` —— Windows 上那是**宿主代码页
       * （CP936）**。看着等价，实则这条链的**第一跳**就在这里断：子进程的 UTF-8
       * 字节被按 936 解成乱码串，后面拿 PowerShell 再按 936 编回去只是把乱码换个
       * 编码存下来（「先解对、再编回」两段里的第一段，`ci-console-encoding.mjs`
       * 钉的是控制台那一半，这里钉的是抓子进程这一半）。 */
      stream?.setEncoding?.("utf8");
      stream?.on("data", (d) => {
        const split = splitStreamChunk(carry, String(d));
        carry = split.carry;
        flush(split.text);
      });
    }
    child.on("error", (err) => {
      /* 起不来（命令不存在）也是「这条命令的结论」，走同一个复核出口：
       * 原文照打 + 非零退出码（127 是壳里「命令没找到」的常规形态）。
       *
       * 但**「结论在」不等于「结论够用」**：这条出口此前只回一句
       * `起不了这条命令：<command>`，而真因的每一条线索都在手里 —— `err.code`
       * （`ENOENT` 是「盘上没这件东西」，`EACCES` / `EINVAL` 是「有，但起不来」，
       * 两者要做的处置完全不同）、解析口交回来的**绝对路径**（这条是一行
       * `module.exports` 的 shim 还是真的可执行文件，看路径就看得出）、以及
       * 调用方自己写的那份原文（相对路径与绝对路径在这里长得一样，分不开）。 */
      emit(
        formatSpawnFailure({
          err,
          command,
          realCommand,
          cwd: process.cwd(),
        }) + "\n",
      );
      settle(127);
    });
    child.on("close", (code, signal) => {
      /* 行尾那份残余（**没有换行符收尾的最后一个片段**）在这里补发：`close` 一到，
       * 那一行就到底了。
       *
       * ⚠️ 「被 kill 时 `close` 不会来」是本文件挂着的一条**错前提**（ISSUE #2571
       * 当场复现推翻）：子进程被信号终止时 `close` **照来**，带的是 `code=null` +
       * `signal=SIGTERM`。真「什么都不会来」的那一档是**外壳自己被杀** —— 平台按
       * stage 墙钟掐掉这一跳时，下面这几句根本没有执行者，而那时读到的结论是平台
       * 自己那句 `timeout … exceeded`（不是这里的退出码）。流式改造买的正是前一档
       * 之外的东西：被 kill 之前每一行都已经发出去了。 */
      flush(carry);
      carry = "";
      /* 收尾打一条**总数**：逐块那条只对第一次出现的字符说「这个被换过」，而
       * 「这一跑一共换了几处」是整跑才答得出的问题。逐块读数留给人看形态，
       * 这一条留给想核对总量的人。
       *
       * ⚠️ 同样走 `write`（CP936 那一跳）—— `emit` 那条路是 UTF-8 直写，
       * 平台按 CP936 解，中文会在那里变成乱码。
       *
       * 子进程被终止时这一条**照样打**（`close` 会来，见上面那段）—— 只有外壳
       * 自己被杀那一档才没有它，而那一档本来就没有任何一行是外壳写的。 */
      if (glyphTotals.size > 0) {
        const said = describeGlyphReplacements(
          [...glyphTotals.values()],
          "这一跑",
        );
        /* 与逐块那条同判据：只有落了 `\uXXXX` 兜底的才值得出声（ISSUE #2326）。
         * 一整跑都在登记表里 ⇒ 这一行也不发 —— 登记表的形状就应该是「安静地按设计跑完」。 */
        if (said !== "") {
          const summary = `${said}\n`;
          const { ok } = write(summary, { stdio: "inherit" });
          if (!ok) emit(summary);
        }
      }
      const exitCode = exitCodeFromTermination(code, signal);
      /* `code === null` = 「这条命令不是自己退出的」，而转出去的码是**外壳折算的**、
       * 不是子进程给的那个 ⇒ 必须念一行出声：不然读日志的人拿着 143 去查「哪条命令
       * 退 143」，而那条命令一次都没退出过。
       *
       * 同样走 `write`（CP936 那一跳）—— 这一行有中文，`emit` 那条 UTF-8 直写的路
       * 在平台上会被解成乱码（与上面那条总数同一个口径，ISSUE #1977）。 */
      if (code === null) {
        const how = signal ? `子进程被 ${signal} 终止` : "子进程没有交代结束方式";
        const line =
          `${how}（没有跑到结论）⇒ 外壳退出 ${exitCode}；` +
          "这不是那条命令自己退的码\n";
        const { ok } = write(line, { stdio: "inherit" });
        if (!ok) emit(line);
      }
      settle(exitCode);
    });
  });
}

/* 「是不是被直接执行」用**两侧都过 `path.resolve`** 的比较 —— 拼 `file://${argv[1]}`
 * 在 Windows 上恒不相等，那段就一次都不跑（与 `ci-toolchain-selfcheck.mjs`
 * /`python-probe.mjs` 同一条处置，它们的头注记着这个形态）。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const code = await runWithCp936Exit(process.argv.slice(2));
  /* 退出码**必须**转出去：外壳吞掉它等于把被包那条命令的结论一起吞掉
   * （`ci-toolchain-selfcheck.mjs` 的 `main()` 返回值被丢那一次就是这么红的）。 */
  process.exit(code);
}
