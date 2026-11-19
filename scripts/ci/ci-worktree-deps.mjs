#!/usr/bin/env node
/**
 * ci-worktree-deps.mjs — 平台侧跑**依赖**之前的两道体检：`node_modules` 在不在、`npm_config_*` 干净不干净。
 *
 * ## 它补的是哪一格
 *
 * `受影响用例`（以及每日那一跑）要起 vitest，而这件事有两次**静默失败**，两次都长得像
 * 「用例红了」：
 *
 *   ① **依赖没装上**：`vitest` 起不来，输出里只有几条 `Error:` 与一段 `AggregateError`，
 *      一条用例都没跑 —— 而格子的退出码非零，于是它被读成「这次改动有回归」。
 *      `pnpm install` 那一步退了 0 也说明不了什么（它可能整个被跳过）。
 *      判据只有一个：`node_modules/.modules.yaml` 在不在（与启动器、`ci-install-deps.mjs`
 *      同一份口径 —— pnpm 自己写的元数据）。**不许抄成「目录在不在」**：空目录与
 *      「装好了」在 `existsSync` 眼里是同一件事。
 *   ② **`npm_config_*` 串进来了**：pnpm 与 lifecycle 脚本会继承调用方的 `npm_config_*`，
 *      其中前缀 / store / global 那几条带执行期校验，配错时每次调用都抛
 *      `AggregateError`（与这次改动一个字都没关系）。
 *
 * ## 为什么是「体检」而不是「就地清理」
 *
 * 清理环境变量会改掉被测代码看到的世界（有些 `npm_config_*` 是被故意置的），
 * 而这一层能说的只有「这一跑的环境不干净」。所以本模块只**报**：一条人读的结论 +
 * 一条可粘的命令，处置由调用方决定（平台那一跳据此**退 2**：没判 ≠ 绿，见 §13.6.2）。
 *
 * ## 纯函数
 *
 * 不碰 `process.env`、不读盘、不读时钟 —— 判定全在入参上，于是两个入口与单测走的是
 * 同一句判据。
 */

/**
 * 参与体检的 `npm_config_*` 键 —— 只收**会影响安装 / 执行形态**的那几个。
 *
 * `npm_config_registry` 之类的良性覆盖刻意不收：把它报出来只会让人学会忽略这条读数。
 */
export const NPM_CONFIG_KEYS = [
  "npm_config_prefix",
  "npm_config_cache",
  "npm_config_store_dir",
  "npm_config_store-dir",
  "npm_config_global",
  "npm_config_node_options",
];

/**
 * @typedef {{ok: boolean, lines: string[], advice: string | null}} WorktreeDepsReadout
 */

/**
 * 「这台工作区能不能跑那批用例」的两道体检。
 *
 * @param {{installed: boolean, env?: Record<string, string | undefined>}} input
 *   `installed` = `node_modules/.modules.yaml` 在不在（**调用方读盘**，本模块不读）。
 *   `env` 缺省视为空对象（= 没有任何 `npm_config_*`），与生产侧 `process.env` 同义。
 * @returns {WorktreeDepsReadout} `ok: false` 时 `advice` 一定非空（一条能粘的命令）
 */
export function worktreeDepsProblem({ installed, env = {} }) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const advice = [];

  if (!installed) {
    lines.push(
      "node_modules 不完整（缺 node_modules/.modules.yaml）—— **依赖没装上，这与用例红是两件事**：" +
        "vitest 起不来时的输出就是一串 Error 与 AggregateError，一条用例都没跑",
    );
    advice.push("pnpm install --frozen-lockfile");
  }

  const hit = NPM_CONFIG_KEYS.filter((k) => {
    const v = env[k];
    return typeof v === "string" && v.trim() !== "";
  });
  if (hit.length > 0) {
    lines.push(
      `环境里串进来了 ${hit.length} 个 npm_config_*（${hit.join(" / ")}）—— ` +
        "pnpm 与 lifecycle 脚本会继承它们，其中前缀 / store / global 那几条带执行期校验，" +
        "配错时每次调用都抛 AggregateError（与这次改动无关）",
    );
    advice.push(`先清掉它们：${hit.map((k) => `unset ${k}`).join("; ")}`);
  }

  if (lines.length === 0) {
    return {
      ok: true,
      lines: ["依赖与 npm_config_* 两道体检都过了"],
      advice: null,
    };
  }
  return { ok: false, lines, advice: advice.join("；") };
}

/**
 * 把结论排成给人读的那一段（平台日志与单测共用同一份文案 —— 抄第二份就会漂）。
 *
 * @param {WorktreeDepsReadout} readout
 * @param {string} [scope] 这一跑的落点（如「这一跑」）
 * @returns {string} `ok` 时是一行读数；不 ok 时是「为什么 + 下一步」
 */
export function describeWorktreeDeps(readout, scope = "这一跑") {
  if (readout.ok) {
    return `[deps-probe] ${scope}：${readout.lines.join("；")}\n`;
  }
  return (
    `[deps-probe] × ${scope}的**前提**不成立（不是用例红）：\n${readout.lines
      .map((l) => `  · ${l}\n`)
      .join("")}  下一动作：${readout.advice}\n` +
    `  ※ 这一档**不算绿也不算红**：拿它当「用例红」去查代码，查的是一件没发生的事。\n`
  );
}
