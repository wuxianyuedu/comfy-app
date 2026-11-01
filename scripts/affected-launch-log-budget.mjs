#!/usr/bin/env node
/**
 * `affected-launch-log-budget.mjs` —— 「这一跑交给 vitest 的 reporter 该是哪一个」（日志预算）。
 *
 * ## 为什么这一格必须有人管（平台侧的硬读数）
 *
 * 平台对单次构建日志的硬上限是 **102400 字节**，超了只留一句
 * `The log length exceeds the limit(102400)`、后面全部截断；而它保留的是**尾部** ——
 * 被切掉的恰是**开头**，也就是「跑了哪些文件、哪份失败、失败原文」那一段。现场
 * （PR #2290 的 `受影响用例` 一格）读到的第 2 行就是这句话，之后整屏不可读。
 *
 * 输出的多半不是失败，而是**通过**：`vitest run` 的默认 reporter 会**逐个文件**打一行
 * 测试清单（`❯ tests/x.test.ts (12 tests)`），并把那几行再重复一遍。实测量级：
 * 一百多份用例文件就是 100~200 行，本仓常态的增量面（几千条 / 上百文件）足以把
 * 102400 字节吃光。
 *
 * ## 买的与不买的
 *
 * 买的是：**结论留在日志里**（失败的用例名 + 失败原文 + 汇总行）不被逐文件的行挤出去。
 * **不买**任何判据上的松紧 —— 退出码、复跑面、超时指纹一个字不动；复跑面本来就由
 * junit 给（`retryScope`），不靠这屏文本。
 *
 * ## 三条口径
 *
 *   · **只认显式打开**（`COMFY_AFFECTED_QUIET=1`）：与 `COMFYAPP_QUIET_COVERAGE`
 *     同一条处置 —— 本地人跑这一档时要看逐文件清单，那把开关默认关着；
 *   · 值不是 `1` ⇒ 按「没置」办并**提醒**（不静默降级，同 `resolveMaxWorkers`）；
 *   · 用 `--reporter=dot` 而不是 `--silent`：前者失败时**照样**打失败用例与原文，
 *     后者不会 —— 把失败明细也一起省掉就买到反方向去了。
 *
 * 单独成文件的理由与话术层那一刀相同（§12.6 R5 / §12.13）：`run-affected-tests.mjs`
 * 是机制层（清单 / 分块 / 起进程 / 判指纹 / 定退码），再塞第六件事就越过 900 行硬闸，
 * 而越闸的形态不是报错，是「那一层读不动了」。
 */

/**
 * 「这一跑要不要 quiet」。
 *
 * @param {string | undefined} raw `COMFY_AFFECTED_QUIET` 的原值
 * @returns {{quiet: boolean, note: string | null}}
 */
export function resolveQuiet(raw) {
  if (raw === undefined || String(raw).trim() === "") {
    return { quiet: false, note: null };
  }
  if (String(raw).trim() === "1") {
    return { quiet: true, note: null };
  }
  return {
    quiet: false,
    note:
      `COMFY_AFFECTED_QUIET="${raw}" 不是 "1"，按不 quiet 办 —— ` +
      "这一档只换 reporter（日志预算），不动任何判据",
  };
}

/**
 * 这一遍交给 vitest 的 reporter 参数（**判据不在这里**）。
 *
 * 不 quiet 时回**空数组** —— 那就是今天的形状（默认 reporter），一个字都不加。
 *
 * @param {boolean} quiet
 * @returns {string[]}
 */
export function reporterArgs(quiet) {
  return quiet ? ["--reporter=dot"] : [];
}

/**
 * 读 `COMFY_AFFECTED_QUIET`，把「这一跑用的哪个 reporter」打成一行读数。
 *
 * 为什么必须打出来：quiet 是**给日志预算**的，而它没生效（值写错、或将来有人传了别的
 * `--reporter` 把它顶掉）的表现**不是报错，是「日志又超长」** —— 那正是这一档要治的病。
 * 所以「quiet 了没有」必须是一句日志里读得到的话，不能只存在于代码里。
 *
 * @param {string | undefined} raw
 * @param {(text: string) => void} write
 * @returns {boolean} 这一次要不要 quiet
 */
export function announceQuiet(raw, write) {
  const { quiet, note } = resolveQuiet(raw);
  if (note) {
    write(`[affected-launch] ${note}\n`);
  }
  write(
    quiet
      ? "[affected-launch] reporter：dot（COMFY_AFFECTED_QUIET=1 —— 逐文件不逐个刷行，" +
          "省日志预算；失败明细与原文照样打）\n"
      : "[affected-launch] reporter：默认（没置 COMFY_AFFECTED_QUIET —— 逐文件清单照打）\n",
  );
  return quiet;
}
