// 命令行回显：把「这台机器上真正要执行的那条命令行」以单行形式打印出来。
//
// 为什么收成一处：脚本过去只打印步骤名（「1/4 执行 pnpm build」/「步骤 1/2：pnpm install」），
// 真正被执行的命令行只在**失败分支**里才出现 —— 顺利时看不到，出问题时才补一句，
// 恰好把排查最需要的证据放在最晚的时刻。而 pnpm 的可执行形态在一台机器上可能有多个
// （无扩展名 shim / `.ps1` / `.cmd`，判定见 shell.mjs 的 whichCommand），最终选中哪一个
// 取决于 PATH 顺序与文件形态：不回显就只能靠猜（ISSUE #576 的四轮现场全是这样来的）。
//
// 口径：
//   · 回显的是**形态判据选出来的那条命令行**（command + 宿主参数 + args），
//     不是调用方源码里写的字面量 —— Windows 上二者常常不是同一条；
//   · 前缀统一 `>>> `，与 quality-gate.ps1 / run-tests.ps1 既有的写法同形，
//     `grep '>>>'` 就能取到一次运行里执行过的全部命令行；
//   · 只回显**动作命令**（起服务 / 装依赖 / 跑门禁 / 构建 / 探测端口·进程·工具链）。
//     模块内部为取证而发的查询（读 HEAD、比对基线用的 `git rev-parse`）不回显：
//     它们是被动查询、次数多、没有操作意义，回显只会把真正的动作淹掉。

/** 回显总开关：置 `0` 即整体静默（给需要机器解析 stdout 的场景留出口）。 */
const ECHO_ENV = "COMFYAPP_ECHO_COMMANDS";

/** 需要加引号的字符：空白与各 shell 里会被解释成别的东西的元字符。 */
const SHELL_SPECIAL = /[\s"'`$&|<>^(){};*?[\]!#%]/;

/**
 * 单个参数的安全写法：必要时用双引号包住，内部的双引号转义。
 *
 * 只承诺「人读得懂、多数情况下能直接复制粘贴」，**不**承诺某个具体 shell 的逐字重放
 * （PowerShell 的 `$` 展开、cmd 的 `%` 展开都不在本函数职责内）—— 回显的用途是让人
 * 一眼看出跑的是哪条命令，而不是生成一份可被 shell 复算的转义文本。
 *
 * @param {unknown} value 参数原值（非字符串会被 String() 化，保持与 spawn 一致）
 * @returns {string}
 */
function quoteArg(value) {
  const text = String(value);
  if (text === "") return '""';
  if (!SHELL_SPECIAL.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

/**
 * 把「命令 + 参数」拼成一行可读文本（不加前缀、不打印）。
 *
 * @param {string} command 可执行文件（通常已是绝对路径）
 * @param {unknown[]} [args] 参数列表
 * @returns {string}
 */
export function formatCommandLine(command, args = []) {
  return [command, ...args].map(quoteArg).join(" ");
}

/** 回显是否开启（`COMFYAPP_ECHO_COMMANDS=0` 关闭）。 */
/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env @returns {boolean} */
function echoEnabled(env) {
  return String(env[ECHO_ENV] ?? "") !== "0";
}

/**
 * 回显一行即将执行的命令行。
 *
 * @param {string} command 可执行文件（形态判据选出来的那个）
 * @param {unknown[]} [args] 传给它的参数（含宿主前缀参数）
 * @param {{ label?: string | null, sink?: (text: string) => unknown,
 *           env?: NodeJS.ProcessEnv | Record<string, string | undefined> }} [options]
 *   `label` 是给这一行加的短标记（同一命令在不同位置有不同角色时用）；
 *   `sink` 可注入（单测捕获输出用，缺省写 stdout）；`env` 可注入（单测开关用）。
 * @returns {string | null} 实际打印的那一行；被开关关掉时为 null
 */
export function echoCommandLine(
  command,
  args = [],
  {
    label = null,
    sink = (text) => process.stdout.write(text),
    env = process.env,
  } = {},
) {
  if (!echoEnabled(env)) return null;
  const line = `>>> ${label ? `[${label}] ` : ""}${formatCommandLine(command, args)}`;
  sink(`${line}\n`);
  return line;
}
