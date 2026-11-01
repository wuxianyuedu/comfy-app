#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：无类型消费方，tsc 面在 src/**
/**
 * affected-launch-noise-reporter.mjs — 「受影响用例」门在 CI 里的**良性 stderr 噪音屏蔽**
 *
 * 干什么：被测源码自己打出来的、但**已知无害**的 stderr（不是在测「报错」那条断言，
 * 而是产品代码在测试条件下必然会打的日志），在 CI 里按行滤掉，免得它们把日志预算
 * （平台硬上限 102400 字节，超了只留一句 `The log length exceeds the limit`、且保留的是
 * 尾部）吃光，把「哪些用例失败、失败原文」那一屏挤出去。
 *
 * 这一格的噪音来源（实测，2026-10-31）：
 *   1. `AggregateError … ECONNREFUSED ::1:3000 / 127.0.0.1:3000` —— 某些用例
 *      去连本机开发服务器（:3000）但 CI 里它没起；这是环境性的连接拒绝，不是用例红。
 *   2. `canvas-sync` 模块的「这份画布没能存进服务端（暂时性…）…Stream closed before
 *      head was received TRPCClientError」—— 重试用例里必然出现的重试日志，每条用例
 *      一行且带着整串 node_modules 路径，是日志体积的最大杀手（use-workshop-pipeline
 *      -recovery.test.ts 一个文件就刷出十几屏）。
 *   3. tests/a11y-axe-stories.test.ts 故意渲染会抛错的 error-boundary / lazy-chunk 故事
 *      （`渲染期炸了：这个子树的 props 不合法`、`ChunkLoadError: Failed to load chunk`、
 *      `[ErrorBoundary] Error:`、`The above error occurred in the <Boom> component.`）——
 *      这些是故事本身在测「错误边界能兜住」，stderr 噪音是预期的。
 *
 * 为什么是「屏蔽」而不是「改产品代码静音」：这些是**真在跑的测试**需要的日志（本地人
 * 排错要看），只在 CI 的汇出这一跳滤掉，不影响任何一条断言、不改 `--reporter`、不碰
 * 超时指纹（超时指纹 `Test timed out in` / `Timeout waiting for worker` 等不在下方清单里）。
 *
 * 边界（务必守住）：下方的噪音清单**只收「已知良性」那几类**。任何一条**真断言红**
 * （`AssertionError`）、**真挂死**（`Failed to start forks worker`）、**装载失败**
 * （`Cannot find module`）都不在其中 —— 它们照样原样出现在日志里、照样被判决链读到。
 * 这条边界由 `tests/affected-launch-noise-reporter.test.ts` 的**反向判据**钉住：
 * 给一组真红 / 真挂死的原文，断言 `isNoiseLine` 一律返回 false。
 *
 * 第二批（ISSUE #2844，实测 build cnb-hkh-1k68d3ms7，2026-10-31）：与上面那批不同源 ——
 * 不是「被测源码的 stderr 错误」，而是**测试夹具自己 spawn 的子进程输出**与**探针脚本
 * 的段落抬头**（走 stdout）：git 传输警告 / `git worktree add` 进度行 / 负向用例按设计
 * 造的失败（git 在非仓库目录、Playwright 起不来）/ 探针段名（[ports]/[python]/…）/
 * ci-install-deps 判据被夹具 exercise 时的原话 / storybook 加载 `.storybook/main.ts`
 * 的已知警告块。这批单独一张清单（`FIXTURE_NOISE_PATTERN`），与第一批分开列是为了
 * 「每一条都能指到出处」—— 混在一张正则里，下一个人就分不清哪条是谁了。
 *
 * ⚠️ junit **不吃**这份过滤：junit 由 vitest 自己写（过滤发生在 vitest 退出之后），
 * 所以逐文件读数与失败明细永远保全量；被滤掉的只有**回吐给平台的那屏**。
 * `fatal: not a git repository` 与 `起不了 Playwright` 这两条**理论上**可能出现在某条
 * 真红的报告原文里 —— 接受这个交换：它们在 junit 与失败摘要里仍在，回吐屏丢的只是
 * 上下文行；而它们作为夹具噪音出现的频率远高于作为真红原文的频率（两次实测都是前者）。
 *
 * 接入点：本文件只提供纯函数；真正的过滤动作在 `affected-launch-spawn.mjs` 的
 * `spawnVitest` 抓到 vitest 输出、回吐给平台之前那一刀（按行过 `isNoiseLine`）。
 */

/**
 * 良性噪音行的判定式（单条正则，alternation）。命中即视为「可丢弃」。
 *
 * ⚠️ 关键边界：**只认「开发服务器 :3000 的连接拒绝」那一族具体标记**，绝不认裸的
 * `ECONNREFUSED` / `AggregateError:` —— 后者会误删 redis(:6379) 等其他端口的真实连接
 * 失败（那是真红，得留着）。具体标记取 `::1:3000` / `127.0.0.1:3000` / `port: 3000` /
 * `address: '::1'` / `errno: -4078` / `internalConnectMultiple` / `afterConnectMultiple` /
 * `createConnectionError`（node:net 内部，只在这类连接拒绝栈里出现）。
 *
 * 刻意**不**收：超时指纹（`Test timed out in` / `Timeout waiting for worker`）、装载失败
 * （`Cannot find module`）、断言错误（`AssertionError`）—— 那些是要被读出来判决的。
 */
export const NOISE_PATTERN =
  /::1:3000|127\.0\.0\.1:3000|port:\s*3000|errno:\s*-4078|internalConnectMultiple|afterConnectMultiple|createConnectionError|address:\s*'::1'|\[canvas-sync\]|这份画布没能存进服务端|Stream closed before head was received|TRPCClientError|渲染期炸了|The above error occurred|React will try to recreate|\[ErrorBoundary\]|ChunkLoadError|Failed to load chunk|error-boundary\.stories\.tsx|use-lazy-chunk-fallback\.stories\.tsx/;

/**
 * 第二批（夹具 / 探针输出，ISSUE #2844）的判定式。逐条锚定、每条能指到出处：
 *
 *   · `^warning: in the working copy of ` —— git autocrlf 的传输警告，夹具 spawn git
 *     时必漏（`LF will be replaced by CRLF` 那句的后半段随路径/方向变，锚前半句）。
 *   · `^Preparing worktree \(` —— `git worktree add` 的进度行（负向/夹具用例造 worktree）。
 *   · `^fatal: not a git repository \(or any of the parent directories\)` —— git 在非
 *     仓库目录的标准报错，负向用例按设计造的出口（junit 保全量，见上面的交换说明）。
 *   · `起不了 Playwright（` —— `e2e-run-playwright.mjs` 的设计内失败抬头（tag 形态
 *     `[e2e-run/test]` / `[e2e-run]` 都算）；以及它下面那行箭头注解
 *     `**判据按设计造的失败**`。
 *   - `^\[(ports|python|schema|browser)\]\s*$` —— `ci-env-probe.mjs` 的**裸段名抬头**
 *     （被 ci-env-probe / ci-image-identity / fixed-gate-input-faces 等夹具 exercise 时
 *     漏出）。只收**裸行**：带内容的行（真读数）不在此列。
 *   · `^\[ci-install-deps\] ` —— 同判据被夹具 exercise 时的原话（这一格真正跑在
 *     install-deps 那条 CI 链上，不在本门输出里）。
 *   · storybook 的 extensionless 警告块：触发行（`One or more extensionless imports
 *     detected`）、框线行（`│` 起手 —— 本门输出里只有 storybook 用它画框）、
 *     OSC-8 超链接包装（`]8;;`）与 faq 链接行。
 *   · `^x\s*$` —— 孤立 x 行（两次构建 cnb-41t-1k688asn3 / cnb-hkh-1k68d3ms7 都在场，
 *     **源未定位**；按观察形态收，真读数不会是一行孤立的 `x`）。
 */
export const FIXTURE_NOISE_PATTERN =
  /^warning: in the working copy of |^Preparing worktree \(|^fatal: not a git repository \(or any of the parent directories\)|起不了 Playwright（|\*\*判据按设计造的失败\*\*|^\[(ports|python|schema|browser)\]\s*$|^\[ci-install-deps\] |One or more extensionless imports detected|^\s*│|]8;;|storybook\.js\.org\/docs\/faq|^x\s*$/;

/** 一行是不是良性噪音（CI 里应被屏蔽）。两张清单任一命中即算。 */
export function isNoiseLine(line) {
  const s = line ?? "";
  return NOISE_PATTERN.test(s) || FIXTURE_NOISE_PATTERN.test(s);
}

/**
 * 把一段文本按行过滤掉噪音行（保留其余行，空行也保留 —— 不打乱 vitest 自己的排版）。
 * 用于 `spawnVitest` 抓到的 stdout / stderr，也便于单测直接断言。
 */
export function filterNoiseText(text) {
  return String(text ?? "")
    .split("\n")
    .filter((line) => !isNoiseLine(line))
    .join("\n");
}

/**
 * 解析 `COMFY_AFFECTED_NOISE_FILTER` 这个值（与 `affected-launch-log-budget.mjs`
 * 的 `resolveQuiet` 同形）：只为 `1` / `true` 开屏，其余一律关（本地默认关，开发者
 * 照常看到这些日志）。
 * @returns {{enabled: boolean, note: string | null}}
 */
export function resolveNoiseFilter(raw) {
  const enabled = raw === "1" || raw === "true";
  return {
    enabled,
    note: enabled
      ? "噪音屏蔽：开（屏蔽 ECONNREFUSED/:3000、canvas-sync 重试、a11y 故意渲染的 error-boundary/lazy-chunk 故事 stderr；以及夹具 spawn 的 git 传输警告 / worktree 进度 / 设计内失败抬头、探针裸段名、ci-install-deps 夹具原话、storybook extensionless 警告块 —— #2823 + #2844 两张清单；不影响断言判定与超时指纹）"
      : null,
  };
}
