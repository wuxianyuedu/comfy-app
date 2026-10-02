#!/usr/bin/env node
/**
 * quality-gate.mjs — 本地质量门禁的**跨平台**实现（规范 11.12 / 13.5）
 *
 * 与 `scripts/quality-gate.ps1` 同契约同产出：按顺序跑 typecheck / eslint（零警告）
 * / vitest（默认排除已知基线失败），任一失败以非零退出码结束，并打印可行动的中文提示。
 * Windows 侧的双击入口（`tools/start/verify-quality.ps1`）走 `.ps1`；Linux / macOS / CI
 * 直接跑本文件（`pnpm check:all`），不需要 pwsh。
 *
 * 为什么不把口令写进文档让人手敲：门禁是**多步串联**（三条命令 + 依赖一致性预检 +
 * 已知基线失败排除）。写成文档就有「漏跑一步 / 顺序反了 / 只跑了自己记得的那个」的
 * 空间，而这些都不会报错——只是让绿灯变得不可信（规范 §9.2 第 3 条禁止的静默失败）。
 *
 * 用法：
 *   node scripts/quality-gate.mjs                # 全部
 *   node scripts/quality-gate.mjs --mode lint    # 只跑一项
 *   node scripts/quality-gate.mjs --mode all     # 显式全部
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { spawnSync } from "node:child_process";

import { diffLockfiles, isEmptyDiff } from "./lockfile/lock-diff.mjs";
import { renderDriftReport } from "./lockfile/render-lock-diff.mjs";
import {
  echoCommandLine,
  formatCommandLine,
} from "./launcher-core/command-echo.mjs";
import { pnpmInvocation } from "./launcher-core/shell.mjs";
import { KNOWN_FAILED_FILES } from "./quality-gate-shared.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 门禁清单：与 quality-gate.ps1 的 $Blocks 一一对应（新增门禁两处同步）。 */
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
    label: "Prettier format ratchet",
    args: ["../scripts/check-format.cjs"],
  },
  test: {
    label:
      "Vitest full run + coverage ratchet (excluding known baseline failures)",
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
    label:
      "Dependency audit ratchet (high/critical; ledger keyed by package+advisory)",
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
};

function parseArgs(argv) {
  const out = { mode: "all" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mode") out.mode = argv[++i] || "all";
  }
  return out;
}

function info(msg) {
  console.log(`[INFO] ${msg}`);
}

function fail(msg) {
  console.error(`[ERROR] ${msg}`);
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
  if (!fs.existsSync(nm))
    return { drift: true, reason: "node_modules 完全没装过" };
  const installedLock = path.join(nm, ".pnpm", "lock.yaml");
  const rootLock = path.join(ROOT, "pnpm-lock.yaml");
  if (!fs.existsSync(installedLock)) {
    return {
      drift: true,
      reason: "没有 node_modules/.pnpm/lock.yaml（install 中断或残缺）",
    };
  }
  if (!fs.existsSync(rootLock)) return { drift: false, reason: "" };
  const diff = diffLockfiles(
    fs.readFileSync(installedLock, "utf8"),
    fs.readFileSync(rootLock, "utf8"),
  );
  return { drift: !isEmptyDiff(diff), diff };
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
  if (invocation)
    return { command: invocation.command, prefixArgs: invocation.args };
  fail("PATH 上找不到可用的 pnpm —— 门禁无法运行。");
  console.log(
    "        自查：pnpm check:toolchain（会打印选中的形态与探测结果）",
  );
  console.log(
    "        修复：corepack enable && corepack prepare pnpm@<packageManager 版本> --activate",
  );
  return null;
}

function runGate(pnpm, key) {
  const gate = GATES[key];
  /** 实际的命令行形态：宿主（`.ps1` 形态时是 pwsh/powershell）+ pnpm 参数。 */
  const invocation = (args) => [pnpm.command, ...pnpm.prefixArgs, ...args];
  // 门禁脚本是 `node scripts/xxx.cjs` / `xxx.mjs` 而不是 pnpm 子命令：用 node 直接跑，
  // 免得再套一层 pnpm exec（那层只带来解析开销与 Windows 的 .cmd 差异）。
  // 认 `.mjs` 与认 `.cjs` 是同一条理由 —— 只认后者会让新加的 ESM 门禁被当成
  // pnpm 参数（`pnpm ../scripts/x.mjs`），表现是一句看不懂的「command not found」。
  if (/\.(?:c|m)?js$/.test(gate.args[0] ?? "")) {
    const script = path.resolve(ROOT, "scripts", path.basename(gate.args[0]));
    console.log("");
    console.log(`==> ${gate.label}`);
    // 回显解释器与脚本的**真实**路径（不写成 `node scripts/x.cjs` 的近似形态）：
    // 这一步用的是 `process.execPath`，与 PATH 上的 `node` 未必是同一个。
    echoCommandLine(process.execPath, [script, ...gate.args.slice(1)]);
    const r = spawnSync(process.execPath, [script, ...gate.args.slice(1)], {
      cwd: ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    const code = r.status ?? 1;
    if (code === 0) console.log(`  [OK] ${gate.label} passed`);
    else console.log(`  [FAIL] ${gate.label} failed (exit ${code})`);
    return code;
  }
  const args = [...gate.args];
  if (key === "test") {
    for (const f of KNOWN_FAILED_FILES) {
      console.log(`  skip known failure: ${f}`);
      args.push("--exclude", f);
    }
  }
  console.log("");
  console.log(`==> ${gate.label}`);
  // 回显真正被执行的那条（`pnpm.command` 可能是经 PowerShell 宿主的 `.ps1`），
  // 而不是把参数拼到「pnpm」这个字面名后面 —— 后者在 Windows 上常常不是同一条。
  const [command, ...argv] = invocation(args);
  echoCommandLine(command, argv);
  const result = spawnSync(command, argv, {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
  // 「命令没起来」与「跑完但非零退出」分开报：前者 stderr 通常是空的，
  // `status ?? 1` 只给一个退出码等于没说原因（ISSUE #576 的形态）。
  if (result.error) {
    fail(
      `起 ${command} 失败（${result.error.code ?? "UNKNOWN"}）：${result.error.message}`,
    );
    console.log(`        实际命令：${formatCommandLine(command, argv)}`);
    return 1;
  }
  const code = result.status ?? 1;
  if (code === 0) console.log(`  [OK] ${gate.label} passed`);
  else console.log(`  [FAIL] ${gate.label} failed (exit ${code})`);
  return code;
}

function main() {
  const { mode } = parseArgs(process.argv.slice(2));
  const keys = mode === "all" ? Object.keys(GATES) : [mode];
  for (const k of keys) {
    if (!GATES[k]) {
      fail(
        `未知门禁：${mode}（可选：${Object.keys(GATES).join(" / ")} / all）`,
      );
      return 2;
    }
  }

  const drift = dependencyDrift();
  if (drift.drift) {
    console.log("");
    console.log("==> 依赖一致性预检");
    fail(`依赖与 pnpm-lock.yaml 不一致（${drift.reason}）。`);
    if (drift.diff) {
      console.log(
        "  差异明细（仓库 pnpm-lock.yaml 对比最近一次安装时的 lockfile）：",
      );
      for (const line of renderDriftReport(drift.diff, { maxPerSection: 8 }))
        console.log(line);
    }
    console.log(
      "        请先关闭所有正在运行的本项目窗口（dev server 会锁住原生模块），",
    );
    console.log("        然后在项目根目录执行：pnpm install");
    console.log("        详见 docs/guides/sync-after-pull.md");
    console.log("");
    return 1;
  }

  const pnpm = resolvePnpm();
  if (!pnpm) return 1;

  let exitCode = 0;
  for (const k of keys) {
    const code = runGate(pnpm, k);
    if (code !== 0) exitCode = code;
  }
  console.log("");
  if (exitCode === 0) console.log("All quality gates passed OK");
  else fail("Quality gates have failures; please fix and re-run.");
  return exitCode;
}

process.exit(main());
