#!/usr/bin/env node
/**
 * e2e-run.mjs — 真正跑一次全量 e2e 的那一层（规范 §11.8「按需的全量 e2e 档」）
 *
 * `node scripts/e2e-run.mjs [--grep <tag>] [--dry-run] [--skip "<理由>"]`：起 Playwright
 * 的 `e2e/`（webServer 与假 ComfyUI 都由 `playwright.config.ts` 按它自己的口径拉起），
 * 跑完按退出码给出「这条红该怎么读」的定性，**并在跑绿之后记一条新鲜度凭证**。
 *
 * ## 与另两层的分工（不写清就是又造一轮子 —— §12.18）
 *
 *   · `e2e-freshness-gate.mjs`（pre-commit D 组）判的是「今天的第一次提交**带没带**
 *     全量 e2e 的凭证」—— 它刻意**不跑 e2e**（起 webServer + 真浏览器会与钩子里的
 *     A/B/C/D 抢资源，而墙钟是十几分钟量级）。
 *   · 本文件是那道门禁的同一条纪律的另一半：**真要跑时怎么跑、跑出来的红算什么、
 *     绿了之后凭证落在哪**。它把「谁来跑」与「红的定性」变成一条可执行命令，
 *     而不是文档里一句「按需跑」。
 *   · `pixel-run.mjs` 是**像素档**那一路（`e2e/visual/**` + 基线配对判据）——
 *     两者是**互补**的，不是替代：全量 e2e 覆盖功能链路（含 `@critical`），
 *     像素档覆盖「界面有没有变形」。`--grep @critical` 那条**一条视觉用例都不含**
 *     （视觉 spec 没有 `@critical` 标签），所以它绿推不出像素层没事；反之亦然。
 *
 * ## 凭证
 *
 * 跑绿之后往 `scripts/.e2e-freshness.json` 记一条（档名 / 时刻 / 谁 / 命令），
 * 这就是「每天首次提交」那条判据的全部事实来源。**只有绿了才记**：红着的时候记一条
 * 「我跑过」会把「跑过」与「跑绿过」混成一件事，而那正是这条账要防的。
 *
 * `--skip "<理由>"` 是**另一条出路**，不是绕过：它写的是一条有人回答过的账
 * （理由要能被复核），判据照样放行。两者都不是「什么都不做」。
 *
 * ⚠️ **不给 `--update-snapshots` 之类的落盘开关**：本档只跑功能链路，不改任何基线。
 * 像素基线的落盘是 `pnpm check:visual:update` 的事（那里有「连跑两次都绿」的验收）。
 *
 * 用法：
 *   node scripts/e2e-run.mjs --dry-run        只打印本次会起什么（无副作用）
 *   node scripts/e2e-run.mjs                  跑一次全量 e2e（绿即记账）
 *   node scripts/e2e-run.mjs --grep @critical 只跑关键流程那一档（同样记账）
 *   node scripts/e2e-run.mjs --skip "原因"    不跑，记一条写明理由的豁免账
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  E2E_COMMAND,
  E2E_LEDGER,
  E2E_TIER,
  isUsableSkipReason,
  readE2eLedger,
  recordRun,
  recordSkip,
} from "./e2e-freshness-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 全量 e2e 的 spec 目录（与 `playwright.config.ts` 的 `testDir`、`pnpm test:e2e` 同一处落点）。 */
export const E2E_DIR = "e2e";

/**
 * 解析 Playwright 的 CLI 入口。
 *
 * 不写死 `node_modules/@playwright/test/cli.js`：pnpm 布局下顶层那个是链接。
 * 也**不** `spawn` 裸 `pnpm exec playwright` —— Windows 上那经 `.cmd` shim，只有
 * cmd.exe 解释批处理，Node 直接起会 `EINVAL`（规范 §2.1.1 判定过的形态，
 * 与 `pixel-run.mjs` 的 `resolvePlaywrightCli` 同一口径；两份不合并是因为
 * 合并要先造一个「Playwright 入口解析器」模块，而它只有这两个消费方）。
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
 * 本次要跑的调用（**纯函数**：判据核的是「跑哪一步」，不是「命令行长得像什么」。
 * 同 `pixel-run.mjs` 的 `planRuns`）。
 *
 * 全量档只跑一次 Playwright，**不留落盘开关**（见文件头）。
 *
 * @param {{grep?: string | null}} [opts]
 * @returns {Array<{label: string, kind: "playwright", args: string[]}>}
 */
export function planRuns({ grep = null } = {}) {
  const args = ["test"];
  if (grep) args.push("--grep", grep);
  return [
    {
      label: grep ? `e2e（--grep ${grep}）` : "e2e（全量）",
      kind: "playwright",
      args,
    },
  ];
}

/**
 * 红要怎么读 —— 与像素档同一处纪律（§11.13 那条「红先定性再改代码」）。
 *
 * 四条实测形态各占一档，混成一句「e2e 红了」会把人引去改业务代码：
 *   · webServer 起不来 / 缺生产构建：**与用例无关**，是环境口径（CI 上走 `pnpm start`）；
 *   · 缺本平台基线的视觉用例：那是像素档的事，动作是 `pnpm check:visual`，不是改业务代码；
 *   · 超时：先按 §11.13 隔离重跑定性（并发争用与真回归长得一样）；
 *   · 断言差异：这才是功能退化。
 *
 * @param {string} output 合并后的 stdout + stderr
 * @returns {string}
 */
export function classifyFailure(output) {
  if (/A snapshot doesn't exist at/.test(output)) {
    return "缺本平台像素基线（不是功能退化）—— 动作是 `pnpm check:visual`（像素档那一路），别改业务代码";
  }
  if (
    /webServer was not able to start|Could not find a production build/.test(
      output,
    )
  ) {
    return (
      "webServer 没起来（与用例无关）—— CI 口径下它走 `pnpm start`、要求先有生产构建：" +
      "先 `pnpm build`，或确认这次确实要按 CI 口径跑"
    );
  }
  if (/Test timeout of \d+ms exceeded|Timeout \d+ms exceeded/.test(output)) {
    return "超时 —— 先按 §11.13 隔离重跑定性（`pnpm exec playwright test <文件> --workers=1`），真回归再改代码";
  }
  if (/^\s*\d+ failed/m.test(output) || /\bexpect\(.*\)\.to/.test(output)) {
    return "断言差异（这才是功能退化）—— 看失败用例名与它对应的用户可见行为";
  }
  return "读不到可归因的形态 —— 先按 §11.13 隔离重跑定性，别直接改业务代码";
}

/**
 * 记账用的「谁」。取不到 git user.name 时退回一个**说得出自己是兜底**的值，
 * 不静默落空（空 `who` 会被 freshnessRecord 的校验判成「没写清」）。
 *
 * @returns {string}
 */
export function currentWho() {
  const fromEnv = process.env.GIT_AUTHOR_NAME;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const out = spawnSync("git", ["config", "user.name"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const name = (out.stdout ?? "").trim();
  return name || "(未取到 git user.name)";
}

/** 子进程环境：**CI 没设就不要给它设**（与 `pixel-run.mjs` 同一条实测 —— 空串 ≠ 未设置）。 */
function childEnv() {
  const env = { ...process.env };
  if (!env.CI) delete env.CI;
  return env;
}

/**
 * @param {string[]} argv
 * @returns {number} 退出码
 */
function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const si = argv.indexOf("--skip");
  const skipReason = si >= 0 ? (argv[si + 1] ?? "") : null;
  const gi = argv.indexOf("--grep");
  const grep = gi >= 0 ? (argv[gi + 1] ?? null) : null;

  if (skipReason !== null) {
    if (!isUsableSkipReason(skipReason)) {
      process.stderr.write(
        `[e2e-run] ✗ --skip 的理由太短或明显是占位（"${skipReason.trim()}"）—— ` +
          "写一句能复核的话（「本次只改文档」「已在本机跑过、见 <链接>」这种）。\n" +
          "        这条账的意义是「有人回答过」，不是「把判据绕过去」。\n",
      );
      return 2;
    }
    if (dryRun) {
      process.stdout.write(
        `[e2e-run] 会记一条「本次跳过」：${skipReason.trim()}\n`,
      );
      return 0;
    }
    const res = recordSkip({ who: currentWho(), reason: skipReason });
    if (!res.ok) {
      process.stderr.write(`[e2e-run] ✗ ${res.note}\n`);
      return 2;
    }
    process.stdout.write(`[e2e-run] ${res.note}\n`);
    return 0;
  }

  const runs = planRuns({ grep });
  if (dryRun) {
    for (const step of runs) {
      process.stdout.write(
        `[e2e-run] ${step.label} → playwright ${step.args.join(" ")}\n`,
      );
    }
    const ledger = readE2eLedger();
    process.stdout.write(
      `[e2e-run] 凭证：${E2E_LEDGER} 当前 ${ledger[E2E_TIER] ? "有" : "没有"} ${E2E_TIER} 档记录` +
        '（跑绿即记；`--skip "原因"` 记一条写明理由的豁免）\n',
    );
    process.stdout.write(
      process.env.CI
        ? "[e2e-run] webServer：按 CI 口径 → `pnpm start`（需要先有生产构建）\n"
        : "[e2e-run] webServer：本地口径 → `pnpm dev`（无需先构建）\n",
    );
    return 0;
  }

  let failed = null;
  for (const step of runs) {
    process.stdout.write(
      `[e2e-run] ${step.label} → playwright ${step.args.join(" ")}\n`,
    );
    const res = spawnSync(
      process.execPath,
      [resolvePlaywrightCli(), ...step.args],
      {
        cwd: ROOT,
        env: childEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      },
    );
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    if (res.error || res.status !== 0) {
      failed = { step, res };
      break;
    }
  }

  if (failed === null) {
    process.stdout.write("[e2e-run] ✓ 全量 e2e 通过\n");
    /* 跑绿即记账（§11.8 的每日自证）：**红着不记** —— 「跑过」与「跑绿过」是两件事，
     * 那条账要防的正是把它们混起来。记账失败不算跑 e2e 的失败（结论已经拿到了）。 */
    const note = recordRun({
      who: currentWho(),
      how: grep ? `${E2E_COMMAND} --grep ${grep}` : E2E_COMMAND,
    });
    process.stdout.write(`[e2e-run] ${note.note}\n`);
    return 0;
  }
  process.stderr.write(
    `\n[e2e-run] ✗ ${failed.step.label} 未通过（退出码 ${failed.res.status ?? "信号"}）\n` +
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
