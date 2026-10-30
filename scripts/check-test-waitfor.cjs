#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:测试层 waitFor / expect.poll 的边界(供 .githooks/pre-commit 的 D 组调用)
/**
 * 测试层「等异步落定」的写法边界 —— 规范见
 * docs/standards/11-测试与可观测性.md §11.14.3。
 *
 * ── 为什么要一条判据 ──────────────────────────────────────────────────
 *
 * §11.14 的口径是「等一个条件变成真一律写 `expect.poll`」。这条口径此前只管住了
 * 裸 sleep（`check-test-sleep.cjs`），而**更大量的那一半没人在数**：全仓
 * `await waitFor(...)`（`@testing-library/react` 那个）实测 **211 处 / 30 份文件**，
 * 且没有一条判据认识它 —— 同一件事在两次盘点里从 206 变成 211，又一次是
 * 「没有执行者」的形态（同 `check-test-sleep.cjs` 的立案现场）。
 *
 * 但 `waitFor` **不是** 裸 sleep：它是官方推荐写法，且有两处 `expect.poll`
 * 替代不了的能力。所以本判据**不判「有没有 waitFor」**，判的是**边界**：
 * 每一处 `await waitFor(...)` 必须落在下面两种**可机器判定的正当形态**之一 ——
 *
 *   ① **等的是 DOM 出现 / 消失**（回调里用了 jest-dom 匹配器）——
 *      `expect.poll` 与 jest-dom 的匹配器**类型上不匹配**（它们声明返回 void，
 *      `@typescript-eslint/await-thenable` 当场报红），而 `waitFor` 的签名就是为
 *      「等 DOM 变到某个状态」定的。这一档**只能**用 `waitFor`。
 *   ② **落在假定时器窗口内**（`vi.useFakeTimers()` … `vi.useRealTimers()` 之间）——
 *      `waitFor` 会在每轮重试里自动 `advanceTimersByTime`，`expect.poll` 不会
 *      （§11.14 末尾明写的合法例外）。这一档**只能**用 `waitFor`。
 *
 * 其余一切 `await waitFor` 都该是 `expect.poll`：等的是**某个值**（hook 的
 * `result.current.*` / mock 的调用次数与参数 / 数据收敛）。
 *
 * ── 它判什么、不判什么 ────────────────────────────────────────────────
 *
 * **形态判据**：逐站点判「回调里有没有 jest-dom 匹配器」与「在不在假定时器窗口内」，
 * 两者都不满足即报红。这两件事在文本上完全可判（匹配器是固定名单；假定时器是
 * 成对标记之间），不会误报一片 —— 会误报的判据活不过一次评审（§11.18.4）。
 *
 * **不判**（明写在案，别当成漏报）：
 *   · `vi.waitFor(...)` —— 它不受本判据管（§11.14 那张表已说明它与 `expect.poll`
 *     在报错上同档，差别只在预算来源）；存量已清零，新增由 review 管。
 *   · **本地同名 helper**（`async function waitFor(pred, msg)`）—— 它不是 RTL 那个，
 *     本判据只认**从 `@testing-library/react` 导入**的 `waitFor`：先看 import 语句，
 *     没导入就整文件跳过（同 §11.20 那条「判据认的是 import 事实、不是名字」）。
 *   · 判据自己的夹具不进扫描面（`FIXTURE_SKIP`），同 `check-test-sleep.cjs` 的
 *     §11.14.2 口径。
 *
 * ── 成本 ──────────────────────────────────────────────────────────────
 *
 * 纯文本扫描 624 份用例，实测约 0.3s（零网络、零子进程）—— 照 §13.5.4 的成本判据，
 * 这个量级该进钩子而不是登记「按需召唤」。
 *
 * 用法：
 *   node scripts/check-test-waitfor.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-test-waitfor.cjs --report   # 只出清单不判失败（盘点用）
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
const SCAN_DIRS = ["src", "tests"];
const TEST_FILE_RE = /\.test\.tsx?$/;

/**
 * 判据自己的夹具**不进扫描面**：它是喂给本判据的被测字符串，判它等于判自己的量具
 * （§11.14.2 的通用口径）。
 */
const FIXTURE_SKIP = new Set(["tests/test-waitfor-gate.test.ts"]);

/**
 * jest-dom 匹配器名单 —— 命中任一即算「等的是 DOM」。
 *
 * ⚠️ 名单要**跟着 jest-dom 的导出长**：漏一个的失泄形态是「那一处被判红、
 * 而它其实正当」（假阳性），比漏报更烦人但可发现；反过来（把普通匹配器也列进来）
 * 会让判据对真站点失明，那才是坏的。所以只列 DOM 专属匹配器，
 * **不列** `toBe` / `toEqual` / `toHaveBeenCalled` 这些值匹配器。
 */
const DOM_MATCHERS = [
  "toBeInTheDocument",
  "toBeVisible",
  "toBeEmptyDOMElement",
  "toBeDisabled",
  "toBeEnabled",
  "toBeRequired",
  "toBeInvalid",
  "toBeValid",
  "toHaveTextContent",
  "toHaveAttribute",
  "toHaveClass",
  "toHaveStyle",
  "toHaveFocus",
  "toHaveFormValues",
  "toHaveAccessibleName",
  "toHaveAccessibleDescription",
  "toHaveDisplayValue",
  "toHaveValue",
  "toBeChecked",
  "toBePartiallyChecked",
  "toContainElement",
  "toContainHTML",
  "toHaveRole",
  "toHaveErrorMessage",
];

/** RTL 的 `waitFor` —— 判据只认这个来源，不认同名本地 helper。 */
const RTL_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*["']@testing-library\/react["']/;

/** `await waitFor(` 的站点。 */
const SITE_RE = /(?<![\w.$])await\s+waitFor\s*\(/g;

/** 假定时器窗口开 / 关的标记。 */
const FAKE_ON_RE = /vi\.useFakeTimers\s*\(/;
const FAKE_OFF_RE = /vi\.useRealTimers\s*\(/;

/** 站点回调的搜索窗口上限。 */
const WINDOW_MAX = 600;

/**
 * 枚举扫描面。两种消失窗口、「只降级 ENOENT」与「不许静默」都在 `gate-scan-read.cjs`
 * （这里曾经是自己的 `try { readdirSync } catch { return out }` —— 那一份把**所有**
 * 错误都吞掉，等于「读不到扫描面」也能绿；收进一处之后只有 `ENOENT` 降级）。
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
 * 这个文件里的 `waitFor` 是不是从 `@testing-library/react` 导入的？
 * 不是的话整文件跳过 —— 本地同名 helper 不在本判据的靶子里。
 *
 * ⚠️ 判的是**原文**不是 `maskNonCode` 之后的串：来源路径是字符串字面量，
 * mask 之后 `from "@testing-library/react"` 会变成 `from` + 一串空格，
 * 于是每一份用例都「没导入」，判据静默返回 0 处 —— 形同不在跑。
 * （这条是写完当场用 `--report` 数出来的：越界 0 / 正当 0，全仓一起消失。）
 */
function importsRtlWaitFor(raw) {
  for (const m of raw.matchAll(/import\s*\{[^}]*\}\s*from\s*["'][^"']+["']/g)) {
    if (!RTL_IMPORT_RE.test(m[0])) {
      continue;
    }
    const names = m[0].match(/\{([^}]*)\}/)[1];
    if (/(?<![\w$])waitFor\s*(?:,|$)/.test(names)) {
      return true;
    }
  }
  return false;
}

/**
 * 扫一个文件，返回它命中的站点；文件在「列目录 → 读内容」之间消失时返回 `null`。
 * @returns {{line:number,text:string,legit:string|null,dom:boolean,fake:boolean}[]|null}
 */
function scanFile(abs) {
  /* 消失时 `null` = 这一轮没读到；口径与两种窗口在 `gate-scan-read.cjs`。 */
  const raw = readForScan(abs);
  if (raw === null) {
    return null;
  }
  const masked = maskNonCode(raw);

  if (!importsRtlWaitFor(raw)) {
    return [];
  }

  /* 假定时器窗口：逐行扫标记，给每行一个「在不在窗口内」的布尔。 */
  const lines = masked.split("\n");
  const fakeLines = new Set();
  let inFake = false;
  lines.forEach((l, i) => {
    if (FAKE_OFF_RE.test(l)) {
      inFake = false;
    }
    if (inFake) {
      fakeLines.add(i + 1);
    }
    if (FAKE_ON_RE.test(l)) {
      inFake = true;
    }
  });

  const sites = [];
  for (const m of masked.matchAll(SITE_RE)) {
    const start = m.index;
    const window = masked.slice(start, start + WINDOW_MAX);
    const dom = DOM_MATCHERS.some((name) => new RegExp(`\\.${name}\\s*\\(`).test(window));
    const line = lineOf(masked, start);
    const fake = fakeLines.has(line);
    const rawLine = raw.split("\n")[line - 1] ?? "";
    sites.push({
      line,
      text: rawLine.trim().replace(/\s+/g, " ").slice(0, 110),
      legit: dom ? "dom" : fake ? "fake-timer" : null,
      dom,
      fake,
    });
  }
  return sites;
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  /** 违规站点（既不等 DOM、也不在假定时器窗口内）。 */
  const violations = new Map();
  /** 正当形态的站点（只记账）。 */
  const legit = { dom: 0, "fake-timer": 0 };
  /** 「列到名字、读时已没」的份数（并发用例的临时探针），必须出现在结论里。 */
  let vanished = 0;

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (FIXTURE_SKIP.has(rel)) {
      continue;
    }
    const sites = scanFile(abs);
    if (sites === null) {
      vanished += 1;
      continue;
    }
    const bad = [];
    for (const s of sites) {
      if (s.legit) {
        legit[s.legit]++;
      } else {
        bad.push(s);
      }
    }
    if (bad.length) {
      violations.set(rel, bad);
    }
  }

  const total = [...violations.values()].reduce((n, v) => n + v.length, 0);
  const legitTotal = legit.dom + legit["fake-timer"];

  if (REPORT_ONLY) {
    console.log(
      `[test-waitfor] 盘点：越界 ${total} 处 / 正当 ${
        legitTotal
      } 处（等 DOM ${legit.dom} + 假定时器窗口 ${legit["fake-timer"]}）。`,
    );
    for (const [rel, sites] of [...violations.entries()].sort()) {
      console.log(`  · ${rel}: ${sites.length} 处（第 ${sites.map((s) => s.line).join(",")} 行）`);
    }
    return 0;
  }

  if (total > 0) {
    console.error(
      `[ERROR] 测试层的 \`await waitFor(...)\` 越界：${total} 处。\n` +
        "\n  §11.14 的口径是「等一个条件变成真一律写 `expect.poll`」。" +
        "\n  `await waitFor(() => expect(<某个值>)…)` 该写成" +
        "\n  `await expect.poll(() => <某个值>)…`（预算在 vitest.config.ts 一处）。" +
        "\n" +
        "\n  只有两种形态该留 `waitFor`（判据会自己认出来，不必声明）：" +
        "\n    · 等的是 **DOM 出现 / 消失**（回调里用 jest-dom 匹配器，如" +
        "\n      `toBeInTheDocument`）—— `expect.poll` 与 jest-dom 的类型不兼容；" +
        "\n    · 站点落在 **假定时器窗口内**（`vi.useFakeTimers()` 与" +
        "\n      `vi.useRealTimers()` 之间）—— 只有 `waitFor` 会每轮自动推进假定时器。" +
        "\n" +
        "\n  下方是越界站点，逐处改判：",
    );
    for (const [rel, sites] of [...violations.entries()].sort()) {
      console.error(
        `  · ${rel}: ${sites.length} 处\n` +
          sites
            .slice(0, 8)
            .map((s) => `      ${s.line}: ${s.text}`)
            .join("\n") +
          (sites.length > 8 ? `\n      …另有 ${sites.length - 8} 处` : ""),
      );
    }
    console.error(
      "\n口径见 docs/standards/11-测试与可观测性.md §11.14.3。" + vanishedNote(vanished),
    );
    return 1;
  }

  console.log(
    `[test-waitfor] OK —— 越界 0 处 / 正当 ${legitTotal} 处` +
      `（等 DOM ${legit.dom} + 假定时器窗口 ${legit["fake-timer"]}）。` +
      /* 消失数必须进结论：它等于「这几份文件这一轮没被读过」。静默让判据在没读过的
         目录上绿，是 §13.5.12 那一族「自称在跑、实际没跑」的入口。 */
      vanishedNote(vanished),
  );
  return 0;
}

/* 自测（`tests/test-waitfor-gate.test.ts`）钉的是**站点识别口径**。 */
module.exports = { scanFile, importsRtlWaitFor, DOM_MATCHERS, FIXTURE_SKIP };

if (require.main === module) {
  process.exit(main());
}
