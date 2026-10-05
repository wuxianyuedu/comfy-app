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
 * ⚠️ **「不落盘」必须显式争取**：Playwright 的 `updateSnapshots` 默认是 `'missing'`——
 * 缺基线时**不带任何开关也会把生成的 PNG 写进 `*-snapshots/`**（`playwright test --help`
 * 自己写着「Running tests without the flag defaults to "missing"」）。所以检查档一律显式
 * 传 `--update-snapshots=none`（见 `CHECK_UPDATE_MODE`）：否则「默认不落盘」是一句对
 * 已有基线成立、对**缺基线**恰好不成立的话 —— 而缺基线正是这里最需要它成立的时候
 * （在没登记过的平台上跑一次就留下半套未入库的 PNG，§11.8 判过那比没有更费人）。
 *
 * 本次清单里那个 vitest 不是可选项：像素档必须**与 `tests/visual-baseline-pairing.test.ts`
 * 同一次跑掉**，否则「基线成套且入库」这条判据与像素档是两次互不相干的运行 ——
 * 那正是 #6538809 的形态（交出一批基线、判决不在场而全绿）。
 *
 * 用法：
 *   node scripts/pixel-run.mjs --dry-run    只打印本次会起什么（无副作用）
 *   node scripts/pixel-run.mjs              跑一次像素档（不落盘）
 *   node scripts/pixel-run.mjs --update     录基线（会写 PNG；落盘后请再跑一次自证）
 *
 * **起任何东西之前**先答一个前置问题（`checkLocalBaselines`）：「本机这个平台有没有
 * 成套基线」。没有就直接给出文件名与动作，且**不启动** webServer / 浏览器 —— 「本机
 * 没有基线」是一个必然会出现（文件名带平台）、且代价为零就能提前命名的状态，不值得
 * 让人先付一遍构建 + 起服务 + 起浏览器的代价、再从 Playwright 的输出里读出来。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  SUPPORTED_PLATFORMS,
  VISUAL_DIR,
  isPlatformRegistered,
  missingBaselinesForPlatform,
} from "./visual-baselines.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 像素层要跑的 spec 目录 —— 与 `package.json` 的 `test:visual`、以及基线清点内核
 * 同一处落点（§12.12：不各写一份）。此处转出是为了让既有消费方
 * （`tests/pixel-run.test.ts`）的 import 面不变。
 */
export { VISUAL_DIR };

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
 * 检查档（不带 `--update`）传给 Playwright 的 `updateSnapshots` 档位。
 *
 * `'none'` 是**唯一**能让「默认不落盘」成真的档位：Playwright 的默认是 `'missing'`，
 * 而 `'missing'` 的语义正是「缺的基线**创建出来**」—— 也就是在没登记过的平台上跑一次，
 * 工作区里就多出半套未入库的 PNG。录基线那一路（`--update`）不受影响：它走
 * `--update-snapshots` 的 preset（`changed`，含创建缺失的那些）。
 */
export const CHECK_UPDATE_MODE = "none";

/**
 * 「本机这个平台有没有成套基线」—— 起任何东西之前必须先答的那一问（§11.8）。
 *
 * 三种答案各有各的动作，混成一句「像素档红了」就会把人引去改业务代码：
 *   · 平台**没登记**：这一档在仓库里从来没有基线。动作是按 §11.8 在这档录出成套 PNG
 *     **并同批**登记 `SUPPORTED_PLATFORMS`（`scripts/visual-baselines.mjs`）——
 *     只录不登记 = 被孤儿判据点名，只登记不录 = 那一档一跑就红。
 *   · 平台登记了、但**缺几张**（新增了截图名而没录）：动作是补齐那几张。
 *   · 齐了：返回 `null`，照常跑。
 *
 * 纯函数（读盘 + 入参），便于用一次性夹具把三种答案都执行出来 —— 这一层最容易退化的
 * 地方是「前置判决永远说『齐了』」，而它会静默回到「跑一次才发现本机没基线」。
 *
 * @param {{root: string, platform: string}} args
 * @returns {string | null} 缺基线时的话术（含文件名与动作），齐了返回 null
 */
export function checkLocalBaselines({ root, platform }) {
  const missing = missingBaselinesForPlatform(root, platform);
  if (missing.length === 0) return null;
  const listed = missing.map((f) => `      · ${f}`).join("\n");
  if (!isPlatformRegistered(platform)) {
    return (
      `本机平台 \`${platform}\` 没有登记过像素基线（仓库登记的是 ${SUPPORTED_PLATFORMS.join(" / ")}）——\n` +
      `      要在这一档跑像素，先按 §11.8 在这档录出成套 PNG：\n` +
      `        pnpm check:visual:update   # 需先把 \`CI\` 置成与该档基线录制时一致\n` +
      `      录完把 \`${platform}\` 同批登记进 scripts/visual-baselines.mjs 的 SUPPORTED_PLATFORMS\n` +
      `      （只录不登记 = 被孤儿判据点名；只登记不录 = 那一档一跑就红）。缺这几张：\n${listed}`
    );
  }
  return (
    `本机平台 \`${platform}\` 在登记口径里，但这几张基线缺（新增截图名后没录）：\n` +
    `${listed}\n` +
    `      动作：\`pnpm check:visual:update\` 录出成套 PNG 并提交（PR 标注「视觉基线已更新：<原因>」）。`
  );
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
  // 检查档**必须**显式关掉落盘：Playwright 的默认是 `'missing'`（缺基线照样写文件），
  // 不写这一档就等于「默认不落盘」只对已有基线成立。
  playwrightArgs.push(
    update ? "--update-snapshots" : `--update-snapshots=${CHECK_UPDATE_MODE}`,
  );
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
  // 「本机没有基线」在起任何东西之前先答：它是一个零代价就能命名的状态，让人先付
  // 建服务 + 起浏览器的代价再从 Playwright 输出里读出来，属于白花的那份钱。
  // `--update` 是**录基线**那一路 —— 缺基线正是它要治的病，所以它不受这一闸拦。
  const localProblem = update
    ? null
    : checkLocalBaselines({ root: ROOT, platform: process.platform });
  if (localProblem) {
    process.stderr.write(
      `[pixel-run] ✗ 本机（${process.platform}）没有可用的成套基线 —— 未启动 webServer / 浏览器\n` +
        `        定性：${localProblem}\n` +
        "        规范：docs/standards/11-测试与可观测性.md §11.8\n",
    );
    return 2;
  }
  const runs = planRuns({ update });
  if (dryRun) {
    for (const step of runs) {
      process.stdout.write(`[pixel-run] ${step.label} → ${describeStep(step)}\n`);
    }
    process.stdout.write(
      "[pixel-run] 说明：默认只在当次检出自证、不落盘；`--update` 才写基线\n",
    );
    // 前置判决的结果也打出来：`--dry-run` 是「无副作用地问一遍这机器能不能跑」，
    // 它若只打印命令行而不答这一问，人还是得真跑一次才知道本机有没有基线。
    process.stdout.write(
      update
        ? "[pixel-run] 本机基线：录基线档（`--update`）不拦缺基线\n"
        : `[pixel-run] 本机基线：${process.platform} 成套齐备（检查档带 --update-snapshots=none，不落盘）\n`,
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
