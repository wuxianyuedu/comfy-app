#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:门禁自测的手搓临时仓库样板(供 .githooks/pre-commit 的 D 组调用)
/**
 * 门禁自测里「手搓临时仓库样板」的净数 —— 规范见
 * docs/standards/11-测试与可观测性.md §11.16.1。
 *
 * ── 为什么要一条判据 ──────────────────────────────────────────────────
 *
 * 本仓库 60 余份 `tests/check-*.test.ts` / `tests/*-gate.test.ts` 判的是**同一件事**：
 * 把 `scripts/` 下的判据脚本当黑盒，在一个只放了被测文件的临时仓库里跑一次，
 * 看它拦不拦。此前每一份都手抄一遍同样的四件套 —— `mkdtempSync`（临时仓库）
 * + `let workdir` + 自己写的 `run(args)`（`execFileSync` 拉子进程、catch 里把
 * `{status, stdout, stderr}` 归一成 `{code, output}`）+ `afterEach` 里 `rmSync`。
 *
 * `tests/helpers/gate-repo.ts` 把这四件套收成一处（`defineGateRepo` 返回一个带
 * `repo` fixture 的 `test`）。**但收口本身没有判据** —— 于是下一个人再写一份
 * 门禁自测时，模板就在隔壁文件里、抄一遍照样全绿，而这份样板抄错的形态是**静默的**：
 * 少写 `cwd`、`status` 当 `1` 兜底、忘了 `stdio: pipe`（子进程 stderr 直接漏进
 * vitest 输出）。这正是 §11.23「声明写得出来不算数，读的人在跑才算」的同族：
 * **共享件写出来了，但没有东西在读它。**
 *
 * ── 它判什么、不判什么 ────────────────────────────────────────────────
 *
 * **形态判据 + 棘轮**：判「手搓了临时仓库、又用它去拉仓库脚本」这个**具体形状**，
 * 而不是「这段代码该不该抽共用」（后者是收益判断，静态判会误报一片 —— §12.18 明写
 * 别再为它新写启发式扫描器）。判定三个条件同时成立：
 *
 *   ① 文件里出现 `tmpdir()`（造临时工作区）；
 *   ② 文件里出现 `execFileSync(` 且其后的窗口里出现 `join(workdir`（**从那个工作区拉
 *      仓库脚本**）—— 这条认的是「工作区变量名恰好叫 workdir」这一写法。名字变了它
 *      就漏，这是**已知边界**，明写在案：本判据不是完备的，它钉的是**模板的抄写形态**，
 *      模板里那个变量就叫 `workdir`（十六份实测全一致）；
 *   ③ 文件**没有** import 共享夹具（`helpers/gate-repo`）。
 *
 * 三条同时成立才判红 —— 只有 ①（造临时目录）是极常见的正当写法（`test-db`、
 * `symlink-dir`、产物探针……），不吃这一刀。
 *
 * ── 为什么是棘轮 ──────────────────────────────────────────────────────
 *
 * 本批收口时留了三份没迁（`check-file-structure` 1758 行 / 90 条用例、大量直接
 * `writeFileSync` 造 Buffers；`check-reformat-only` 要 git init + 软链 node_modules +
 * 工作区之外的探针配置；`gate-executors` 是把**全部**判据脚本整目录拷过去，
 * 与「单脚本」模型不同形）。它们是**存量**、有明确归属，进
 * `scripts/.gate-repo-boilerplate-baseline.json`（棘轮，只许降）。
 *
 * ⚠️ **不许把新写的门禁自测登记进基线**：基线的语义是「待迁的存量」，
 * 不是「本批不迁的赦免」。新写的就该用 `defineGateRepo`（`--update` 只用于
 * 迁完一份之后把数字降下来）。
 *
 * ── 成本 ──────────────────────────────────────────────────────────────
 *
 * 纯文本扫描 600+ 份用例，实测 < 0.3s（零网络、零子进程）—— 照 §13.5.4 的成本判据，
 * 这个量级该进钩子而不是按需召唤。
 *
 * 用法：
 *   node scripts/check-gate-repo-boilerplate.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-gate-repo-boilerplate.cjs --report   # 只出清单不判失败（盘点用）
 *   node scripts/check-gate-repo-boilerplate.cjs --update   # 迁完一份后收紧基线
 *   node scripts/check-gate-repo-boilerplate.cjs --update --allow-new   # 只给维护者改口径用
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(__dirname, ".gate-repo-boilerplate-baseline.json");
const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const REPORT_ONLY = ARGS.has("--report");
const ALLOW_NEW = ARGS.has("--allow-new");

/** 扫描范围：与 `vitest.config.ts` 的 `include` 同口径（用例面）。 */
const TEST_FILE_RE = /\.test\.tsx?$/;

/**
 * 判据自己的自测文件**不进扫描面**：它要写「手搓样板」的夹具字符串与真代码两种形态
 * 才能钉住本判据，判它等于判自己的量具。与 `check-test-sleep.cjs` 的 `FIXTURE_SKIP`
 * 同源（§11.18.3.1 记过的坑：判据去判自己的夹具）。
 */
const FIXTURE_SKIP = new Set(["tests/gate-repo-boilerplate-gate.test.ts"]);

/** 共享件被引用的标志 —— 一旦出现，本判据对该文件整个跳过。 */
const SHARED_IMPORT_RE = /helpers\/gate-repo/;

/** ② 的条件：`execFileSync(` 之后的一段窗口里出现 `join(workdir`。 */
const SPAWN_FROM_WORKDIR_RE = /execFileSync\([\s\S]{0,200}?join\(\s*workdir\b/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else if (TEST_FILE_RE.test(e.name)) out.push(abs);
  }
  return out;
}

/** 扫一个文件，返回它是否手搓了「临时仓库 + 从它拉脚本」这套样板。 */
function scanFile(abs) {
  const raw = fs.readFileSync(abs, "utf8");
  if (SHARED_IMPORT_RE.test(raw)) return false;
  if (!raw.includes("tmpdir(")) return false;
  return SPAWN_FROM_WORKDIR_RE.test(raw);
}

function readBaseline() {
  try {
    const b = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
    return { total: b.total ?? 0, files: b.files ?? {} };
  } catch {
    return { total: 0, files: {} };
  }
}

function main() {
  const files = walk(path.join(ROOT, "tests"));
  const baseline = readBaseline();

  const live = new Map();
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (FIXTURE_SKIP.has(rel)) continue;
    if (scanFile(abs)) live.set(rel, true);
  }

  const liveTotal = live.size;
  const shrunk = liveTotal < baseline.total;
  const grown = liveTotal > baseline.total;

  if (UPDATE) {
    /* 首次建基线（文件不存在）：允许 —— 那是**记账起点**，不是给新增放行。
     * 与 `check-ui-logic-separation.cjs` 的 `--update` 门同一口径。 */
    const firstBaseline = !fs.existsSync(BASELINE);
    if (grown && !ALLOW_NEW && !firstBaseline) {
      console.error(
        `[gate-repo-boilerplate] 拒绝收紧：当前 ${liveTotal} 处 > 原基线 ${baseline.total} 处。` +
          "\n  基线的语义是「待迁的存量」，不是「本批不迁的赦免」——" +
          "\n  新写的门禁自测请用 `tests/helpers/gate-repo.ts` 的 `defineGateRepo`。",
      );
      return 1;
    }
    const out = {
      total: liveTotal,
      files: Object.fromEntries([...live.keys()].sort().map((k) => [k, true])),
    };
    fs.writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
    console.log(
      `[gate-repo-boilerplate] 基线已收紧：${baseline.total} → ${liveTotal} 份（待迁存量）。`,
    );
    return 0;
  }

  if (REPORT_ONLY) {
    console.log(
      `[gate-repo-boilerplate] 盘点：手搓样板 ${liveTotal} 份（基线 ${baseline.total}）。`,
    );
    for (const rel of [...live.keys()].sort()) console.log(`  · ${rel}`);
    return 0;
  }

  if (grown) {
    console.error(
      `[ERROR] 门禁自测的手搓临时仓库样板上涨：${baseline.total} → ${liveTotal} 份。\n` +
        "\n  本仓库 60 余份门禁自测判的是同一件事：把 scripts/ 下的判据脚本当黑盒，" +
        "\n  在一个只放了被测文件的临时仓库里跑一次。这套四件套（mkdtemp + workdir +" +
        "\n  自己写的 run(args) + afterEach rmSync）已收进 `tests/helpers/gate-repo.ts`。\n" +
        "\n  修法：\n" +
        '    · `const { test, expect } = defineGateRepo({ script: "check-xxx.cjs", dirs: [...] });`' +
        "\n    · 用例里从 fixture 取 `repo`：`repo.write(rel, content)` / `repo.run(args)` /" +
        "\n      `repo.read(rel)` / `repo.remove(rel)` / `repo.git(...)`；" +
        "\n    · 收尾由 vitest 保证（`use` 之后），不必再写 `afterEach(() => rmSync(…))`。\n" +
        "\n  本次读数比基线多的那些（如果这里列出的都不是你新写的，见 §13.6.2 复算基线）：",
    );
    for (const rel of [...live.keys()].sort()) {
      if (!baseline.files[rel]) console.error(`  · ${rel} ← 新增`);
    }
    console.error("\n口径见 docs/standards/11-测试与可观测性.md §11.16.1。");
    return 1;
  }

  const tail = shrunk
    ? ` —— 比基线少 ${baseline.total - liveTotal} 份，按 §13.5 口径用 ` +
      "`node scripts/check-gate-repo-boilerplate.cjs --update` 收紧基线"
    : "";
  console.log(
    `[gate-repo-boilerplate] OK —— 手搓样板 ${liveTotal} 份（基线 ${baseline.total}，均为待迁存量）${tail}。`,
  );
  return 0;
}

/* 自测（`tests/gate-repo-boilerplate-gate.test.ts`）钉的是**形状识别口径** ——
 * 它是个纯逻辑，只在临时目录上跑，不拉子进程。只导出扫描函数。 */
module.exports = { scanFile };

if (require.main === module) process.exit(main());
