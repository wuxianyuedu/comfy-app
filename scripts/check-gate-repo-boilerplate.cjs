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
 * ── 硬闸（2026-10-13 起）──────────────────────────────────────────────
 *
 * 这条判据原先是棘轮：收口时留了三份没迁（`check-file-structure` 大量直接
 * `writeFileSync` 造 Buffers；`check-reformat-only` 要 git init + 软链 node_modules +
 * 工作区之外的探针配置；`gate-executors` 是把**全部**判据脚本过滤拷贝过去，
 * 与「单脚本」模型不同形），逐份迁完、账记在一份基线里。
 *
 * 三份都迁进 `defineGateRepo` 之后基线归零，棘轮就只剩坏处：`--update` 与
 * `--allow-new` 两个动作都无事可做，留下的却是一条「手改那份 JSON 就能把新的
 * 手搓样板登记成已知存量」的通道 —— 硬闸类本来没有的中间态（§13.6.2 的两类对照）。
 * 所以基线文件已删、`--update` / `--allow-new` 已删，命中即退 1。
 *
 * ⚠️ 合法的例外形态**不在这里开口子**：真需要自己搭工作区而不走共享件的，
 * 走 §11.16 那条「三条条件不同时成立」的口径（例如只造临时目录、或拉的不是
 * 本仓 `scripts/` 下的判据脚本）—— 那是判据本来就放过的形状，不是新登记的存量。
 *
 * ── 成本 ──────────────────────────────────────────────────────────────
 *
 * 纯文本扫描 600+ 份用例，实测 < 0.3s（零网络、零子进程）—— 照 §13.5.4 的成本判据，
 * 这个量级该进钩子而不是按需召唤。
 *
 * 用法：
 *   node scripts/check-gate-repo-boilerplate.cjs            # 检查（进 pre-commit D 组，命中即退 1）
 *   node scripts/check-gate-repo-boilerplate.cjs --report   # 只出清单不判失败（盘点用）
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const path = require("node:path");
const { readForScan, walkForScan, vanishedNote } = require("./gate-scan-read.cjs");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");

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

/** 枚举扫描面（消失容错与「只降级 ENOENT」的口径在 `gate-scan-read.cjs`）。 */
function walk(dir) {
  return walkForScan(dir, TEST_FILE_RE);
}

/**
 * 扫一个文件，返回它是否手搓了「临时仓库 + 从它拉脚本」这套样板；
 * 文件在「列目录 → 读内容」之间消失时返回 `null`（调用方必须计数，见 `main`）。
 */
function scanFile(abs) {
  const raw = readForScan(abs);
  if (raw === null) {
    return null;
  }
  if (SHARED_IMPORT_RE.test(raw)) {
    return false;
  }
  if (!raw.includes("tmpdir(")) {
    return false;
  }
  return SPAWN_FROM_WORKDIR_RE.test(raw);
}

function main() {
  const files = walk(path.join(ROOT, "tests"));

  const live = new Map();
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
    if (hit) {
      live.set(rel, true);
    }
  }
  /* 消失数必须进结论：少读一份就把读数报小 —— 看着像「样板在减少」，实际是这一轮
     没读（口径见 `gate-scan-read.cjs`）。 */
  const note = vanishedNote(vanished);

  const liveTotal = live.size;

  if (REPORT_ONLY) {
    console.log(`[gate-repo-boilerplate] 盘点：手搓样板 ${liveTotal} 份。` + note);
    for (const rel of [...live.keys()].sort()) {
      console.log(`  · ${rel}`);
    }
    return 0;
  }

  if (liveTotal > 0) {
    console.error(
      `[ERROR] 门禁自测里还在手搓临时仓库样板：${liveTotal} 份。\n` +
        "\n  本仓库 60 余份门禁自测判的是同一件事：把 scripts/ 下的判据脚本当黑盒，" +
        "\n  在一个只放了被测文件的临时仓库里跑一次。这套四件套（mkdtemp + workdir +" +
        "\n  自己写的 run(args) + afterEach rmSync）已收进 `tests/helpers/gate-repo.ts`。\n" +
        "\n  修法：\n" +
        '    · `const { test, expect } = defineGateRepo({ script: "check-xxx.cjs", dirs: [...] });`' +
        "\n    · 用例里从 fixture 取 `repo`：`repo.write(rel, content)` / `repo.run(args)` /" +
        "\n      `repo.read(rel)` / `repo.remove(rel)` / `repo.git(...)`；" +
        "\n    · 收尾由 vitest 保证（`use` 之后），不必再写 `afterEach(() => rmSync(…))`。\n" +
        "\n  需要「夹具选项盖不住」的形状（如整目录过滤拷贝）时，写进 `setup` / `copy`，" +
        "\n  不要把四件套搬回来。\n" +
        "\n  本次点名的（如果你根本没碰过它们，见 §13.6.2 复算 master 基线）：",
    );
    for (const rel of [...live.keys()].sort()) {
      console.error(`  · ${rel}`);
    }
    console.error("\n口径见 docs/standards/11-测试与可观测性.md §11.16.1。" + note);
    return 1;
  }

  console.log(`[gate-repo-boilerplate] OK —— 手搓样板 0 份。` + note);
  return 0;
}

/* 自测（`tests/gate-repo-boilerplate-gate.test.ts`）钉的是**形状识别口径** ——
 * 它是个纯逻辑，只在临时目录上跑，不拉子进程。只导出扫描函数。 */
module.exports = { scanFile };

if (require.main === module) {
  process.exit(main());
}
