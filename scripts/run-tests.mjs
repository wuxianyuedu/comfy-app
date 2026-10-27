#!/usr/bin/env node
/**
 * run-tests.mjs — 只跑测试的跨平台入口（`pnpm test` / `pnpm test:file ...`）
 *
 * 与 `scripts/run-tests.ps1` 同一套语义（规范 11.12）：
 *   · 默认排除**已知基线失败**文件（清单唯一来源 `quality-gate-shared.mjs`），
 *     保证单跑时的红/绿能直接归因到本次改动；
 *   · `--full` 反其道而行，保留这些文件，用来复现基线失败；
 *   · 位置参数与 `--` 之后的参数原样透传给 vitest（`-t` / `--reporter` / 具体文件）；
 *   · 显式指定了文件时**不再追加排除项** —— 「我明明指定了它却不跑」比排除本身更难理解。
 *
 * 为什么要有跨平台版本：`tools/start/run-tests.ps1` 是 Windows 双击入口，Linux / macOS
 * 上此前只有「自己拼 `pnpm exec vitest run`」这一条路 —— 那份口令写在文档里就必然
 * 有人漏抄 `--exclude`，于是同一套用例在两个平台上给出不同的红/绿。
 *
 * 源码保持纯 ASCII：本文件会被 Next 的构建期模块图/NFT 相关的 code frame 路径间接
 * 触及（见 AGENTS 硬规则 15 与规范 §5），这类模块里混入多字节字符会让 Rust 侧按字节
 * 切串时 panic。中文只出现在 `.ps1` 入口与文档里。
 *
 * 用法：
 * 用法示例：node scripts/run-tests.mjs
 *   node scripts/run-tests.mjs --full（全量）
 *   node scripts/run-tests.mjs src/lib/media.test.ts（指定文件）
 *   node scripts/run-tests.mjs -- 后面跟 vitest 参数
 */
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { formatCommandLine } from "./launcher-core/command-echo.mjs";
import { runPnpmSync } from "./launcher-core/shell.mjs";
import { KNOWN_FAILED_FILES } from "./quality-gate-shared.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** @param {string[]} argv */
function parseArgs(argv) {
  let full = false;
  const passthrough = [];
  for (const a of argv) {
    if (a === "--full" || a === "-Full") full = true;
    else passthrough.push(a);
  }
  return { full, passthrough: passthrough.filter((a) => a !== "--") };
}

/**
 * 透传参数里有没有名称过滤（`-t <pat>` / `-t=<pat>` / `--testNamePattern[=<pat>]`）。
 *
 * vitest 对「一条都没命中」照退 0 —— 与真绿在退出码上逐字同形（ISSUE #2400）。
 * 所以带过滤的一跑要配一份 junit，把「执行了 N 条全过」与「根本没命中」分开。
 *
 * @param {string[]} args
 * @returns {boolean}
 */
export function hasNameFilter(args) {
  for (const a of args) {
    if (a === "-t" || a === "--testNamePattern") return true;
    if (a.startsWith("-t=") || a.startsWith("--testNamePattern=")) return true;
  }
  return false;
}

/**
 * junit 里的「执行了几条」= Σ tests − Σ skipped。带名称过滤时，未命中的用例被
 * vitest 记成 skipped（实测形状：`tests="9" skipped="9"` 而退出码 0），所以
 * 0 命中读作 0。suite 节点都不在 ⇒ null —— 解析失败不许冒充 0。
 *
 * @param {string} xml
 * @returns {number | null}
 */
export function junitExecutedCount(xml) {
  let tests = 0;
  let skipped = 0;
  let saw = false;
  for (const m of String(xml ?? "").matchAll(/<testsuite\b[^>]*>/g)) {
    const tag = m[0];
    const t = /tests="(\d+)"/.exec(tag);
    if (!t) continue;
    saw = true;
    const s = /skipped="(\d+)"/.exec(tag);
    tests += Number(t[1]);
    skipped += s ? Number(s[1]) : 0;
  }
  return saw ? tests - skipped : null;
}

function main() {
  const { full, passthrough } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(path.join(ROOT, "node_modules", ".bin"))) {
    console.error("[ERROR] 未检测到 node_modules/.bin，说明依赖还没装。");
    console.log("        [INFO] 请先在项目根目录执行：pnpm install");
    return 1;
  }
  const args = ["exec", "vitest", "run"];
  /* 「-t 零命中也退 0」（ISSUE #2400）：这一跑配一份 junit（default reporter 保住
   * 实时终端输出），跑完回读才知道是「0 条命中」还是真绿。调用方自带
   * reporter / outputFile 时不改写 —— 那是人家点名要的形态，改了就是另一件事。 */
  const filterUsed = hasNameFilter(passthrough);
  const ownReporter =
    passthrough.some((a) => a.startsWith("--reporter")) ||
    passthrough.some((a) => a.startsWith("--outputFile"));
  const junitPath = path.join(tmpdir(), `comfy-run-tests-${process.pid}.xml`);
  if (filterUsed && !ownReporter) {
    args.push(
      "--reporter=default",
      "--reporter=junit",
      `--outputFile.junit=${junitPath}`,
    );
  }
  if (passthrough.length > 0) {
    console.log(
      `[INFO] 透传参数：${passthrough.join(" ")}（指定了文件的这一次不再追加已知基线失败排除项）`,
    );
    args.push(...passthrough);
  } else if (full) {
    if (KNOWN_FAILED_FILES.length > 0) {
      console.log(
        `[INFO] 全量模式：已知基线失败文件一并运行（${KNOWN_FAILED_FILES.join(" / ")}）。`,
      );
    }
  } else if (KNOWN_FAILED_FILES.length > 0) {
    console.log(
      `[INFO] 排除已知基线失败文件：${KNOWN_FAILED_FILES.join(" / ")}`,
    );
    for (const f of KNOWN_FAILED_FILES) args.push("--exclude", f);
  }

  console.log("");
  // 命令行由 `runPnpmSync()` 的回显出口打印（`>>> …`）——这里不再手写一份：
  // 手写的那份只能猜「pnpm」这个字面名，而 Windows 上真正被执行的是形态判据
  // 选出来的那条（可能是经 PowerShell 宿主的 `.ps1`）。判据与回显都只在 shell.mjs
  // 一处（规范 §2.1.1 / §9.5）：这里曾拿 `whichCommand("pnpm")` 的裸路径直接 spawn ——
  // Windows 上它可能是 Node 起不来的 `.cmd`（只有 cmd.exe 解释批处理），而能跑的是
  // 同目录经 PowerShell 宿主的 `.ps1`（ISSUE #638）。
  const result = runPnpmSync(args, {
    cwd: ROOT,
    stdio: "inherit",
    timeoutMs: 3_600_000,
  });
  if (result.error) {
    console.error(
      `[ERROR] 起 pnpm 失败（${result.error.code ?? "UNKNOWN"}）：${result.error.message}`,
    );
    console.log(
      `        [INFO] 实际命令：${formatCommandLine(result.command, result.args)}`,
    );
    console.log("        [INFO] 自查：pnpm check:toolchain");
    return 1;
  }
  const code = result.status ?? 1;
  console.log("");
  if (code === 0) {
    /* 带过滤的一跑：说「绿」之前先回读配对的 junit ——
     * 不然「0 条命中」与「全过」在终端里逐字同形。 */
    if (filterUsed && !ownReporter) {
      let xml = null;
      try {
        xml = fs.readFileSync(junitPath, "utf8");
      } catch {
        xml = null;
      }
      try {
        fs.rmSync(junitPath, { force: true });
      } catch {
        /* 尽力清理；上面那一步读到了就够用，删不掉不值得拦路。 */
      }
      const executed = xml === null ? null : junitExecutedCount(xml);
      if (executed === 0) {
        console.error(
          "[ERROR] 用例过滤（-t / --testNamePattern）一条都没命中 —— vitest 对此退 0，" +
            "那不是「跑过且绿」。这一跑不构成校验（exit 2，与「未校验」同口径）。",
        );
        console.log(
          "        [INFO] 核对过滤词，或去掉 -t 重跑：pnpm test:file <文件>",
        );
        return 2;
      }
      if (executed !== null) {
        console.log(`[OK] vitest 通过（执行 ${executed} 条，带名称过滤）。`);
        return 0;
      }
      /* junit 读不到（reporter 没写出 / 解析失败）：如实按「没读到读数」收，
       * 退出码保持 vitest 的原值 —— 不把「没读到」圆成「已核对」。 */
    }
    console.log("[OK] vitest 全部通过。");
  } else console.error(`[ERROR] vitest 存在未通过的用例（exit ${code}）。`);
  return code;
}

/* 只在被直接执行时跑 main。被 import 时（测试要读上面的纯函数）不得再起
 * 一轮嵌套的 vitest —— 此前没有这道守卫，import 它会在导入方 worker 里
 * process.exit(main())：本单开发时真撞上（那两轮"全量套件"就是嵌套跑的输出）。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
