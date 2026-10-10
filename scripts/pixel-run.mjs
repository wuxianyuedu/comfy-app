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
 *   node scripts/pixel-run.mjs --workers=1  降并发跑（**负载假红**那条出路，见下）
 *
 * ⚠️ **`--workers=N` 是「整批因负载失稳」时的出路，不是新的默认口径**（ISSUE #1620）。
 * 判据是 §11.13 那句硬动作：整批红而**降并发（隔离）绿** ⇒ 红的是机器不是像素。
 * 那时按 §11.13/§13.6.4 的口径降负载（杠杆是并发，**不是**抬阈值/加预算）跑一次，
 * 绿了就照常记账 —— 因为这条账要证的是「这一档的基线在本机可复现」，而降并发那次
 * 证的正是它。记账的 `how` 会写成 `pnpm check:visual --workers=N`，账面上因此分得开
 * 「本机默认跑得动」与「本机得降并发才跑得动」。
 * 这台机器**能稳定跑默认并发**时就不要用它：默认口径是唯一那一条，降并发只治负载。
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
  PENDING_PLATFORMS,
  SUPPORTED_PLATFORMS,
  VISUAL_DIR,
  checkRecordingEnv,
  freshnessTrack,
  isPlatformPending,
  isPlatformRegistered,
  missingBaselinesForPlatform,
  recordingWebserverFor,
  webserverForEnv,
  writeFreshness,
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
  if (isPlatformPending(platform)) {
    return (
      `本机平台 \`${platform}\` 的基线**登记为待重录**（${Object.keys(PENDING_PLATFORMS).join(" / ")}）——\n` +
      `      这一档缺的是新增的截图名，只能在**这一档的机器上**录：\n` +
      `        pnpm check:visual:update   # 需先把 \`CI\` 置成与该档基线录制时一致\n` +
      `      录完连同 \`scripts/visual-baselines.mjs\` 的 PENDING_PLATFORMS 登记一起删掉。缺这几张：\n${listed}`
    );
  }
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
 * `workers` 是**负载假红**那条出路（§11.13，见 `--workers` 的用法）：给了就往
 * Playwright 追加 `--workers=N`，覆盖 `playwright.config.ts` 的 `fullyParallel`。
 * 它只降并发、不改断言与阈值 —— 后者是 §11.13 明令禁止的取巧（把「真挂死」一起放过）。
 *
 * @param {{update?: boolean, workers?: number | null}} [opts]
 * @returns {Array<{label: string, kind: "playwright" | "vitest", args: string[]}>}
 */
export function planRuns({ update = false, workers = null } = {}) {
  const playwrightArgs = ["test", VISUAL_DIR];
  // 检查档**必须**显式关掉落盘：Playwright 的默认是 `'missing'`（缺基线照样写文件），
  // 不写这一档就等于「默认不落盘」只对已有基线成立。
  playwrightArgs.push(
    update ? "--update-snapshots" : `--update-snapshots=${CHECK_UPDATE_MODE}`,
  );
  // 只在显式要求时追加：不写 `--workers` 时走 `playwright.config.ts` 的默认并发，
  // 「默认口径」因此仍是**唯一**的（降并发是一条按需的出路，不是新的默认）。
  if (workers !== null) playwrightArgs.push(`--workers=${workers}`);
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
 * `--workers=<n>` 的解析 —— 降并发那条出路（§11.13）的入口。
 *
 * 三种答案，各自的动作不同：
 *   · 没给 ⇒ `null`，走 `playwright.config.ts` 的默认并发（**默认口径不被改**）；
 *   · 给了合法正整数 ⇒ 那个数，追加 `--workers=N`；
 *   · 给了但不合法 ⇒ **抛**，由 `main` 转成退出码。静默当成「没给」是最坏的形态：
 *     人会以为自己在降并发跑，实际仍是默认并发、又红一次，且看不出差别在哪。
 *
 * 上界不设：`--workers=64` 是使用者对这机器的判断，判据不该替他猜。下界必须是 ≥1
 * 的整数 —— Playwright 对 `--workers=0` / 非数字只回一句语焉不详的用法错误。
 *
 * @param {string[]} argv
 * @returns {number | null}
 */
export function parseWorkers(argv) {
  const hit = argv.find((a) => a === "--workers" || a.startsWith("--workers="));
  if (hit === undefined) return null;
  const raw = hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "";
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(
      `[pixel-run] --workers 需要一个 ≥1 的整数（收到 "${hit}"）—— ` +
        "它是**降并发**那条出路（整批因负载失稳时用），不是新的默认口径。",
    );
  }
  return Number(raw);
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
    step.kind === "playwright" ? resolvePlaywrightCli() : resolveVitestEntry();
  return spawnSync(process.execPath, [entry, ...step.args], {
    cwd: ROOT,
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

/**
 * 跑绿之后记一次**基线新鲜度**账（`scripts/.visual-baseline-freshness.json`，§11.8）。
 *
 * 这一步是「linux 档定期跑一次 `pnpm check:visual`」这条纪律的**落点**：账上的日期就是
 * 「上一次真跑过」的事实，而不是一句「录过就算数」。此前的状态正是后者 —— 入库的
 * `-linux.png` 有 4 张悄悄过期（与当次环境差 1 像素），而没有任何东西记着这一档
 * 上一次被跑绿是什么时候。
 *
 * 三条边界：
 *   · **只有检查档记**（`--update` 不记）：录基线本身**不是**自证 —— 「写成功」与
 *     「像素可复现」是两件事，这一点 §11.8 反复写着。
 *   · **只有绿了才记**：红着的时候记一条「我跑过」会把「跑过」与「跑绿过」混成一件
 *     事，而那正是这条账要防的。
 *   · **当场打印这一档上次是什么时候**：账的价值在于被**看见**，不是被写下来。
 *
 * 真正的读写落在 `scripts/visual-baselines.mjs` 的 `writeFreshness` —— **全量 e2e 那一档
 * 用的是同一个形状**（`scripts/e2e-run.mjs`，账文件 `scripts/.e2e-freshness.json`，
 * ISSUE #1547）。两条账各留一份「怎么读、怎么算 who、写哪儿」的实现在这里曾经是本仓库
 * §12.12 的孪生对，而它们的漂移形态很难看：一边把坏 JSON 当成空账（判红、话术正确），
 * 另一边静默少守一条。这里只留**与像素有关的那两件事**：口径怎么算（`CI` 的真假）、
 * 以及——`--update` 不记。
 *
 * 写账失败（只读挂载等）不算跑像素的失败 —— 像素的结论已经拿到了，返 1 会把两件事
 * 混成一句「像素档挂了」。所以这里只提示。
 *
 * ⚠️ **降并发跑出来的绿一样记，但 `how` 必须写出真实的并发**（ISSUE #1620）：
 * 机器的 dev server 在默认 `fullyParallel` 下会因**负载**失稳（整批红、降并发就绿，
 * 见 §11.13），而这条账要证的是「这一档的基线在本机可复现」—— 负载假红证的正是它。
 * 若把降并发那次记成名义命令 `pnpm check:visual`，账面上就分不出「本机默认跑得动」
 * 与「本机得降并发才跑得动」，下一个人按名义命令复跑必红、却指不出差别在哪。
 *
 * @param {{platform: string, update: boolean, workers?: number | null}} args
 * @returns {string | null} 给输出用的一句读数（不记时不返回内容）
 */
export function recordFreshness({ platform, update, workers = null }) {
  if (update) return null;
  const { note } = writeFreshness({
    root: ROOT,
    kind: "visual",
    who: gitUser(platform),
    // 记给**这一档平台**（不是写死 `track.key`）：win32 录一次写不进 win32 键，
    // 这一档就永远「没有记录」——那正是它当初只能靠 `PENDING_PLATFORMS` 顶着的根因。
    key: platform,
    // 与 `planRuns` 同源拼法（§12.12）：两处各写一遍时，「实际怎么跑的」与「账上记的
    // 怎么跑的」会漂成两件事 —— 而那正是这一栏存在的意义。
    how: pixelCommand({ workers }),
  });
  const how = `CI=${webserverForEnv(process.env) === "start" ? "true" : ""} ${pixelCommand({ workers })}`;
  return `${note}（本次口径：\`${how}\`）`;
}

/**
 * 像素档「能照着重跑」的那条命令 —— **唯一**的拼法出处（`how` 栏与输出都用它）。
 *
 * 名义跑法取 `FRESHNESS_TRACKS.visual.run`（`pnpm check:visual`），降并发时把
 * `--workers=N` 缀在后面。抽出来是为了让「实际跑的」与「账上记的」不可能漂。
 *
 * @param {{workers?: number | null}} [opts]
 * @returns {string}
 */
export function pixelCommand({ workers = null } = {}) {
  const base = freshnessTrack("visual").run;
  return workers === null ? base : `${base} --workers=${workers}`;
}

/**
 * 记账要用的人名：优先 `GIT_AUTHOR_NAME`（提交身份），退回 `git config user.name`，
 * 都拿不到就用档名 —— 空着会让这一栏被判红，而它恰好是这条账存在的意义。
 *
 * 两条新鲜度账共用同一份推导（与 `writeFreshness` 同因）：各写一套时会出现「像素档记
 * 的是环境变量、e2e 档记的是 git config」，于是同一个人的两条记录名字不一样。
 *
 * @param {string} fallback
 * @returns {string}
 */
export function gitUser(fallback) {
  return (
    process.env.GIT_AUTHOR_NAME ||
    spawnSync("git", ["config", "user.name"], {
      cwd: ROOT,
      encoding: "utf8",
    }).stdout?.trim() ||
    fallback
  );
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
  /* 降并发那条出路的入参。解析失败时**当场**退出，不静默当「没给」——
   * 后者会让人以为自己在降并发跑（见 `parseWorkers` 的注释）。 */
  let workers;
  try {
    workers = parseWorkers(argv);
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n` +
        "        用法：node scripts/pixel-run.mjs [--update] [--dry-run] [--workers=N]\n",
    );
    return 4;
  }
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
  /* 第二问（与缺基线**并列**、不互相替代）：「本机 `CI` 与这一档基线的录制口径一致吗」。
   *
   * 为什么录基线档也要拦：口径不符时 `--update` 会**成功**——生成一套看着正常的 PNG。
   * 它自洽、不会当场红，只在以后某次真差异里混进来、还指不出是它。录基线这一路此前
   * 正是这层开着的口子（`--update` 刻意不受缺基线那闸拦，那是它的本分；但口径这一条
   * 跟缺不缺基线无关，两个方向都要拦）。
   * 检查档同样拦：口径不符时报的 diff 是 dev 指示器那一块，而 `classifyFailure` 只认
   * 三条实测形态、认不出它，会把人引去改业务代码。 */
  const envProblem = checkRecordingEnv({
    platform: process.platform,
    env: process.env,
  });
  if (envProblem) {
    process.stderr.write(
      `[pixel-run] ✗ 本机（${process.platform}）的 webServer 口径与该档基线不一致 —— 未启动 webServer / 浏览器\n` +
        `        定性：${envProblem}\n` +
        "        规范：docs/standards/11-测试与可观测性.md §11.8\n",
    );
    return 3;
  }
  const runs = planRuns({ update, workers });
  if (dryRun) {
    for (const step of runs) {
      process.stdout.write(
        `[pixel-run] ${step.label} → ${describeStep(step)}\n`,
      );
    }
    process.stdout.write(
      "[pixel-run] 说明：默认只在当次检出自证、不落盘；`--update` 才写基线\n",
    );
    // 并发口径打在台面上：`--workers` 是**这次**才生效的，而它也正是「跑绿怎么记」
    // 那一栏的内容（`how` 跟着它走），不说清等于让人从账面上猜。
    process.stdout.write(
      workers === null
        ? "[pixel-run] 并发：playwright.config.ts 的默认（`--workers` 未给）\n"
        : `[pixel-run] 并发：显式降到 ${workers} 个 worker（记账的 how 会写成 \`${pixelCommand({ workers })}\`）\n`,
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
    // webServer 走哪条由 `playwright.config.ts` 按 CI 的真假分流，而这条分流决定了
    // 本步要不要先有生产构建、以及**报出来的差异算不算数**（口径不符时的 diff 是
    // dev 指示器那块，不是界面变形）。把它连「与本档登记口径是否一致」一起打在台面上。
    process.stdout.write(
      process.env.CI
        ? "[pixel-run] webServer：按 CI 口径 → `pnpm start`（需要先有生产构建）\n"
        : "[pixel-run] webServer：本地口径 → `pnpm dev`（无需先构建）\n",
    );
    process.stdout.write(
      `[pixel-run] 口径核对：${process.platform} 档登记为 \`pnpm ${recordingWebserverFor(process.platform) ?? "（未登记）"}\`，` +
        `本机实走 \`pnpm ${webserverForEnv(process.env)}\`\n`,
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
    /* 跑绿即记账（§11.8 的基线新鲜度账）：**录基线不记**（写成功不是自证）、
     * **红着不记**（跑过 ≠ 跑绿过）。这一步让「定期跑一次」有了落点。 */
    const note = recordFreshness({
      platform: process.platform,
      update,
      workers,
    });
    if (note) process.stdout.write(`[pixel-run] ${note}\n`);
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
