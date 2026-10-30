/**
 * fixed-gate-input-faces.mjs —— 固定清单里那几条**重档判据**的输入面（ISSUE #2022）。
 *
 * ## 为什么固定清单也要筛
 *
 * 业主给的硬约束：本地 pre-commit 不能超过 5 分钟 —— 超了人的真实反应是 `--no-verify`，
 * 而「钩子必须拦得住」是整条 §13.6 的前提，被绕过的钩子比慢的钩子危险得多。
 * 实测一次**只改 14 个文件、其中 0 个 `src/**`** 的提交：组 C 545.4s，全钩子 570.7s，
 * 而它的分文件读数是**极偏**的 —— 前 20 份吃掉 74%（815.7s），其余 90 份合计只有 283.4s
 * （中位数 1–2s）。砍那 90 份便宜的换不来什么；贵的是这几条：
 *
 * | 那一条 | 一次跑多久 | 在不在固定清单 | 它真正读的是什么 |
 * | --- | --- | --- | --- |
 * | `base-check` | 105.9s | ✅ | `scripts/base-check.mjs` + `.githooks/**` |
 * | `tw4-hardgate-behaviour` | 54.5s | ✅ | 四份 tw4 工具 + `src/app/globals.css` |
 * | `check-bundle-budget` | 51.7s | ✅ | 判据本体 + `scripts/.bundle-budget-baseline.json` |
 * | `a11y-rules-gate` | 47.5s | ✅ | `eslint.config.js` + 判据本体 + 真台账 |
 * | `check-reformat-only` | 166.7s | ❌ 走 import 图 | —— 已经是有条件的，不动它 |
 * | `ci-toolchain-selfcheck` | 67.0s | ❌ 走 import 图 | —— 同上 |
 *
 * ⚠️ 上面那张表只记当时的那几条，名单本身以 `INPUT_FACES` 为准；而且那两条不是被「省略」的：它们不在固定清单里，
 * 这次会跑是因为本次真的改了 `scripts/**`（import 图命中，属于该跑）。给它们写面没有
 * 任何效果，反而会把「图判它该跑」与「面判它该跑」混成两处各说各话 —— 判据
 * （`tests/fixed-gate-input-faces.test.ts`）要求每条登记都**在**固定清单里，正是为了
 * 让这种错配当场红，而不是留下一条永远不生效的面。
 *
 * 这四条都是**工具行为自检**：在临时工作区里现拷夹具、跑那个被测工具 —— 也就是说
 * `src/**` 改了业务代码**并不会改变它们的判决**，可它们每次都跑。这正是那 545s 的形状。
 *
 * ## 与平台侧那 13 条同一个机制，不是第二套
 *
 * `.cnb.yml` 的 stage 级 `ifModify` 早已是「触发面由判据自己导出」（`scripts/ci-incremental-gates.mjs`
 * 双向判，见规范 §13.5.20）—— 本文件只是把同一件事接到**钩子**这一层：钩子的测试层此前
 * 只有「固定清单」与「import 图可达」两档，没有「这条判据的输入面碰没碰」那一档。
 *
 * ## 三条不肯让它烂掉的规定
 *
 * 1. **面要写「它读什么」，不是写「它大概关于什么」**：每条 `face` 都是该 test 真的
 *    `require` / 拷进夹具 / 断言其内容的那些路径。凭业务印象写一条宽面，下次改到不相干的
 *    文件它也命中 ⇒ 等于没筛；写窄一条，改了被测工具它不跑 ⇒ 那是**悄悄不跑**，本仓最狠的那族。
 * 2. **登记了就受审**：`tests/fixed-gate-input-faces.test.ts` 判「每条 face 的每个模式都至少
 *    命中仓库里一个现存路径」（写错路径的面 = 那条 test 永远不再跑，而日志上看不出区别），
 *    并判「开面的名单就是这一份」—— 加一条要人来签字，不由这一层的代码自己扩张。
 * 3. **跳过必须说出口**：`main()` 打「固定清单按输入面跳过 N 条：…」，而**放弃收窄那一档
 *    （`wide`）完全不过筛** —— 机器紧张或改了全局测试配置时，退回全跑固定清单，
 *    那时省的时间不是我们要的。
 */

/**
 * 一条登记。
 *
 * @typedef {{test: string, face: readonly string[], why: string}} GateFace
 */

/**
 * 开了输入面的固定清单条目（**名单是封闭的**：判据钉住这份名单本身，也钉住「必须在固定清单里」）。
 *
 * @type {ReadonlyArray<GateFace>}
 */
export const INPUT_FACES = [
  {
    test: "tests/base-check.test.ts",
    face: [
      "scripts/base-check.mjs",
      "scripts/base-check/**",
      "tests/helpers/git-sandbox-env.ts",
      "tests/base-check.test.ts",
    ],
    why: "它判的是「被门槛拦住时那条命令能不能复算归属」：被测面是 base-check 本体、它三份直接依赖（`git-ref` / `hook-steps` / `verdict`）与用例自己 import 的 `git-sandbox-env`（临时仓库的环境变量口径）。钩子那一侧**不写进面**（`.githooks/**` 是宽面触发，命中它整档先退回全跑，这一层根本轮不到问）—— 用例里的钩子文本是它自己写的夹具",
  },
  {
    test: "tests/tw4-hardgate-behaviour.test.ts",
    face: [
      "scripts/tw4-canonical-report.mjs",
      "scripts/tw4-spacing-canonical.mjs",
      "scripts/tw4-scan-core.mjs",
      "scripts/tw4-canonical-codemod.cjs",
      "src/app/globals.css",
      "tests/tw4-hardgate-behaviour.test.ts",
      "tests/helpers/gate-repo.ts",
      "tests/helpers/symlink-dir.ts",
    ],
    why: "公共夹具是「`scripts/` 落点 + `src/app/globals.css` + 链回来的 node_modules」，断言的是棘轮基线的读写与硬闸行为 —— 四份 tw4 工具与那份 css 都在面里",
  },
  {
    test: "tests/check-bundle-budget.test.ts",
    face: [
      "scripts/check-bundle-budget.cjs",
      "scripts/.bundle-budget-baseline.json",
      "tests/check-bundle-budget.test.ts",
      "tests/helpers/gate-repo.ts",
      "tests/helpers/ratchet-refusal.ts",
    ],
    why: "把判据当黑盒跑在**临时工作区**里（它内部按 `__dirname/..` 找 `.next/static/chunks`）—— 本仓真实产物不在它的读取面上，它读的是脚本自己、基线 JSON 与两个直接 import 的夹具（临时仓库 + 拒绝话术的断言口径）",
  },
  {
    test: "tests/a11y-rules-gate.test.ts",
    face: [
      "scripts/check-a11y-rules.cjs",
      "scripts/.a11y-rule-ledger.json",
      "eslint.config.js",
      "tests/fixtures/a11y-rule-ledger.sample.json",
      "tests/helpers/a11y-effective-config.ts",
      "tests/a11y-rules-gate.test.ts",
    ],
    why: "被测输入里最贵的一件是真的 `eslint.config.js`（它 import 了整个配置图），其余是判据本体与两份台账；业务组件改多少都不会让「规则开关 ⇄ 台账」这条漂",
  },
  /* 下面这批是「拿真子进程 / 真 git / 真渲染」的判据自测：它们的触发面都窄到能写成面 ——
   * 进固定清单的理由是 import 图追不到，不是「必须每次跑」。#2793 先登记了耗时榜上最贵的
   * 四条，#2798 把同一张榜上剩下的九条按实读的 IO 补齐。`tests/affected-tests.test.ts`
   * **刻意留在这里之外**：它守着「增量层还在增量」这件事本身，筛它等于让解析器的缺陷把自己筛掉。
   *
   * 依赖面与全局配置（`package.json` / lockfile / `tsconfig*.json` / `tests/setup.ts`）
   * **不往面里写**：它们自己就是 `WIDE_TRIGGERS`，一命中就退成整档全跑，根本到不了这一层
   * 筛 —— 写进去只会长出一个永远不会被问到的模式（判据里那一格会当场点名这种死面）。 */
  {
    test: "tests/eslint-gate-canary.test.ts",
    face: [
      "eslint.config.js",
      "scripts/eslint-gate-canary.mjs",
      "tests/eslint-gate-canary.test.ts",
    ],
    why: "样本文件写进 `tests/` 与 `scripts/` 的临时目录，再用**本仓的 `eslint.config.js`** 真跑 eslint；样本要落在 tsconfig 的项目里，所以配置、被测脚本或项目声明任一变判决都可能变（后两者与插件版本同属 wide 触发面，轮不到这一层）",
  },
  {
    test: "tests/check-commit-claims.test.ts",
    face: [
      "scripts/check-commit-claims.mjs",
      "tests/helpers/gate-repo.ts",
      "tests/check-commit-claims.test.ts",
    ],
    why: "夹具是临时 `git init` 出来的仓库，真历史那一条钉的是不可变的提交 `ad81a912`：判据只读被测脚本、共享夹具与那份历史，后者不随新提交漂",
  },
  {
    test: "tests/changed-scope.test.ts",
    face: ["scripts/changed-scope.mjs", "tests/changed-scope.test.ts"],
    why: "输入只有被测模块与临时 git 夹具（预置的 diff 形状与环境变量），不读仓库里任何别的文件 —— 「算法被改软」就是这份脚本被改",
  },
  {
    test: "tests/a11y-axe-stories.test.ts",
    face: [
      "src/components/ui/**",
      ".storybook/data-sources.tsx",
      "scripts/.a11y-axe-known.json",
      "tests/helpers/jsdom-capability.ts",
      "tests/a11y-axe-stories.test.ts",
    ],
    why: "输入是 `src/components/ui/*.stories.tsx` 渲染出来的那棵树及其装饰器数据源：组件与故事的改动会改判决，负债台账与 jsdom 能力件同理（`tests/setup.ts` 与 axe / react 的版本是 wide 触发面，轮不到这一层）",
  },
  {
    test: "tests/gate-executors.test.ts",
    face: [
      "scripts/**",
      "tests/helpers/gate-repo.ts",
      "tests/gate-executors.test.ts",
    ],
    why: "它 `readdirSync(scripts/)` 把每一份判据脚本拷进临时工作区，再拿 `.gate-executor-ledger.json` 与 `quality-gate.mjs/.ps1` 对账 —— 新增、改名或删掉一份判据脚本都会改判决；真钩子那一侧是 wide 触发面，轮不到这一层",
  },
  {
    test: "tests/check-merge-parents.test.ts",
    face: [
      "scripts/check-merge-parents.mjs",
      "tests/helpers/gate-repo.ts",
      "tests/check-merge-parents.test.ts",
    ],
    why: "临时 git 仓库里真造合并现场，判据与共享夹具是唯一的读入面；真 `.githooks/prepare-commit-msg` 那条断言由 wide 触发面兜（改钩子时整档全跑）",
  },
  {
    test: "tests/merge-changelog-anchor.test.ts",
    face: [
      "scripts/merge-changelog-fragments.mjs",
      "tests/helpers/git-sandbox-env.ts",
      "tests/merge-changelog-anchor.test.ts",
    ],
    why: "CHANGELOG 与碎片都是用例自己在临时仓库里造的，真仓只有被测脚本与环境隔离件两个输入",
  },
  {
    test: "tests/storybook-tsc-input.test.ts",
    face: [
      ".storybook/**",
      "scripts/storybook-assets.mjs",
      "scripts/install-git-hooks.mjs",
      ".gitignore",
      "tests/helpers/strip-comments.ts",
      "tests/storybook-tsc-input.test.ts",
    ],
    why: "它读 `.storybook` 的入口 / 注入层 / 生成件契约、`.gitignore` 的「生成件不入库」规则与装钩子入口的接线，再拿真 tsc 复量；`tsconfig.json` 与 `package.json` 是 wide 触发面",
  },
  {
    test: "tests/eslint-exemption-staleness.test.ts",
    face: [
      "eslint.config.js",
      "scripts/check-eslint-exemptions.cjs",
      "scripts/check-a11y-rules.cjs",
      "scripts/check-docs-api.cjs",
      "scripts/check-format.cjs",
      "scripts/check-theme-colors.cjs",
      "scripts/ci-build-readout.mjs",
      "scripts/ci-toolchain-pnpm.mjs",
      "scripts/file-structure-rules.cjs",
      "src/lib/llm/video-task-util.test.ts",
      "src/lib/llm/video-task-util.ts",
      "src/lib/log/log-ansi.ts",
      "src/lib/media/materials.ts",
      "src/lib/process/executable-resolve.ts",
      "tests/ci-log.test.ts",
      "tests/no-platform-ci-config.test.ts",
      "tests/eslint-exemption-staleness.test.ts",
    ],
    why: "台账写在 `eslint.config.js` 里，加载器是 `check-a11y-rules.cjs`；bin 那一条拿真配置逐份 lint 台账点名的文件 —— 任一文件不再需要豁免，读数就变",
  },
  {
    test: "tests/scripts-typecheck-ratchet.test.ts",
    face: [
      "scripts/**",
      "tests/helpers/ratchet-refusal.ts",
      "tests/helpers/git-sandbox-env.ts",
      "tests/scripts-typecheck-ratchet.test.ts",
    ],
    why: "判决面是 `tsconfig.scripts.json` 展开的全部 `scripts/**/*.mjs`，还拿盘上枚举与真基线 JSON 对账 —— 新增或改一份脚本都在输入面里（那份 tsconfig 自己是 wide 触发面）",
  },
  {
    test: "tests/precommit-timing.test.ts",
    face: [
      "scripts/precommit-timing.mjs",
      "tests/helpers/hook-groups.ts",
      "tests/helpers/git-sandbox-env.ts",
      "tests/precommit-timing.test.ts",
    ],
    why: "判的是记账 / 读账往返与 CLI 契约，读入面是被测脚本与两个夹具 helper；`.githooks/pre-commit` / `timing.sh` 那两条接线断言落在 wide 触发面上",
  },
  {
    test: "tests/ci-env-probe.test.ts",
    face: [
      ".cnb.yml",
      ".cnb/web_trigger.yml",
      "scripts/ci-env-probe.mjs",
      "scripts/ci-toolchain-browser.mjs",
      "scripts/ci-toolchain-browser-reach.mjs",
      "scripts/ci-toolchain-browser-fetch.mjs",
      "scripts/ci-toolchain-browser-seed.mjs",
      "scripts/ci-toolchain-browser-root.mjs",
      "scripts/ci-console-encoding.mjs",
      "scripts/ci-toolchain-python.mjs",
      "scripts/ci-cp936-exit.mjs",
      "scripts/setup-comfy-cli-venv.mjs",
      "scripts/setup-comfy-cli-venv.ps1",
      "scripts/ci-oneshot-gates.mjs",
      "scripts/full-suite-run.mjs",
      "scripts/freshness-ledger.mjs",
      "scripts/doc-facts.cjs",
      "tests/no-platform-ci-config.test.ts",
      "tests/ci-env-probe.test.ts",
    ],
    why: "它对着 `.cnb.yml` 判环境前提那一步的接线与门禁顺序，并 import 探针本体与它的本地依赖；`tests/no-platform-ci-config.test.ts` 是 import 进来的（它的 describe 会一起注册），后者的直接输入也逐条列在这里",
  },
  {
    test: "tests/changelog-versions-gate.test.ts",
    face: [
      "scripts/check-changelog-versions.cjs",
      "tests/helpers/gate-repo.ts",
      "tests/changelog-versions-gate.test.ts",
    ],
    why: "CHANGELOG 由每个工作区自己造，锚取临时仓库真算出的短哈希 —— 真仓只有被测脚本与共享夹具两个输入",
  },
];

/**
 * 一个模式是否覆盖某个仓库相对路径。
 *
 * 只认三种形状，刻意不做完整 glob：`dir/**`（前缀）、`a/x-*.json`（同段通配）、
 * 精确路径。多出来的 glob 能力在这里只有一种用途 —— 让一条写错的面看起来也能命中。
 *
 * @param {string} file
 * @param {string} pattern
 * @returns {boolean}
 */
export function faceMatches(file, pattern) {
  const f = String(file).replace(/\\/g, "/");
  const p = String(pattern).replace(/\\/g, "/");
  if (p === "" || p === "**" || p === "*") return false;
  if (p.endsWith("/**")) return f.startsWith(p.slice(0, -2));
  if (!p.includes("*")) return f === p;
  const re = new RegExp(
    `^${p
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]*")}$`,
  );
  return re.test(f);
}

/**
 * 该不该跑这一条固定判据。
 *
 * @param {GateFace} entry
 * @param {Iterable<string>} changed 本次暂存/改动的路径
 * @returns {boolean}
 */
export function faceHits(entry, changed) {
  for (const rel of changed) {
    if (rel === entry.test) return true;
    for (const pattern of entry.face)
      if (faceMatches(rel, pattern)) return true;
  }
  return false;
}

/**
 * 把固定清单切成「跑」与「按面跳过」。
 *
 * @param {readonly string[]} fixed `FIXED_STRUCTURAL_TESTS`
 * @param {Iterable<string>} changed
 * @param {ReadonlyArray<GateFace>} [faces]
 * @returns {{keep: string[], skipped: {test: string, why: string}[]}}
 */
export function selectFixedByFace(fixed, changed, faces = INPUT_FACES) {
  const byTest = new Map(faces.map((entry) => [entry.test, entry]));
  /** @type {string[]} */
  const keep = [];
  /** @type {{test: string, why: string}[]} */
  const skipped = [];
  for (const rel of fixed) {
    const entry = byTest.get(rel);
    if (entry === undefined || faceHits(entry, changed)) {
      keep.push(rel);
      continue;
    }
    skipped.push({ test: rel, why: entry.why });
  }
  return { keep, skipped };
}
