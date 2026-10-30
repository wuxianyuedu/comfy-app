#!/usr/bin/env node
/**
 * quality-gate.mjs — 本地质量门禁的**跨平台**实现（规范 11.12 / 13.5）
 *
 * 与 `scripts/quality-gate.ps1` 同契约同产出：按顺序跑 typecheck / eslint（零警告）
 * / vitest（默认排除已知基线失败），任一失败以非零退出码结束，并打印可行动的中文提示。
 * Windows 侧的双击入口（`tools/start/verify-quality.ps1`）走 `.ps1`；Linux / macOS / CI
 * 直接跑本文件（`pnpm check:all`），不需要 pwsh。
 *
 * ⚠️ 「同契约」指的是**门禁清单、退出码、话术形状**三份，不含两条流的分派：本文件的
 * 红行走 stderr（`emitVerdict()` 一处决定，为的是机器侧能用 `2>` 单独捞出来，
 * ISSUE #2653），而 `.ps1` 那一侧是人对着控制台看 —— 两条流落在同一屏里，分派没有消费者。
 * 因此既不要为此改 `.ps1`，也不要反过来把本文件的红行拉回 stdout。
 *
 * 为什么不把口令写进文档让人手敲：门禁是**多步串联**（三条命令 + 依赖一致性预检 +
 * 已知基线失败排除）。写成文档就有「漏跑一步 / 顺序反了 / 只跑了自己记得的那个」的
 * 空间，而这些都不会报错——只是让绿灯变得不可信（规范 §9.2 第 3 条禁止的静默失败）。
 *
 * 用法：
 *   node scripts/quality-gate.mjs                # 全部
 *   node scripts/quality-gate.mjs --mode lint    # 只跑一项（`--mode=lint` 同形）
 *   node scripts/quality-gate.mjs --mode all     # 显式全部
 * 除此之外**不认任何旗标**：拼错的形式与缺值的 `--mode` 一律退 2 并念出认识的形态，
 * 不静默回落到「全部」——那在一份带 `vitest --coverage` 的入口上是最贵的一种误读
 * （ISSUE #2709）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { spawnSync } from "node:child_process";

import { renderDriftReport } from "./lockfile/render-lock-diff.mjs";
import { lockfileDrift } from "./launcher-core/worktree.mjs";
import { echoCommandLine, formatCommandLine } from "./launcher-core/command-echo.mjs";
import { pnpmInvocation } from "./launcher-core/shell.mjs";
import { KNOWN_FAILED_FILES } from "./quality-gate-shared.mjs";
import { renderVerdict } from "./ci-log.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/**
 * 一条判决落在哪条流，**只在这一处决定**：红走 stderr、其余走 stdout。
 *
 * 这句话此前是本文件里的两份答案（ISSUE #2653）：`reportVerdict()` 用两个 `for`
 * 各写一遍分流，而 `fail()` 与整轮小结根本没写 —— 于是「红要能从一屏绿里被 `2>`
 * 单独捞出来」只覆盖到各档自己那一行，失败路径与「这一轮红了几档」那三行仍在 stdout。
 * 判决行、它前面那段段头、它后面那几行出路**必须同一条流**：出路留在 stdout，
 * 捞出来就只剩半截判决。
 *
 * @param {{state?: "ok"|"skip"|"red", gate?: string, subject?: string, detail?: string, hint?: string, items?: Array<string>, before?: Array<string>, after?: Array<string>}} verdict
 *   除 `before` / `after` 之外的字段原样交 `renderVerdict()`（纯函数，本文件不碰它的形状）
 */
function emitVerdict({ before = [], after = [], ...verdict }) {
  const write = verdict.state === "red" ? console.error : console.log;
  for (const line of before) {
    write(line);
  }
  for (const line of renderVerdict(verdict)) {
    write(line);
  }
  for (const line of after) {
    write(line);
  }
}

/**
 * 失败路径的统一出口（ISSUE #2588）：此前四条失败路径调用一个**从未声明过**的
 * `fail()`，真跑进去时抛 `ReferenceError: fail is not defined` —— 结论方向没错
 * （仍然非零退出），但失败原因那一格是空的，读者拿到的是一屏指向门禁自身的栈。
 * 形状收进 `renderVerdict()` 一份（§12.12）：红行由共享 formatter 给，
 * 提示行与退出码仍由调用点自己负责（四个站点的码各不相同：null / 1 / 2）。
 *
 * @param {string} message 本来要说的那句可行动的中文
 * @param {{gate?: string, before?: Array<string>, after?: Array<string>}} [options]
 *   `gate` 判据名（缺省按本入口自己的名字念）；`before` / `after` 是同一条失败块的
 *   段头与出路 —— 跟着判决走同一条流，不许留在 stdout
 */
function fail(message, { gate = "quality-gate", before = [], after = [] } = {}) {
  emitVerdict({ state: "red", gate, detail: message, before, after });
}

/** 门禁清单：与 quality-gate.ps1 的 $Blocks 一一对应（新增门禁两处同步）。 */
/**
 * 一档判决的登记：屏幕上念什么（`label`）、怎么起（`args`）、要不要进 `all` 那一档
 * （`run: false` = 只在显式点名时跑）。
 *
 * 这三件就是**实现里真实存在的三个键**（当场数过 10 档，没有一个条目带第四个键）——
 * 写这个 typedef 的直接收益是那 4 格「按字符串索引 GATES」不再报隐式 any：
 * `GATES[key]` 过去在 `{ typecheck: {…}, lint: {…}, … }` 这个字面量类型上按 string
 * 取，取到的类型是 `any`，于是 `GATES[k].run !== false` 与 `GATES[k].label` 都不曾被判过。
 * @typedef {Object} Gate
 * @property {string} label
 * @property {string[]} args
 * @property {boolean} [run]
 */
/** @type {Record<string, Gate>} */
const GATES = {
  typecheck: { label: "Typecheck (tsc --noEmit)", args: ["typecheck"] },
  lint: {
    label: "ESLint zero error / zero warning",
    /* 扫描范围（白名单目录）与参数（`--max-warnings 0` / `--cache-strategy
     * content`）收在 package.json 的 `lint` 脚本里：四个调用点（.githooks/
     * pre-commit 第 7 步 / 本文件 / quality-gate.ps1 / CI）共用同一份命令，
     * 各自的目录清单与 `--cache` 参数不再各抄一遍（抄一遍就会漂移）。
     * 范围口径与 `content` 策略的理由见 `eslint.config.js` 顶部那节。 */
    args: ["run", "lint"],
  },
  /**
   * 格式棘轮（规范 §13.5 / ISSUE #575 第 9 项）。
   *
   * 放在一键门禁里，是因为它是**唯一一条会随时间变坏**的检查：其余命令当日跑过
   * 就是过了，而格式棘轮要求「你今天新增的文件必须干净」。只写在 pre-commit 里
   * 的话，用 `--no-verify` 或被未启用钩子的检出提交就绕过去了 —— 那恰好是它要防的。
   */
  format: {
    label: "oxfmt format ratchet",
    /* `--changed`：判改动面 ∩ 扫描面（printWidth 80→100 起全库档对未迁移的
     * 存量恒红，见 check-format.cjs 文件头；check:all 是「按需完整验证」，
     * 对格式的读数与平台 PR 那一格同口径 —— 判「这次带来的那批」）。 */
    args: ["../scripts/check-format.cjs", "--changed"],
  },
  test: {
    label: "Vitest full run + coverage ratchet (excluding known baseline failures)",
    /* 覆盖率门槛此前是**死配置**：`vitest.config.ts` 的 `coverage.thresholds` 写了
     * 几十条按实测定的门槛，但门禁这一步是裸 `vitest run`，不带 `--coverage` ——
     * 于是没有任何自动化路径判定过它们，「覆盖率棘轮」只存在于配置文件里
     * （规范 §11.7 / 台账 E2）。
     * 两个约束一起记在这里：
     *   1. **只在全量档判**。单文件跑 `--coverage` 会把其余路径按 0% 算，
     *      `thresholds` 表里的每一条都刷红（实测：单跑一份 LogPanel 就报出
     *      `src/lib/workshop/**` / `ui/image-viewer.tsx` 等一串 0% 不达标）——
     *      所以这一步不能收窄，也别学它把 `--coverage` 加进钩子的增量档。
     *   2. 红与覆盖率已经**各自记账**（`vitest.config.ts` 的 `reportOnFailure`），
     *      不再出现「一条试用例红 → 报告不产出 → 门槛静默缺席」。
     * ⚠️ 第三条是后补的（ISSUE #2669）：**CI 那一档已经不判门槛**（整体/目录级覆盖率
     *      改成只上报），所以这一步是那份登记处现在**唯一**会算它的地方 —— 本条目
     *      显式给子进程带 `COMFY_COVERAGE_ENFORCE=1`（见 `runGate`）。摘掉它，
     *      149 条门槛就又回到「写在配置里、没人判」那个原病上。
     * 代价说清楚：这一步的墙钟从约 10 分钟涨到带 instrumentation 的量级（实测全量
     * 591s → 更长），`check:all` 本来就是「按需完整验证」那一档，不是每次提交。 */
    args: ["exec", "vitest", "run", "--coverage"],
  },
  /**
   * 依赖漏洞扫描棘轮（ISSUE #1331，规范 §13.5）。
   *
   * 与 `format` 同属「会随时间变坏」的那一类：昨天的依赖树干净推不出今天干净 ——
   * registry 每天在发新 advisory，而此前**没有任何机器路径**会告诉我们「上游已出修复版」
   * （实测开立时：`js-yaml` 的修复版 4.3.2 已发布，仓库里躺的是 4.3.1）。
   *
   * 刻意**不**接进 `.githooks/pre-commit`：这是网络请求，离线或 registry 抖动会把
   * 「提交失败」变成日常，与 §13.5.4「按需召唤」那一层一致。脚本自身在拿不到 registry
   * 时打「未扫描」并退 0（话术里不许出现「干净」），但 stdout 不是 JSON、pnpm 压根没起来
   * 这类**判据坏了**的形态仍判红。台账形状（按 `(包名, advisory id)` 记账、双向拦、
   * `--update` 只许降、每条基线必须有 reason）见 `check-dependency-audit.mjs` 文件头。
   */
  dependencyAudit: {
    label: "Dependency audit ratchet (high/critical; ledger keyed by package+advisory)",
    args: ["../scripts/check-dependency-audit.mjs"],
  },
  /**
   * 故事枚举来源（ISSUE #1381 续，规范 16 §16.2.3.2）。
   *
   * 与 `format` 同属「改坏了不会有人碰到」的那一类：`cva()` 返回的是函数，
   * 写成 `Object.keys(xVariants.variants.轴)` 时运行期抛 `Cannot read properties
   * of undefined`，而 Storybook 的表现是「侧栏列着故事、画布一片空白」——
   * 不构建失败、不弹错，只是一片白。判据还顺带核「手写清单没漏档」，
   * 首轮实测漏了 `icon-sm` / `icon-lg`（46 处调用在用的两档）。
   */
  storybook: {
    label: "Storybook story enum source (cva return value / missing variants)",
    args: ["../scripts/storybook-check.mjs"],
  },
  /**
   * 依赖新鲜度：远端改过库的版本而本地还停在旧的那套上（规范 §13.5.13）。
   *
   * 与 `format` / `dependencyAudit` 同属「会随时间变坏」的那一类：**昨天的结论推不出
   * 今天** —— 远端随时可能升依赖，而本地一旦落下就再没有任何东西会说。放在
   * `check:all`（而不是只在钩子里带 `--staged`）是因为「完整验证」这一档本来就该
   * 回答「我这套依赖是不是当前基线的」；钩子那档只在**动了依赖面**时判，两档共用
   * 同一份实现，形态由 `--staged` 决定。
   *
   * 它下面紧挨着的 `dependencyDrift()` 预检判的是「装了没装对」，本条判的是
   * 「该装的是不是远端那一套」——**两层不同，别合并**（依赖一致性预检早就有了，
   * 而 ISSUE #1569 报的正是它盖不住的那一格）。
   */
  depsFreshness: {
    label: "Dependency freshness (baseline vs origin/master + install sync)",
    args: ["../scripts/check-deps-freshness.mjs"],
  },
  /**
   * **client chunk 体积预算**（ISSUE #1781，规范 §13.5.4）。
   *
   * **它不在 `all` 里**（`run: false`）：测量对象是 `next build` 的产物
   * （`.next/static/chunks`），判据在一次构建之后才有结论，而构建是半分钟级
   * （实测 26–33s，冷 / 热一样）—— 把它塞进每一次「完整验证」是拿半分钟换一个
   * 不会天天变的结论（成本判据同 §13.5.4）。同一脚本也挂在 `pnpm build` 收尾
   * （形态 C 兜底），所以这条更准确地说是一份**按需入口**：
   * `pnpm check:bundle` / `pnpm check:all --mode bundleBudget`。
   *
   * 与上面两档不同，它**不吃产物不存在**这一格：没构建过时脚本打「跳过」并退 0
   * （守的是构建结果，不是构建本身，同 `check-standalone-contents.cjs`）。
   */
  bundleBudget: {
    label: "Bundle size budget (client chunk gzip total + file count ratchet)",
    args: ["../scripts/check-bundle-budget.cjs"],
    run: false,
  },
  /**
   * **合并前的固定动作**（规范 §13.6.2；ISSUE #1611 拍板）。
   *
   * **它不在 `all` 里**（`run: false`）：平台侧是 **squash 合并**、那一步**不跑本地
   * 钩子**，而 #623 之后**已无 CI 兜底**（§13.5.3）—— 于是「我的分支绿 → `master`
   * 绿」之间那一跳此前靠人的纪律补，而纪律有三种漏法（漏跑一步 / 顺序反了 / 只跑了
   * 自己记得的那条），**三种都不报错**（§9.2 第 3 条禁止的静默失败）。
   *
   * 这一跳现在有执行者了：`.githooks/pre-push` 在 HEAD 或上游引用变动时自动跑它
   * （`scripts/premerge-proof.mjs`，规范 §13.6.2.1）。`run: false` 的理由**不变** ——
   * 它判的是「并进去之前」那一刻，不属于每一次「完整验证」都该重复付钱的那一档。
   *
   * 这个洞在计划里被拆成三笔，三笔落在**同一个动作**上（`--base` 复算 / 提交信息里的
   * 机械可核声明 / 合并有没有丢一侧），所以入口只有一个 `scripts/premerge-check.mjs`：
   * 它**直接 import** `base-check.mjs` 的 `baseCheckMany`，另外两段走既有脚本 ——
   * 不发明第二套编排（§12.18 / §12.12）。
   *
   * 为什么不能进 `all`：它的 `base` 段要建干净 worktree、跑整批判据（分钟量级），
   * 且它的语义是「**并进去之前**量一次」—— 每一次「完整验证」都跑它没有意义，
   * 而它要回答的那个问题（会不会把红带进 master）只在合并那一刻成立。
   *
   * 它与 `check:all` **不互相替代**：后者是更宽的那一档（全量单测 + 覆盖率 +
   * 依赖审计），本条判的是这一跳。
   */
  /**
   * **每日那一跑的出勤**（ISSUE #2114 出路 1 / 规范 §13.5.23 末节）：答的是
   * 「上一次每日派发到底有没有执行」，而不是「那一格里哪条判据红了」—— 后者归
   * `ci-build-readout.mjs`，这一档整个复用它的四档判定，不重写第二份。
   *
   * **它不在 `all` 里**（`run: false`）：判据要上网问平台（一次 `get-build-logs` +
   * 至多三跑的逐格详情）。把网络请求放进「每次完整验证」是另一回事 ——
   * §13.5.13 那条同口径：判据自身不做网络请求，「现在去不去问平台」是人的动作。
   * 三态退码里 **2 = 没结论 / 取不到读数，不算绿**（「被取消」与「拿不到测量」都不许
   * 被读成红或被读成绿，那两种误读本案都发生过）。
   *
   * 什么时候该跑：任何一次拿「平台那一档在跑」当本地豁免理由的争论现场
   * （`FRESHNESS_TRACKS[*].ciStage` 那串豁免的前提就是这句话），以及每日档换了时刻
   * 或撤了格之后的第一次核对。出口：`pnpm check:daily-attendance`
   * / `pnpm check:all --mode dailyAttendance`。
   */
  dailyAttendance: {
    label: "Daily tier attendance (did the last scheduled run actually execute)",
    args: ["../scripts/check-daily-attendance.mjs"],
    run: false,
  },
  premerge: {
    label: "Pre-merge fixed action (base recompute + commit claims + merge side loss)",
    args: ["../scripts/premerge-check.mjs"],
    run: false,
  },
};

/**
 * 命令行只有一件事可给：跑哪一档。**两种形式都认**（`--mode lint` 与 `--mode=lint`）。
 *
 * 为什么要专门认等号形式（ISSUE #2709 的现场）：原实现只匹配 `argv[i] === "--mode"`，
 * 于是 `--mode=lint` 落不进任何分支，而循环对**不认识的参数一个字都不做** ——
 * `mode` 保持初值 `"all"`，表现是「以为自己在重跑一档，实际把整套默认档跑完」
 * （含 `vitest --coverage`，实测 10 分钟 / 1209 行输出）。
 * 「没提要求」在这份工具里意味着最重的那一档，所以不认识的写法不许被读成它：
 * 收进 `unknown` 交给调用点退 2，**而不是静默继续**。
 * @param {string[]} argv
 * @returns {{mode: string, unknown: string[]}} */
function parseArgs(argv) {
  /** @type {{mode: string, unknown: string[]}} */
  const out = { mode: "all", unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--mode") {
      const next = argv[i + 1];
      /* 提了旗标没给值 ⇒ 不算「没提要求」：原实现那句 `|| "all"` 正是本单要收的那一格
       * （缺值 / 不认识的形式统统落回 `"all"`，而 `"all"` 在这份工具里是最重的一档）。 */
      if (next === undefined || next.startsWith("--")) {
        out.unknown.push(arg);
        continue;
      }
      i += 1;
      out.mode = next;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      out.mode = arg.slice("--mode=".length);
      if (!out.mode) {
        out.unknown.push(arg);
      }
      continue;
    }
    out.unknown.push(arg);
  }
  return out;
}

/**
 * 这一档判决的打印**只有一处出处**：`scripts/ci-log.mjs` 的三态出口（ISSUE #2506）。
 *
 * 从前这里用 `==> 标题` 打段头、`  [OK] … passed` / `  [FAIL] … failed (exit N)` 打结论，
 * 而同一台机上的钩子打的是 `── check: <标签>` + `  [ok] ── …`、跑批打的是 `[重档] … ok`。
 * 三段话术说同一件事，且「这一档没跑」在三种形状里没有位置。
 * @param {Gate} gate @param {number} code @returns {void} */
function reportVerdict(gate, code) {
  emitVerdict({
    state: code === 0 ? "ok" : "red",
    gate: gate.label,
    detail: code === 0 ? "通过" : `退出码 ${code}`,
    hint: code === 0 ? "" : "先修这一档，再重跑 `pnpm check:all`（`--mode <档名>` 可以只重跑它）",
  });
}

/**
 * 依赖一致性预检（ISSUE #550）。
 *
 * 拉取更新若新增/删改了依赖却没重跑 `pnpm install`，node_modules 会与 lockfile
 * 脱节：typecheck / eslint / vitest 各自抛一串晦涩的解析失败，人容易误以为是自己
 * 改坏了。这里先拦一道，并把差异**逐项**打印（只报「不一致」等于把定位成本全推走）。
 */
function dependencyDrift() {
  const nm = path.join(ROOT, "node_modules");
  if (!fs.existsSync(nm)) {
    return { drift: true, reason: "node_modules 完全没装过" };
  }
  // 判据本身走 `lockfileDrift`（`launcher-core/worktree.mjs`）——**唯一出处**，
  // 与启动器 / `check-deps-freshness.mjs` 共用同一份"实质差异"口径。此前这里自己
  // 拼了一遍 `diffLockfiles`，"直接读安装时 lockfile"与"读不到时算不算漂移"
  // 这两个边界各写各的，已经在三处漂移（ISSUE #1569 收口）。
  const drift = lockfileDrift(ROOT);
  if (drift.state === "fresh") {
    return { drift: false, reason: "" };
  }
  if (drift.state === "no-lockfile") {
    return { drift: false, reason: "" };
  }
  return {
    drift: true,
    reason:
      drift.state === "no-install"
        ? "没有 node_modules/.pnpm/lock.yaml（install 中断或残缺）"
        : "node_modules 与仓库 pnpm-lock.yaml 的实质内容不一致",
    diff: drift.diff,
  };
}

/** 跑一条门禁；返回退出码。 */
/**
 * 解析要用的 pnpm —— **形态与 args 一起**给出来，不返回裸可执行名。
 *
 * 这里曾是本仓库第 N 个各写一份的 pnpm 解析点：`whichCommand("pnpm")` 只解决
 * 「PATH 上哪个文件」，而 Windows 上那个文件可能是核心形态起不来的 `.cmd`
 * （批处理只有 cmd.exe 解释，Node 起它 EINVAL）—— 真正能跑的是同目录经
 * PowerShell 宿主的 `.ps1`，`spawnSync` 还得连宿主与 `-File` 参数一起给。
 * 判据只在 `pnpmInvocation()` 一处（规范 §2.1.1 / §9.5），这里不自己拼。
 *
 * @returns {{ command: string, prefixArgs: string[] } | null}
 */
function resolvePnpm() {
  const invocation = pnpmInvocation([]);
  if (invocation) {
    return { command: invocation.command, prefixArgs: invocation.args };
  }
  fail("PATH 上找不到可用的 pnpm —— 门禁无法运行。", {
    after: [
      "        自查：pnpm check:toolchain（会打印选中的形态与探测结果）",
      "        修复：corepack enable && corepack prepare pnpm@<packageManager 版本> --activate",
    ],
  });
  return null;
}

/**
 * @param {{command: string, prefixArgs: string[]}} pnpm 上面那个解析器的成功形
 *   （不重述它的字段，取它已声明的那一份）
 * @param {string} key 这一档在 `GATES` 里的名字（只用来判 `test` 那一档要不要带排除清单）
 * @param {Gate} gate 由调用点交出（见 `main` 里那段「解一次」的注释）
 * @returns {number} */
function runGate(pnpm, key, gate) {
  /** 实际的命令行形态：宿主（`.ps1` 形态时是 pwsh/powershell）+ pnpm 参数。
   *  分成 `{command, args}` 而不是打平成一个数组：调用点要的是「可执行件 + 参数表」
   *  两件事，打平之后从数组头取那一项在类型上就是 `string | undefined`，
   *  而 `spawnSync(…)` 的首参要的是 `string`（这一格是 `gate.args` 有了类型之后现形的）。
   * @param {string[]} args @returns {{command: string, args: string[]}} */
  const invocation = (args) => ({
    command: pnpm.command,
    args: [...pnpm.prefixArgs, ...args],
  });
  // 门禁脚本是 `node scripts/xxx.cjs` / `xxx.mjs` 而不是 pnpm 子命令：用 node 直接跑，
  // 免得再套一层 pnpm exec（那层只带来解析开销与 Windows 的 .cmd 差异）。
  // 认 `.mjs` 与认 `.cjs` 是同一条理由 —— 只认后者会让新加的 ESM 门禁被当成
  // pnpm 参数（`pnpm ../scripts/x.mjs`），表现是一句看不懂的「command not found」。
  /* 解一次首项而不是按三次下标：`gate.args[0]` 在 `noUncheckedIndexedAccess` 下是
   * `string | undefined`，原来那句 `?? ""` 只喂了正则，`path.basename(…)` 那一处并没有被
   * 它保护 —— 空串本来也匹配不上 `\.(?:c|m)?js$`，所以「首项在且是脚本」这一条判据
   * 与原来的覆盖面逐字相同。 */
  const [firstArg, ...restArgs] = gate.args;
  if (firstArg && /\.(?:c|m)?js$/.test(firstArg)) {
    const script = path.resolve(ROOT, "scripts", path.basename(firstArg));
    // 回显解释器与脚本的**真实**路径（不写成 `node scripts/x.cjs` 的近似形态）：
    // 这一步用的是 `process.execPath`，与 PATH 上的 `node` 未必是同一个。
    echoCommandLine(process.execPath, [script, ...restArgs]);
    const r = spawnSync(process.execPath, [script, ...restArgs], {
      cwd: ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    const code = r.status ?? 1;
    reportVerdict(gate, code);
    return code;
  }
  const args = [...gate.args];
  if (key === "test") {
    for (const f of KNOWN_FAILED_FILES) {
      console.log(`  skip known failure: ${f}`);
      args.push("--exclude", f);
    }
  }
  // 回显真正被执行的那条（`pnpm.command` 可能是经 PowerShell 宿主的 `.ps1`），
  // 而不是把参数拼到「pnpm」这个字面名后面 —— 后者在 Windows 上常常不是同一条。
  const { command, args: argv } = invocation(args);
  echoCommandLine(command, argv);
  const result = spawnSync(command, argv, {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
    /* 覆盖率门槛的**判定**在 CI 那一档已经改成「只上报」（ISSUE #2669），所以
     * `vitest.config.ts` 那 149 条登记值需要一个真的会算它的执行者，否则它就退化成
     * 又一份「写在配置里、没人判」的死配置（那正是下面这段注释记录的原病）。
     * `check:all` 就是那个执行者：它是本地「按需完整验证」那一档，不是每次提交、
     * 也不是平台流水线（`grep quality-gate .cnb.yml .githooks/*` 当场核过：只有
     * `package.json` 的 `check:all` 与 `tools/**\/*.ps1` 起它）。
     * 只给 `test` 这一条带，别的条目原样继承 —— 它不是全局开关。 */
    env: key === "test" ? { ...process.env, COMFY_COVERAGE_ENFORCE: "1" } : process.env,
  });
  // 「命令没起来」与「跑完但非零退出」分开报：前者 stderr 通常是空的，
  // `status ?? 1` 只给一个退出码等于没说原因（ISSUE #576 的形态）。
  if (result.error) {
    const spawnError = /** @type {NodeJS.ErrnoException} */ (result.error);
    fail(`起 ${command} 失败（${spawnError.code ?? "UNKNOWN"}）：${spawnError.message}`, {
      after: [`        实际命令：${formatCommandLine(command, argv)}`],
    });
    return 1;
  }
  const code = result.status ?? 1;
  reportVerdict(gate, code);
  return code;
}

function main() {
  const { mode, unknown } = parseArgs(process.argv.slice(2));
  /* 不认识的形式**先退**，一次档都不跑：这一格的代价是分钟级的（默认档含
   * `vitest --coverage`），把「拼错」读成「跑全套」是本入口能犯的最贵的那种误读。
   * 退码与「未知门禁」同形（2 = 这一步没有结论，不是「跑过了且绿」）。 */
  if (unknown.length > 0) {
    fail(
      `不认识的参数：${unknown.join(" / ")} —— 本入口只认 --mode <档名>（也认 --mode=<档名>）；` +
        `可选：${Object.keys(GATES).join(" / ")} / all`,
    );
    return 2;
  }
  // `run: false` 的门禁只在**显式点名**时跑：`all` 是「日常该完整跑一遍」那一档，
  // 而像素档的代价与它的结论有效性（基线带平台）都不属于那一档。
  /* 遍历表本身而不是「先取键再按键取回值」：`Object.keys(GATES)` 之后 `GATES[k]` 在类型上
   * 又是 `Gate | undefined`（与上面那条「解一次」是同一个口径的两种落点）。
   * `entries()` 一次拿到键与值，判据不变（`run: false` 的那几档不进默认档）。 */
  const defaultKeys = Object.entries(GATES)
    .filter(([, gate]) => gate.run !== false)
    .map(([k]) => k);
  const keys = mode === "all" ? defaultKeys : [mode];
  /* 先把键解成 `Gate` 再往下走。原来这里只判一次存在性，后面 `runGate` 里再按同一个
   * `string` 索引取一遍 —— 那就是批 13 记下的同一形：守卫在调用点、函数自己拿回
   * `Gate | undefined`。解一次并把解出来的那份交给执行者，判据与类型看到的是同一份事实
   * （话术、返回码 2、以及「先全量校验再跑依赖预检」这个顺序都没变）。 */
  /** @type {Array<{key: string, gate: Gate}>} */
  const plan = [];
  for (const k of keys) {
    const gate = GATES[k];
    if (!gate) {
      fail(`未知门禁：${mode}（可选：${Object.keys(GATES).join(" / ")} / all）`);
      return 2;
    }
    plan.push({ key: k, gate });
  }

  const drift = dependencyDrift();
  if (drift.drift) {
    /* 段头、逐项差异、出路 —— 与判决行是**同一块**，分开走两条流等于捞出来只剩半截判决。 */
    const after = [];
    if (drift.diff) {
      after.push(
        "  差异明细（仓库 pnpm-lock.yaml 对比最近一次安装时的 lockfile）：",
        ...renderDriftReport(drift.diff, { maxPerSection: 8 }),
      );
    }
    after.push(
      "        请先关闭所有正在运行的本项目窗口（dev server 会锁住原生模块），",
      "        然后在项目根目录执行：pnpm install",
      "        详见 docs/guides/sync-after-pull.md",
      "",
    );
    fail(`依赖与 pnpm-lock.yaml 不一致（${drift.reason}）。`, {
      before: ["", "==> 依赖一致性预检"],
      after,
    });
    return 1;
  }

  const pnpm = resolvePnpm();
  if (!pnpm) {
    return 1;
  }

  let exitCode = 0;
  const red = [];
  for (const { key, gate } of plan) {
    const code = runGate(pnpm, key, gate);
    if (code !== 0) {
      exitCode = code;
      red.push(gate.label);
    }
  }
  /* 整轮末尾按「跑了几档、红了几档、红的是谁」说一次：各档自己那几行只回答
   * 「我这一档怎么了」，回答不了「这一轮全跑完没有」。红的那几行（含「红的是谁」
   * 那一张名单）与判决同一条流 —— 决定下一动作的就是这一行。 */
  emitVerdict({
    state: exitCode === 0 ? "ok" : "red",
    gate: "一键门禁",
    detail: exitCode === 0 ? `${keys.length} 档全绿` : `${keys.length} 档里红 ${red.length} 档`,
    hint:
      exitCode === 0
        ? ""
        : "依次修上面那几档；只重跑其中一档用 `--mode <档名>`（可选：pnpm check:all --mode lint）",
    items: red.map((name) => `· ${name}`),
    before: [""],
  });
  return exitCode;
}

process.exit(main());
