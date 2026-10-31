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
 * ## `origin`：让「判据按设计造的失败」与「这一跑真起不来」在日志里分得开
 *
 * 那一行 ENOENT 是**失败路径的取证**，不能收（收了真起不来就没有任何线索）。
 * 但同一个出口有两个使用者：真实跑法（要给运维找线索）与判据
 * （`tests/e2e-run.test.ts` 故意塞一个不存在的路径，断言 `status === null` ——
 * 它**要**的就是这条失败路径）。两者共用一条 stderr，于是 CI 日志里那一行
 * 长得和真故障一模一样，读的人得先去查「是不是某条用例造的」。
 *
 * 修法不是静音（那是把取证一起收掉），而是让那一行**自报家门**：
 * 调用方声明 `origin`，判据侧声明 `origin: "test"` ⇒ 同一行改由 `[e2e-run/test]`
 * 打头并追加一句「判据按设计造的失败」。前缀是机器可分辨的（读日志的不必再猜），
 * 而 `e2e-run` 这一档的形态一个字都没变。
 *
 * @param {{command: string, args: string[], options: Record<string, unknown>}} invocation
 * @param {{spawnImpl?: typeof spawn, origin?: "run" | "test"}} [ports]
 *   `origin` 缺省 `"run"`（真实跑法）；`"test"` 表示调用方自己就是那条负向用例。
 * @returns {Promise<{status: number | null}>}
 */
export function runChild(
  invocation,
  { spawnImpl = spawn, origin = "run" } = {},
) {
  const { command, args, options } = invocation;
  return new Promise((settle) => {
    const child = spawnImpl(command, args, options);
    child.on("error", (err) => {
      const code = /** @type {NodeJS.ErrnoException | undefined} */ (err)?.code;
      process.stderr.write(spawnFailureLine({ command, code, origin }));
      settle({ status: null });
    });
    child.on("close", (code) => settle({ status: code }));
  });
}

/**
 * 起不来那一行的**唯一出处**（`runChild` 的 `error` 出口用，判据也直接断言它）。
 *
 * 单独抽出来是为了让「这一行长什么样」成为被测对象 —— 按字符串判进整行输出
 * 会把前缀、失败码、出处提示三件糊成一句断言，改一个字就得整组重写。
 *
 * @param {{command: string, code?: string, origin?: "run" | "test"}} input
 * @returns {string} 要写到 stderr 的一整行（含行尾换行）
 */
export function spawnFailureLine({ command, code, origin = "run" }) {
  const byTest = origin === "test";
  const tag = byTest ? "[e2e-run/test]" : "[e2e-run]";
  return (
    `${tag} ✗ 起不了 Playwright（${command}）：失败码 ${code ?? "未知"} —— 盘上没有 / 起不来的形态见 resolveCommandInvocation（§2.1.1）${
    byTest
      ? "\n          ↑ 这条是**判据按设计造的失败**（负向用例要的正是这个出口），不是这一跑起不来。\n"
      : "\n"}`
  );
}
