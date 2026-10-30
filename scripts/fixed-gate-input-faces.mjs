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
 * ⚠️ 名单因此是**四条而不是六条**，而且那两条不是被「省略」的：它们不在固定清单里，
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
 *    并判「开面的名单就是这 4 条」—— 加第 5 条要人来签字，不由这一层的代码自己扩张。
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
 * 开了输入面的固定清单条目（**刻意只此 4 条**，判据钉住这条上限，也钉住「必须在固定清单里」）。
 *
 * @type {ReadonlyArray<GateFace>}
 */
export const INPUT_FACES = [
  {
    test: "tests/base-check.test.ts",
    face: ["scripts/base-check.mjs", ".githooks/**", "tests/base-check.test.ts"],
    why: "它判的是「被门槛拦住时那条命令能不能复算归属」：被测面是 base-check 本体 + 钩子怎么点名判据（含 `commandTargetState` 认的那些命令行形状）",
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
    ],
    why: "把判据当黑盒跑在**临时工作区**里（它内部按 `__dirname/..` 找 `.next/static/chunks`）—— 本仓真实产物不在它的读取面上，它读的是脚本自己与基线 JSON",
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
  if (p === "" || p === "**" || p === "*") {
    return false;
  }
  if (p.endsWith("/**")) {
    return f.startsWith(p.slice(0, -2));
  }
  if (!p.includes("*")) {
    return f === p;
  }
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
    if (rel === entry.test) {
      return true;
    }
    for (const pattern of entry.face) {
      if (faceMatches(rel, pattern)) {
        return true;
      }
    }
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
