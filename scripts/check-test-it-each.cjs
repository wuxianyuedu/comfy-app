#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:`it.each` 存量棘轮与新增拦截(供 .githooks/pre-commit 的 D 组调用)
/**
 * 参数化用例：`it.for` ⇄ `it.each` 的新增拦截（**硬闸**）—— 规范见
 * docs/standards/11-测试与可观测性.md §11.15。
 *
 * ── 立案现场：同一件事第三次「没有执行者」 ────────────────────────────
 *
 * §11.15 的口径是「新增参数化用例一律写 `test.for`；`it.each` 属 vitest 3 时代的
 * 写法」。它**明说**存量按本节逐步收口 —— 而 `c9f349ca` 那轮确实收口完了 63 处，
 * §11.15 也就此写死一句「本仓库已全部转换完」。
 *
 * 问题出在这句话**没有任何东西在守**：
 *   · `scripts/check-*.cjs` 里没有一条认识 `it.each`（`grep -c each scripts/check-*.cjs` = 0）；
 *   · CI 随 ISSUE #623 删除；
 *   · 于是「已全部转换完」这句规范文本，是它唯一的执行者 —— 而规范文本不会自己响。
 *
 * 实测：本轮复算 `.each(` 扫 src / tests / e2e 得 **2 处**，都是那句话之后长出来的：
 *
 *   ① `tests/tw4-canonical-ratchet.test.ts:46` 的 `describe.each` ——
 *      `c9f349ca` 那轮漏掉的（它用的是 `describe.each`，而收口时只扫了 `it.each`）；
 *   ② `src/components/studio/ViewTabStrip.test.tsx:136` 的 `it.each` ——
 *      PR #1558 新写的，就在收口之后四天。
 *
 * 这与 `check-test-sleep.cjs`（20 → 38）、`check-test-waitfor.cjs`（206 → 211）
 * 是**同一种病**：口径写在规范里、数字漂在盘点里，中间没有执行者。
 * 所以本判据不判「有没有 `it.each`」这句口号，判**净数不许涨**。
 *
 * ── 它判什么、不判什么 ────────────────────────────────────────────────
 *
 * 判**硬闸**：越界站点数须为 **0**（命中即退 1，无基线、无 `--update`）。
 * 这与它**翻转前**的口径等价 —— 旧形态是棘轮（`scripts/.test-it-each-baseline.json`，
 * 基线 `total: 0`，只许降），本判据的文件头当时就写着「基线归零之后，任何一个新增的
 * `.each(` 都会被拦下」：那正是硬闸语义。存量清零后棘轮只剩一件事——
 * `--update` 是一条「手改那份 JSON 就能把新站点登记成已知存量」的通道，
 * 而硬闸类**本来没有**这个中间态（与 `check-code-duplication.cjs` 那批同口径）。
 *
 * **不判**（明写在案，别当成漏报）：
 *   · `describe.each` 与 `it.each` / `test.each` **一视同仁** —— §11.15 收口时
 *     只扫了 `it.each`、把 `describe.each` 漏在门外，那正是 ① 号站点的来历。
 *     一条口径按名字收窄就会漏，所以这里按**同一个对象身上的 `.each` 方法**认。
 *   · **字符串 / 注释 / 模板串里的 `.each(`** 由 `maskNonCode` 自然挡住
 *     （§11.14.2）。判据自测文件里的夹具字符串同理，不必逐条声明。
 *   · 判据自己的夹具不进扫描面（`FIXTURE_SKIP`），同 §11.14.2 的通用口径。
 *   · **本地同名 helper**（自己写的 `function it(...)` / `const test = ...`）不在此列：
 *     本判据只认**从 `vitest` 导入**的那几个名字（同 §11.20 那条「判据认的是 import
 *     事实、不是名字」）—— 先看 import 语句，没导入就整文件跳过。
 *
 * ── 成本 ──────────────────────────────────────────────────────────────
 *
 * 纯文本扫描 624 份用例，与 `check-test-sleep.cjs` / `check-test-waitfor.cjs` 同档
 * （各约 0.3s、零网络、零子进程）—— 照 §13.5.4 的成本判据，这个量级该进钩子。
 *
 * 用法：
 *   node scripts/check-test-it-each.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-test-it-each.cjs --report   # 只出清单不判失败（盘点用）
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const path = require("node:path");
const { maskNonCode } = require("./check-test-concurrency.cjs");
const { readForScan, walkForScan, vanishedNote } = require("./gate-scan-read.cjs");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");

/** 扫描范围：与 `vitest.config.ts` 的 `include` 同口径。 */
const SCAN_DIRS = ["src", "tests", "e2e"];
const TEST_FILE_RE = /\.test\.tsx?$/;

/**
 * 判据自己的夹具**不进扫描面**：它是喂给本判据的被测字符串，判它等于判自己的量具
 * （§11.14.2 的通用口径）。
 */
const FIXTURE_SKIP = new Set(["tests/test-it-each-gate.test.ts"]);

/**
 * 参数化用例的宿主名字。**三个一视同仁**：`c9f349ca` 那轮只收 `it.each`，
 * 把 `describe.each` 漏在门外（① 号站点的来历）—— 按名字收窄就会漏。
 */
const HOSTS = ["it", "test", "describe"];

/** 站点：宿主对象上的 `.each(` 方法调用。 */
const SITE_RE = new RegExp(`(?<![\\w.$])(${HOSTS.join("|")})\\s*\\.\\s*each\\s*\\(`, "g");

/**
 * 枚举扫描面。两种消失窗口与「只降级 ENOENT」的口径在 `gate-scan-read.cjs`
 * （这里曾经是自己的 `try { readdirSync } catch { return out }`，那一份把**所有**
 * 错误都吞掉 —— 读不到扫描面也算绿）。
 */
function walk(dir) {
  return walkForScan(dir, TEST_FILE_RE);
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (src[i] === "\n") {
      line++;
    }
  }
  return line;
}

/**
 * 这个文件里的宿主名字是不是从 `vitest` 导入的？不是就整文件跳过 ——
 * 本地同名 helper（自己写的 `it` / `test` / `describe`）不在本判据的靶子里。
 *
 * ⚠️ 判的是**原文**不是 `maskNonCode` 之后的串：来源路径是字符串字面量，
 * mask 之后 `from "vitest"` 会变成 `from` + 一串空格，于是每一份用例都「没导入」、
 * 判据静默返回 0 处 —— 形同不在跑（同 `check-test-waitfor.cjs` 踩过的那个坑）。
 */
function importsVitestHosts(raw) {
  for (const m of raw.matchAll(/import\s*\{[^}]*\}\s*from\s*["'][^"']+["']/g)) {
    if (!/from\s*["']vitest["']/.test(m[0])) {
      continue;
    }
    const names = m[0].match(/\{([^}]*)\}/)[1];
    for (const host of HOSTS) {
      if (new RegExp(`(?<![\\w$])${host}\\s*(?:,|$)`).test(names)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 扫一个文件，返回它命中的站点；文件在「列目录 → 读内容」之间消失时返回 `null`。
 * @returns {{line:number,text:string}[]|null}
 */
function scanFile(abs) {
  /* 消失 → `null` = 这一轮没读到，计数进结论行。现场（`tests/global-setup-cleanup.test.ts`
   * 造的 `.setup-cleanup-probe-*.test.tsx`）、两种消失窗口、「只降级 ENOENT」与
   * 「不许静默」（静默等于让判据在它其实没读过的目录上假装绿 —— §13.5.12 那一族
   * 「判据自称在跑、实际没有」的入口）都在 `gate-scan-read.cjs` 那一份里。 */
  const raw = readForScan(abs);
  if (raw === null) {
    return null;
  }
  if (!importsVitestHosts(raw)) {
    return [];
  }
  const masked = maskNonCode(raw);
  const rawLines = raw.split("\n");
  const sites = [];
  for (const m of masked.matchAll(SITE_RE)) {
    const line = lineOf(masked, m.index);
    sites.push({
      line,
      text: (rawLines[line - 1] ?? "").trim().replaceAll(/\s+/g, " ").slice(0, 110),
    });
  }
  return sites;
}

function collect() {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const sites = new Map();
  let vanished = 0;
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (FIXTURE_SKIP.has(rel)) {
      continue;
    }
    const hit = scanFile(abs);
    if (hit === null) {
      vanished += 1;
      continue;
    }
    if (hit.length) {
      sites.set(rel, hit);
    }
  }
  return { sites, vanished };
}

function main() {
  const { sites, vanished } = collect();
  const total = [...sites.values()].reduce((n, v) => n + v.length, 0);

  if (REPORT_ONLY) {
    console.log(
      `[test-it-each] 盘点：${total} 处 / ${sites.size} 份文件。` + vanishedNote(vanished),
    );
    for (const [rel, list] of [...sites.entries()].sort()) {
      console.log(`  · ${rel}: ${list.length} 处（第 ${list.map((s) => s.line).join(",")} 行）`);
    }
    return 0;
  }

  if (total > 0) {
    console.error(
      `[ERROR] 测试层还有 ${total} 处 \`it.each\`（规范 §11.15）：\n` +
        "\n  §11.15：参数化用例一律写 **`test.for`**（`describe` 组用 `describe.for`）。" +
        "\n  参数化数据一行是**一个参数**，元组由回调自己解构 —— 没有 `it.each` 的隐式摊开；" +
        "\n  并且**记得加 `as const`**，否则解构出的每一项都带 `undefined`（`tsc` 会报）。" +
        "\n" +
        "\n  // ❌ 旧写法：元素被隐式摊开成多个参数" +
        "\n  it.each([[a, b]])('%s %s', (a, b) => {});" +
        "\n  // ✅ 新写法：一行原样进、回调自己解构" +
        "\n  it.for([[a, b]] as const)('%s %s', ([a, b]) => {});" +
        "\n" +
        "\n  本判据是硬闸（无基线、无 --update）：存量已清零，新增一处即阻断。" +
        "\n" +
        "\n  下方是本轮站点：",
    );
    for (const [rel, list] of [...sites.entries()].sort()) {
      console.error(
        `  · ${rel}: ${list.length} 处\n` +
          list
            .slice(0, 8)
            .map((s) => `      ${s.line}: ${s.text}`)
            .join("\n"),
      );
    }
    console.error("\n口径见 docs/standards/11-测试与可观测性.md §11.15。");
    return 1;
  }

  console.log("[test-it-each] OK —— 无 `it.each` 站点" + vanishedNote(vanished));
  return 0;
}

/* 自测（`tests/test-it-each-gate.test.ts`）钉的是**站点识别口径**。 */
module.exports = { scanFile, importsVitestHosts, collect, FIXTURE_SKIP, HOSTS };

if (require.main === module) {
  process.exit(main());
}
