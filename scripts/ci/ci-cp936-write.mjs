#!/usr/bin/env node
/**
 * `ci-cp936-write.mjs` —— CP936 出口链条的**写字节那一半**（从 `ci-cp936-exit.mjs`
 * 按职责切出：那份文件贴着 §12.6 R5 的 900 行硬闸，#3412 的兜底把余量用完了，
 * 切法与 `ci-mirror-retry-policy.mjs` 同一纪律 —— 按职责切出去、主文件原样转出，
 * 用例与调用方的导入面一个字都不用改）。
 *
 * 它管的只有一件事：**把一批 UTF-8 文本以 CP936 真正落到 stdout**（本仓唯一一处
 * 真落字节的地方）。编排（起命令、抓输出、边到边发、退出码折算）留在主文件；
 * 两份文件头注互指 —— 本文件的深层叙事（为什么必须借 PowerShell、抓取端为何
 * 判不到）也在主文件那份头注里。
 *
 * 为什么转码这一步必须借 PowerShell（Node 没有 GBK 编码器）：实测
 * `new TextEncoder("gbk")` 不抛错，但**落到 UTF-8**（`NONSTANDARD_allowLegacyEncoding`
 * 也不认），所以 Node 侧编码不出 GBK 字节。而 `TextDecoder("gbk")` 是好的
 * （Node 带全 ICU）—— 这条链只能借 PowerShell 的 `[Text.Encoding]::GetEncoding(936)`。
 * 这也是规范里那句「Node 无 GBK 编码器，得靠 PowerShell 包一层」的由来。
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

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
 * `spawnImpl` 是**第三个注入面**，专为一件在 Linux 上够不到的事存在：默认实现
 * 里那句 `spawnSync` 只会在 Windows 分支跑到，而平台侧第一次红正是它（见下）。
 * 有了它，这条链的**真实现**（起什么、`encoding` / `stdio` 是什么）在本地就能判。
 *
 * `stdio` **只作用于 stdout / stderr**（stdin 恒留在管道上）：它默认 `"inherit"`，
 * 由调用方在 Windows 那条路上显式传同一个值。生产**必须**是 `"inherit"` —— 否则
 * PowerShell 编好的那批 936 字节收进 `r.stdout` 就没了（见那条坑）。
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
  { platform = process.platform, run, spawnImpl = spawnSync, stdio = "inherit" } = {},
) {
  if (platform !== "win32") {
    return { ok: false };
  }
  const { script } = encodeCp936Plan();
  const exec =
    run ??
    ((cmd, args, input) => {
      /* `encoding` 要么是**编码名字符串**（如 `"utf8"`）、要么是 `null` 表示
       * 「stdout/stderr 给 Buffer」。`"buffer"` 与 `Buffer` **两者都不行** ——
       * 它们都会被当编码名去 `Buffer.isEncoding` 查表，而查不到时 `spawnSync`
       * 在 `Buffer.from(input, encoding)` 那里当场抛 `ERR_UNKNOWN_ENCODING`。
       * 这一句本是本条出口第一次上平台唯一真炸的那一处（`工具链自证` stage 直接红），
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
  const r = exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], text);
  return { ok: r.status === 0 };
}
