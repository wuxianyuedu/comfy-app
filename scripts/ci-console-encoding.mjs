/**
 * 构建机**控制台输出编码**的自证与纠正（ISSUE #1959）。
 *
 * ## 它存在的理由：一条实测出来的、会让整份 CI 日志读不懂的链路
 *
 * **原始模型**（#1959 那次的逐字节复算）：自托管 Windows 节点上，平台侧抓取 stage
 * 输出用的是**宿主的 ANSI 代码页**（中文 Windows 上是 CP936）。它在日志里留下的形态是：
 *
 *   · **PowerShell 自己**打的字**是好的** —— 它按 `[Console]::OutputEncoding`
 *     写字节，与抓取端同编码；
 *   · **Node / pnpm / drizzle-kit** 打的字**全是乱码** —— 它们无条件写 UTF-8，
 *     抓取端按 CP936 解，于是 `工具链自证通过 ✓` 变成 `宸ュ叿閾捐嚜璇侀€氳繃 鉁?`。
 *
 * ⚠️⚠️ **那条模型的病因，2026-10-16 被两轮探针读数改写了**（`工具链自证` 里固定吐中文，
 * 分别由 PS 原生 / cmd / node 三层产出；本文件 `--apply` 就跑在它们前面）：
 *
 *   编码探针·PS 原生：中文一二三  → 缂栫爜鎺㈤拡路PS 鍘熺敓锛氫腑鏂囦竴浜屼笁
 *   编码探针·CMD：中文一二三      → 缂栫爜鎺㈤拡路CMD锛氫腑鏂囦竴浜屼笁
 *   编码探针·NODE：中文一二三     → 缂栫爜鎺㈤拡路NODE锛氫腑鏂囦竴浜屼笁
 *
 * **两轮逐字相同**，而两轮之间这台机器换过两样东西：
 *
 *   · **控制台输出代码页** 936 → 65001（本文件的读数行自己打着这个值）；
 *   · **宿主 ANSI 代码页**也换成了 UTF-8（系统区域设置里勾了「使用 Unicode UTF-8 提供
 *     全球语言支持」并重启过，读数行里那个值同步变成 65001）。
 *
 * 换了两次、乱码一个字没变 ⇒ **抓取端的解码与这两个设置都不是同一件事**。
 * 同一份日志里还有一组更硬的对照：**runner 自己打的行（`script` 原文回显）是完好
 * 中文**，而**子进程输出的每一行**都是「UTF-8 字节按 CP936 解」⇒ 解码发生在
 * **子进程输出那一跳**，用的是**不与宿主设置联动的 CP936**。
 *
 * 所以本文件的纠正动作是**必要不充分**：
 *   · 它让控制台里那三层**自洽**（PS 与子进程写同一种字节），这是**下一步的前提**；
 *   · 但**它救不了平台侧的日志** —— 那一跳读什么，不由控制台代码页、也不由 ANSI 代码页决定。
 * 剩下的仓库侧出路是**让每个字节以 CP936 出口**（逐 stage 转码；Node 没有 GBK 编码器，
 * 得靠 PowerShell 的 `GetEncoding(936)` 包一层），代价见规范 §13.5.3.5 最后一节。
 * 为此 `工具链自证` 里加了**第 4 行探针**：绕过控制台对象、**直接以 CP936 字节写
 * stdout** —— 它可读就等于把「解码端是 CP936」钉死，上面那条出路才作数。
 * 读数与判读记在 `docs/standards/13-提交与-code-review.md` §13.5.3.5。
 *
 * 这条不是猜的：把 `宸ュ叿閾捐嚜璇侀€氳繃` 按 UTF-8 取字节再按 GBK 解，正好回到
 * `工具链自证通过`；末尾那个 `?` 是 `✓`（U+2713，UTF-8 三字节 `E2 9C 93`）被
 * CP936 解出 `鉁` 之后剩下的孤字节 —— 同一份日志里 `Set-Variable : 缺少参数…`
 * （PowerShell 打的）却是完好中文，两者互为对照。
 *
 * ## 那纠正动作为什么还是「把控制台输出编码钉成 UTF-8」
 *
 * `[Console]::OutputEncoding` 与 `chcp` 改的是**控制台对象**上的设置，同一个控制台
 * 里的进程共享它。钉成 UTF-8 之后，控制台里的 PS 与子进程写的是同一种字节、
 * 与源码和 Node 的默认行为一致 —— 而**这正是「以 CP936 出口」那一步能成立的前提**：
 * 不先让 PS 把 Node 的 UTF-8 解对，转码那一步手里拿到的**已经是乱码串**了，
 * 再转一次只是把乱码换个编码存下来。
 *
 * ## 边界（刻意不做的事）
 *
 *   · **不改磁盘上的文件编码**（源码仍是 UTF-8，那是另一回事，由仓库门禁守着）；
 *   · **不吞失败**：这些命令在非 Windows 上本就无处可设，`applyConsoleEncoding()`
 *     如实返回「没做 / 做了什么」，由调用方打印，不静默；
 *   · **不做第二份「有没有乱码」的判据**：抓取端怎么解码，本进程看不到 ——
 *     能被机器判的只有**宿主当前的代码页**这一个读数（`readConsoleEncoding()`）。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

/**
 * 想钉上的目标代码页 —— UTF-8。
 *
 * 它同时是判断读数「对不对」的基准，所以两处不许各写一个数字。
 */
export const UTF8_CODE_PAGE = 65_001;

/**
 * 一条子进程的读数 —— `applyConsoleEncoding` / `readConsoleEncoding` 共用的形状。
 *
 * @typedef {{status: number | null, out: string}} RunResult
 */

/**
 * 走一条子进程并取回「退出码 + 合并输出」—— 两个函数共用的唯一一份。
 *
 * 测试的注入面就是它（`runImpl`）：真实实现 `spawnSync`，用例给假的。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {RunResult}
 */
function defaultRun(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawn 失败时 stdout/stderr 实测为 null，@types/node 按 string 标
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/**
 * 读宿主当前的编码读数（**只读、不改任何东西**）。
 *
 * 走 PowerShell 问三件事：
 *   · `[Console]::OutputEncoding.CodePage` —— **控制台输出代码页**（决定控制台里
 *     PS 与子进程写的字节是否同编码）；
 *   · 注册表 `…\Nls\CodePage\ACP` —— **宿主 ANSI 代码页**（`GetACP()` 的那个值，
 *     本模块以前只量控制台代码页，这一项是 2026-10-16 补的）；
 *   · `chcp` 的原始输出 —— 人眼熟悉的那一行，排障时对数用。
 *
 * ⚠️ **这三项都不是「平台按什么解码」的答案**（两轮探针把前两个嫌疑人都否掉了，
 * 见文件头注）。留着它们是因为：**下次不必再靠推断**——要否掉一个嫌疑人，先得量到它。
 *
 * 非 Windows / 探测失败时返回 `null` 字段而不是抛错：**「没量到」不等于「量到的是错的」**
 * （与 `ci-toolchain-python.mjs` 的 `findPython` 同一口径）。
 *
 * @param {{platform?: NodeJS.Platform, runImpl?: (cmd: string, args: string[]) => RunResult}} [ports]
 * @returns {{codePage: number | null, chcpRaw: string | null, ansiCodePage: number | null}}
 */
export function readConsoleEncoding(ports) {
  const { platform = process.platform, runImpl } = ports ?? {};
  if (platform !== "win32") {
    return { codePage: null, chcpRaw: null, ansiCodePage: null };
  }
  const run = runImpl ?? defaultRun;
  const nls = String.raw`HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage`;
  const r = run("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Console]::OutputEncoding.CodePage; " + `'ACP=' + (Get-ItemProperty '${nls}').ACP; ` + "chcp",
  ]);
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- r.out 是子进程执行封装（可注入）的出参，类型按 string 标窄
  const out = String(r.out ?? "").trim();
  const empty = { codePage: null, chcpRaw: null, ansiCodePage: null };
  if (r.status !== 0 && out === "") {
    return empty;
  }
  /* 取**第一处**数字 = 第一行那个控制台代码页；`chcp` 排最后，故取最后一行当原文。
   * ACP 单独带标签，免得与 `chcp` 那行里的数字撞车。 */
  const codePage = Number(/(?<code>\d{3,5})/.exec(out)?.groups?.code ?? Number.NaN);
  const acp = Number(/ACP=(?<code>\d{3,5})/.exec(out)?.groups?.code ?? Number.NaN);
  return {
    codePage: Number.isFinite(codePage) ? codePage : null,
    chcpRaw: out.split("\n").pop()?.trim() ?? null,
    ansiCodePage: Number.isFinite(acp) ? acp : null,
  };
}

/**
 * 把当前控制台的输出编码钉成 UTF-8。
 *
 * `chcp` 与 `[Console]::OutputEncoding` 都设：前者改控制台的输出代码页（抓取端按它
 * 解码），后者改 PowerShell 自己写字节时用的编码 —— 两个都设上，Node 与 PowerShell
 * 的输出才会重新落在同一个编码上。
 *
 * 失败时**不抛**，返回一条人能读的读数：这一步是纠正动作，不是判据；它没做成时
 * 合理的处置是「日志里继续是乱码」，而不是把流水线弄红。
 *
 * @param {{runImpl?: (cmd: string, args: string[]) => RunResult, platform?: NodeJS.Platform}} [ports]
 * @returns {{applied: boolean, detail: string}}
 */
export function applyConsoleEncoding({ runImpl, platform = process.platform } = {}) {
  if (platform !== "win32") {
    return {
      applied: false,
      detail: "非 Windows 宿主：控制台输出编码无处可设",
    };
  }
  const run = runImpl ?? defaultRun;
  const script =
    `chcp ${UTF8_CODE_PAGE} > $null; ` +
    `[Console]::OutputEncoding = [Console]::InputEncoding = ` +
    `[Text.UTF8Encoding]::new($false); ` +
    `[Console]::OutputEncoding.CodePage`;
  const r = run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- r.out 是子进程执行封装（可注入）的出参，类型按 string 标窄
  const after = Number(/(?<code>\d{3,5})/.exec(r.out ?? "")?.groups?.code ?? Number.NaN);
  if (after === UTF8_CODE_PAGE) {
    return {
      applied: true,
      detail: `控制台输出编码已钉成 ${UTF8_CODE_PAGE}（UTF-8）`,
    };
  }
  return {
    applied: false,
    detail:
      `没能把控制台输出编码钉成 ${UTF8_CODE_PAGE}` +
      `（原样返回：${r.out === "" ? "无输出" : r.out}）`,
  };
}

/**
 * 某个代码页读数**是否就是我们要的 UTF-8**。
 *
 * `null`（没量到）回 `null` —— 调用方据此说「不知道」，不许当成「对」或「错」。
 *
 * @param {number | null} codePage
 * @returns {boolean | null}
 */
export function codePageIsUtf8(codePage) {
  if (codePage === null || !Number.isFinite(codePage)) {
    return null;
  }
  return codePage === UTF8_CODE_PAGE;
}

/* 只在被直接执行时跑 —— 判「是不是直接执行」用**两侧都过 `path.resolve` 的比较**，
 * 与 `ci-env-probe.mjs` / `ci-toolchain-selfcheck.mjs` 同一处置（拼
 * `file://${argv[1]}` 在 Windows 上恒不相等，那段就一次都不跑）。
 *
 * 形态：
 *   node scripts/ci-console-encoding.mjs          只打读数（不碰任何设置）
 *   node scripts/ci-console-encoding.mjs --apply  先把控制台输出编码钉成 UTF-8，再打读数
 *
 * 两种形态都**恒退 0**：它是纠正动作与读数，不是判据。真要说「乱码还没解决」，
 * 那是日志读的人看得见的事，把它变成红只会拦住与之无关的变更。
 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const apply = process.argv.includes("--apply");
  if (apply) {
    const r = applyConsoleEncoding();
    console.log(`[console-encoding] ${r.detail}`);
  }
  const now = readConsoleEncoding();
  const ok = codePageIsUtf8(now.codePage);
  console.log(
    ok === null
      ? "[console-encoding] 控制台输出代码页：没量到（非 Windows 或探测失败）"
      : `[console-encoding] 控制台输出代码页：${now.codePage}` +
          `（${ok ? "UTF-8，与 Node 的输出对齐" : "非 UTF-8 —— 控制台里 PS 与子进程写的不是同一种字节，至少有一层会乱"}）`,
  );
  if (now.ansiCodePage !== null) {
    console.log(
      `[console-encoding] 宿主 ANSI 代码页（注册表 Nls\\CodePage\\ACP）：${now.ansiCodePage}`,
    );
  }
  if (now.chcpRaw) {
    console.log(`[console-encoding] chcp 读数：${now.chcpRaw}`);
  }
  console.log(
    "[console-encoding] 平台侧解码读的**不是**上面这两个读数（2026-10-16 两轮探针都" +
      "否掉了：控制台换 65001 与 ANSI 换 UTF-8 之后，四行探针逐字未变）——" +
      " 怎么读这一页见本文件头注与规范 §13.5.3.5",
  );
  process.exit(0);
}
