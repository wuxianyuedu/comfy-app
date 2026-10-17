/**
 * e2e-run-playwright.mjs — 「怎么起 Playwright」的**唯一出处**（规范 §13.5.4）。
 *
 * ## 为什么它单独一个文件
 *
 * 本仓对脚本层有**文件长度硬闸**（`scripts/check-infra-file-size.cjs`：超过 900 行
 * 即阻断，存量已清零、无基线可登记）。`scripts/e2e-run.mjs` 在加上 ISSUE #1998 那
 * 一处修复（不缓存子进程输出 + 开跑前的读数按序说出来）之后越过了那条线，而这条线的
 * 出口只有一个：**拆**。拆的边界不是「凑行数」，而是这一族本来就自成一体：
 *
 *   · `resolvePlaywrightCli()` —— 入口在哪（不写死 pnpm 的 `.pnpm/<name>@<version>/`）；
 *   · `resolvePlaywrightInvocation()` —— **怎么起**（`spawn` + `inherit`，一行都不缓存）；
 *   · `runChild()` —— 真起一次并把结论（退出码 / 被信号打死）交回去；
 *   · `resolvePlaywrightFile()` —— 从 `@playwright/test` 那里借一个 require 去解析
 *     `playwright` 包里的文件（判据侧也要读上游源码）。
 *
 * 四件事共享同一个前提（**入口只能从 `@playwright/test` 借**，因为本仓不直接依赖
 * `playwright`），分开写在两处只会漂。而 `e2e-run.mjs` 剩下的部分答的是另一个问题
 * ——「这一跑算不算跑绿了、要不要记账」。
 *
 * ## 对外形态不变
 *
 * `e2e-run.mjs` 把它们**原样再导出**，所以既有调用方（`package.json` 的
 * `test:e2e`、`tests/e2e-fake-comfyui-endpoint.test.ts` 的 `resolvePlaywrightFile`）
 * 一个字节都不用改。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

import { resolveRepoRoot } from "./app-port.mjs";

/** 检出根 —— 与 `e2e-run.mjs` 同一处解析（`app-port.mjs` 是它的唯一出口）。 */
const ROOT = resolveRepoRoot();

/**
 * 解析 Playwright 的 CLI 入口。
 *
 * 与其余几个跑法脚本同一条理由（§12.12：两处各写一份就会漂）：不写死
 * `node_modules/@playwright/test/cli.js`（pnpm 布局下顶层那个是链接），也不
 * `spawn` 裸 `pnpm exec playwright`（Windows 上那经 `.cmd` shim，Node 直接起会
 * `EINVAL`，规范 §2.1.1 判定过的形态）。
 *
 * ⚠️ 它只解决「入口在哪」这一件事，而几条跑法真正共享的东西（记账读写、账的形状、
 * 档的登记）都在 `freshness-ledger.mjs`。
 *
 * @param {string} cwd
 * @returns {string}
 */
export function resolvePlaywrightCli(cwd = ROOT) {
  const require = createRequire(path.join(cwd, "noop.js"));
  const pkgPath = require.resolve("@playwright/test/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const bin = pkg?.bin?.playwright;
  if (typeof bin !== "string") {
    throw new Error(
      `[e2e-run] @playwright/test 没有 bin.playwright：${pkgPath}`,
    );
  }
  const entry = path.resolve(path.dirname(pkgPath), bin.replace(/^\.\//, ""));
  if (!existsSync(entry)) {
    throw new Error(`[e2e-run] Playwright CLI 入口不存在：${entry}`);
  }
  return entry;
}

/**
 * 起 Playwright 的**那一对**（怎么起 + 起什么），唯一出处。
 *
 * ## 为什么不是 `spawnSync(process.execPath, [entry, ...])`（ISSUE #1998 现场）
 *
 * 那是本文件此前的形态，而它在平台侧有一个**看不见**的后果：`spawnSync` 的
 * `stdio: "inherit"` 只继承 fd，`spawnSync` 仍然把子进程的整段输出**攒在内存里**
 * 塞进 `res.stdout`（它要在串行调用里把结论交回去）—— 而本文件从不读那个字段。
 *
 * 于是：`E2E 关键流程` 跑到 36 分钟被平台按 stage 墙钟 kill（`cnb-m0t-1k54oljem`，
 * `timeout of 2160000ms exceeded`），日志**零行** —— 连那几条「起 Playwright 前：
 * 应用端口 空 / 替身端口 空」的前置读数都没有。那几条读数照旧打在 `e2e-run` 自己的
 * stdout 上（`ci-cp936-exit.mjs` 转码后照常落日志），唯独 **Playwright 那一整段**
 * 攒在一份永远不会被读的缓冲区里随进程一起消失。这与 §13.5.3「第十二处」（外壳攒到
 * `close` 才发）**是同一形态的第二处**：修完外壳的时序，缓存落在调用方这一层。
 *
 * 所以起法换成 `spawn` + `stdio: "inherit"`（**真**落日志，一行都不缓存），并把
 * 「拷一份 env」这件事**跟着挪过来** —— 它不是风格问题：`spawn` 的 `env` 必须是
 * 「`process.env` 的副本 + 本档那几条键」，而不是重新读一遍 `process.env`（那样
 * `E2E_PREFLIGHT` / `PYTHON_PREFLIGHT` 两条结论会静默丢掉，`globalSetup` 与
 * `playwright.config.ts` 都会退回「不知道」那一档）。
 *
 * ## 为什么形态是「Node 起 CLI 入口」而不是 `pnpm exec playwright`
 *
 * 与 `resolvePlaywrightCli()` 同一条理由：Windows 上 `pnpm` 是 `.cmd` shim，
 * Node 直接起会 `EINVAL`（§2.1.1）。所以这里用 `process.execPath` + 解析出来的
 * CLI 入口 —— 两个平台同一条路。
 *
 * 抽成纯函数是为了让「起的是什么」可被判据核（`tests/e2e-run.test.ts`）：那一格
 * 的缺陷**在 Linux 上跑一遍是看不见的**（缓存不影响退出码与本地终端里的输出）。
 *
 * @param {{entry: string, argv: string[], env: NodeJS.ProcessEnv,
 *          execPath?: string}} input
 *   `env` 是**已经**拼好本档那几条键的那一份（`main` 在 pre-flight 结论算完之后
 *   把它交给这里）。
 * @returns {{command: string, args: string[], options: {
 *   cwd: string, env: NodeJS.ProcessEnv, stdio: "inherit", windowsHide: boolean}}}
 */
export function resolvePlaywrightInvocation({ entry, argv, env, execPath }) {
  return {
    command: execPath ?? process.execPath,
    args: [entry, ...argv],
    options: {
      cwd: ROOT,
      /* 只拷一份、不改写：`{ ...env }` 让子进程拿到的是「本档算好的那份」，
       * 而不是再读一遍 `process.env`（后者会丢掉上面那两条 preflight 结论）。 */
      env: { ...env },
      /* **不缓存**：这是本条唯一的实质差别（见函数头注）。 */
      stdio: "inherit",
      /* Windows 上不要弹控制台窗口（`next start` 那一路会起孙进程）。 */
      windowsHide: true,
    },
  };
}

/**
 * 解析 `playwright` 包里的一个文件（相对包根）。
 *
 * 为什么不能直接 `require.resolve("playwright/…")`：本仓库**不直接依赖**
 * `playwright` —— 它是 `@playwright/test` 的依赖，pnpm 的布局下没有顶层软链，
 * 从仓库根解析必然 `MODULE_NOT_FOUND`。所以只能**从 `@playwright/test` 那里**
 * 借一个 require 去解析（与 `resolvePlaywrightCli` 同一条思路：不写死 pnpm 的
 * `.pnpm/<name>@<version>/` 路径 —— 那会随版本漂）。
 *
 * 存在它的理由是**判据侧也要读上游源码**：`tests/e2e-fake-comfyui-endpoint.test.ts`
 * 要拿「webServer 作为 plugin 排在 globalSetup 之前」这条真实顺序来立断言，
 * 而那条断言不能自己拼路径（拼法与版本耦合，换布局就静默找不到文件）。
 *
 * @param {string} rel 相对 `playwright` 包根的路径（如 `lib/runner/index.js`）
 * @param {string} [cwd]
 * @returns {string} 绝对路径
 */
export function resolvePlaywrightFile(rel, cwd = ROOT) {
  const require = createRequire(path.join(cwd, "noop.js"));
  const testPkg = require.resolve("@playwright/test/package.json");
  /* 借 `@playwright/test` 的位置再解析一次 —— 它的依赖 `playwright` 就在那一层。 */
  const viaTest = createRequire(testPkg);
  const pwPkg = viaTest.resolve("playwright/package.json");
  const target = path.resolve(path.dirname(pwPkg), rel);
  if (!existsSync(target)) {
    throw new Error(`[e2e-run] playwright 里没有这个文件：${target}`);
  }
  return target;
}

/**
 * 起 Playwright 并等它退出，返回 `{status}`（`null` = 被信号打死 / 起不来）。
 *
 * 单独一层是为了让「怎么起」那一半**可测**：`resolvePlaywrightInvocation()` 判的是
 * 形状（起什么、`stdio` 是不是 inherit），这一层判的是**真的等到了结论** ——
 * 退出码、被信号打死、以及 spawn 自己的失败（ENOENT / EINVAL）三条路各有一个出口。
 * 判据在 `tests/e2e-run.test.ts`（注入一个 `node -e` 子进程真跑一遍）。
 *
 * 不抛：起不来也要把「这一跑没成」如实交出去（调用方转非零退出码），
 * 而失败原因**先打一行**（§4：失败路径必须有日志），否则读日志的人只看到退出码。
 *
 * @param {{command: string, args: string[], options: Record<string, unknown>}} invocation
 * @param {{spawnImpl?: typeof spawn}} [ports]
 * @returns {Promise<{status: number | null}>}
 */
export function runChild(invocation, { spawnImpl = spawn } = {}) {
  const { command, args, options } = invocation;
  return new Promise((settle) => {
    const child = spawnImpl(command, args, options);
    child.on("error", (err) => {
      const code = /** @type {NodeJS.ErrnoException | undefined} */ (err)?.code;
      process.stderr.write(
        `[e2e-run] ✗ 起不了 Playwright（${command}）：失败码 ${code ?? "未知"}` +
          " —— 盘上没有 / 起不来的形态见 resolveCommandInvocation（§2.1.1）\n",
      );
      settle({ status: null });
    });
    child.on("close", (code) => settle({ status: code }));
  });
}
