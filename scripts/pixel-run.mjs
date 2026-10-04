#!/usr/bin/env node
/**
 * pixel-run.mjs — 真正跑一次像素回归的那一层（规范 §11.8「按需的像素档」）
 *
 * `node scripts/pixel-run.mjs [--update] [--dry-run]`：起 Playwright 的 `e2e/visual`
 * （webServer + 浏览器都由它按 `playwright.config.ts` 起），跑完按退出码给出「这条红
 * 该怎么读」的定性。
 *
 * 与 `visual-gate.mjs` 的分工（不写清就是又造一轮子 —— §12.18）：
 *   · `visual-gate.mjs`（提交门槛 D 组）判的是「本次提交带不带像素**判决**」——
 *     `tests/visual-baseline-pairing.test.ts` 在不在本次要跑的清单里。它刻意**不**跑像素：
 *     起 webServer + 浏览器会与钩子里的 A/B/C/D 抢资源，而普通提交根本不该付这笔。
 *   · 本文件是那道门禁的同一条纪律的另一半：**真要跑像素时怎么跑、跑出来的红算什么**。
 *     它把「谁来跑」与「红的定性」变成一条可执行命令，而不是文档里一句「按需跑」。
 *
 * 默认**只在当次检出自证、不落盘**：`--update` 才写基线，且落盘前的验收（同一条命令
 * 连跑两次都绿）是硬要求 —— 一次性录出来的 PNG 不是「像素可复现」，只是「这次写成功了」
 * （§11.8 早写着这句，这里是它的机器形态）。
 *
 * 本次清单里那个 vitest 不是可选项：像素档必须**与 `tests/visual-baseline-pairing.test.ts`
 * 同一次跑掉**，否则「基线成套且入库」这条判据与像素档是两次互不相干的运行 ——
 * 那正是 #6538809 的形态（交出一批基线、判决不在场而全绿）。
 *
 * 用法：
 *   node scripts/pixel-run.mjs --dry-run    只打印本次会起什么（无副作用）
 *   node scripts/pixel-run.mjs              跑一次像素档（不落盘）
 *   node scripts/pixel-run.mjs --update     录基线（会写 PNG；落盘后请再跑一次自证）
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 像素层要跑的 spec 目录（与 `package.json` 的 `test:visual` 同一处落点）。 */
export const VISUAL_DIR = "e2e/visual";

/**
 * 与像素档**同一次**跑掉的判据：基线成套 / 全部入库 / 无孤儿。
 * 不在同一次跑里，像素档的绿与「基线还在仓库里」就是两件不相干的事。
 */
export const PIXEL_JUDGE = "tests/visual-baseline-pairing.test.ts";

/**
 * 解析 vitest 的 ESM 入口（与 `run-affected-tests.mjs` 同一口径：入口名由包自己定义，
 * 不猜 `node_modules/vitest/…` —— pnpm 布局下真身在 `.pnpm/vitest@<ver>…/`）。
 *
 * @param {string} cwd
 * @returns {string}
 */
export function resolveVitestEntry(cwd = ROOT) {
  const require = createRequire(path.join(cwd, "noop.js"));
  const pkgPath = require.resolve("vitest/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const bin = pkg?.bin?.vitest;
  if (typeof bin !== "string") {
    throw new Error(`[pixel-run] vitest 包没有 bin.vitest：${pkgPath}`);
  }
  const entry = path.resolve(path.dirname(pkgPath), bin.replace(/^\.\//, ""));
  if (!existsSync(entry)) {
    throw new Error(`[pixel-run] vitest 入口不存在：${entry}`);
  }
  return entry;
}

/**
 * 解析 Playwright 的 CLI 入口。
 *
 * 不写死 `node_modules/@playwright/test/cli.js`：pnpm 布局下顶层那个是链接。
 * 也**不** `spawn` 裸 `pnpm exec playwright` —— Windows 上那经 `.cmd` shim，只有
 * cmd.exe 解释批处理，Node 直接起会 `EINVAL`（规范 §2.1.1 判定过的形态）。
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
      `[pixel-run] @playwright/test 没有 bin.playwright：${pkgPath}`,
    );
  }
  const entry = path.resolve(path.dirname(pkgPath), bin.replace(/^\.\//, ""));
  if (!existsSync(entry)) {
    throw new Error(`[pixel-run] Playwright CLI 入口不存在：${entry}`);
  }
  return entry;
}

/**
 * 本次要跑的两次调用：① 像素档；② 同批的像素判据。
 *
 * 抽成纯函数是为了让「两次调用分别是什么」可被判据核 —— 它是这一层最容易静默退化的
 * 地方（把判据那次悄悄去掉，剩下的仍然是一次漂亮的绿）。
 *
 * 返回 `kind` 而不是命令字符串，是为了让工具解析点只有一处（`runStep`），
 * 用例也只能判「跑哪一步」而不能判「拼出来的命令行长得像什么」。
 *
 * @param {{update?: boolean}} [opts]
 * @returns {Array<{label: string, kind: "playwright" | "vitest", args: string[]}>}
 */
export function planRuns({ update = false } = {}) {
  const playwrightArgs = ["test", VISUAL_DIR];
  if (update) playwrightArgs.push("--update-snapshots");
  return [
    {
      label: "像素档（Playwright screenshot）",
      kind: "playwright",
      args: playwrightArgs,
    },
    {
      label: "像素判据（基线成套 / 入库 / 无孤儿）",
      kind: "vitest",
      args: [PIXEL_JUDGE],
    },
  ];
}

/**
 * 红要怎么读 —— 这是本节唯一不能交给直觉的地方（§11.8 的两条实测在下面各占一档）。
 *
 *   · `A snapshot doesn't exist at …-<platform>.png, writing actual`：这台机器
 *     **没有基线**，不是界面变形。动作是按 §11.8 登记平台 + 成套录基线，**不是**改业务代码。
 *   · `Failed to take two consecutive stable screenshots`：页面里有逐帧变化的东西
 *     （实测差异就是状态栏 FPS 那两位数字）—— 加 mask，放宽阈值只会让基线失去意义。
 *   · diff 数字：这才是像素级退化。合法变更 `--update` 重录并标注原因，非法变更改代码。
 *
 * @param {string} output 合并后的 stdout + stderr
 * @returns {string}
 */
export function classifyFailure(output) {
  if (/A snapshot doesn't exist at/.test(output)) {
    return "这台机器没有成套基线（不是界面变形）—— 按 §11.8 先登记平台、再录出一整套 PNG";
  }
  if (/Failed to take two consecutive stable screenshots/.test(output)) {
    return "页面里有逐帧变化的 chrome —— 用 mask 遮掉它（放宽阈值只会让基线失去意义）";
  }
  if (/pixels .*differ|snapshot .*differ/i.test(output)) {
    return "像素差异（这才是退化）—— 看 diff 图：合法变更 `--update` 重录并标注原因，非法变更改业务代码";
  }
  if (/webServer was not able to start/.test(output)) {
    return (
      "webServer 没起来（与像素无关）—— CI 口径下它走 `pnpm start`、要求先有生产构建：" +
      "先 `pnpm build`，或确认这次确实要按 CI 口径跑"
    );
  }
  return "读不到可归因的形态 —— 先按 §11.13 隔离重跑定性，别直接改业务代码";
}

/**
 * 子进程环境：**CI 没设就不要给它设**。
 *
 * 这里曾经写成 `{ ...process.env, CI: process.env.CI ?? "" }`，读起来像「显式传空」，
 * 实际是把「本地」变成了 CI —— `playwright.config.ts` 判的是 `process.env.CI` 的**真假**，
 * 空串也是假值之外的「已设置」，于是它在本地走 `pnpm start`（要求先有生产构建），
 * 现场是一句 `Could not find a production build in the '.next' directory`：本机明明
 * 没打算构建，却被告知「先构建」。**空串 ≠ 未设置**，跨进程传递时就按未设置来做。
 */
function childEnv() {
  const env = { ...process.env };
  if (!env.CI) delete env.CI;
  return env;
}

/**
 * 跑一步（真 spawn，不经任何 shell）。
 *
 * @param {{label: string, kind: "playwright" | "vitest", args: string[]}} step
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function runStep(step) {
  const entry =
    step.kind === "playwright"
      ? resolvePlaywrightCli()
      : resolveVitestEntry();
  return spawnSync(process.execPath, [entry, ...step.args], {
    cwd: ROOT,
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

/**
 * 入口与平台的定性说明（起不来时打印，免得只留一行读不出来的东西）。
 *
 * @param {{label: string, kind: "playwright" | "vitest", args: string[]}} step
 * @returns {string}
 */
function describeStep(step) {
  return step.kind === "playwright"
    ? `playwright ${step.args.join(" ")}`
    : `vitest ${step.args.join(" ")}`;
}

/**
 * @param {string[]} argv
 * @returns {number} 退出码
 */
function main(argv) {
  const update = argv.includes("--update");
  const dryRun = argv.includes("--dry-run");
  const runs = planRuns({ update });
  if (dryRun) {
    for (const step of runs) {
      process.stdout.write(`[pixel-run] ${step.label} → ${describeStep(step)}\n`);
    }
    process.stdout.write(
      "[pixel-run] 说明：默认只在当次检出自证、不落盘；`--update` 才写基线\n",
    );
    // webServer 走哪条由 `playwright.config.ts` 按 CI 的真假分流，而这条分流决定了
    // 本步要不要先有生产构建 —— 把它打在台面上，省掉一次「先构建」的试错
    // （实测：容器/流水线里 `CI=true` 是常态，人会以为自己没在 CI 上）。
    process.stdout.write(
      process.env.CI
        ? "[pixel-run] webServer：按 CI 口径 → `pnpm start`（需要先有生产构建）\n"
        : "[pixel-run] webServer：本地口径 → `pnpm dev`（无需先构建）\n",
    );
    return 0;
  }

  let failed = null;
  for (const step of runs) {
    process.stdout.write(`[pixel-run] ${step.label} → ${describeStep(step)}\n`);
    const res = runStep(step);
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    if (res.error || res.status !== 0) {
      failed = { step, res };
      break;
    }
  }

  if (failed === null) {
    process.stdout.write(
      update
        ? "[pixel-run] ✓ 已录基线并通过配对判据；再跑一次不带 --update 的命令自证「连跑两次都绿」，" +
            "并在提交里标注「视觉基线已更新：<原因>」\n"
        : "[pixel-run] ✓ 像素档通过（结论仅对当次检出具名；`--update` 才会写基线）\n",
    );
    return 0;
  }
  process.stderr.write(
    `\n[pixel-run] ✗ ${failed.step.label} 未通过（退出码 ${failed.res.status ?? "信号"}）\n` +
      `        定性：${classifyFailure(
        `${failed.res.stdout ?? ""}\n${failed.res.stderr ?? ""}`,
      )}\n` +
      "        规范：docs/standards/11-测试与可观测性.md §11.8\n",
  );
  return failed.res.status ?? 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main(process.argv.slice(2)));
}
