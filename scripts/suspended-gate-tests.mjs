// @ts-nocheck -- 提交门槛脚本：无类型消费方，tsc 面在 src/**（同 `run-affected-tests.mjs` 口径）。
/**
 * `suspended-gate-tests.mjs` —— **临时停用**的固定清单用例（ISSUE #2948）。
 *
 * 为什么需要这一层：平台 `固定结构用例` 那一格本体是一份 45m 预算的 stage，而清单里有
 * 几份**工具行为自检**单份就要几分钟 —— 实测（ISSUE #2948 的读数）
 * `tests/eslint-gate-canary.test.ts` 635.3s / `tests/base-check.test.ts` 209.0s /
 * `tests/check-bundle-budget.test.ts` 174.0s，三份合计约 17 分钟，占掉这一格的大半墙钟。
 * 业主口径是「先临时关掉，后面再开」。
 *
 * ## 为什么不是把它们从 `FIXED_STRUCTURAL_TESTS` 里删掉
 *
 * 删一条 = 那条判据**没有执行者**，而清单是「谁在跑它」的记账面：`tests/ci-gate-names.test.ts`
 * 会当场点名（#2227 现场）。停用的形态必须是**名字还在、两侧都被拦、且日志里读得出来**。
 *
 * ## 三条规矩（与 `.cnb.yml` 的「停用 ≠ 删除」同一口径）
 *
 * 1. **名字留在清单里**，只是不再进 vitest 的位置参数 —— 台账是第二份名单，不是删改。
 * 2. **只过滤平台那两格（`fixed` 段 / 每日全量档）**，清单与判据本体一个字都不改。
 *    但**不要把它读成"本地还有一层兜底"**（ISSUE #2957 就是来堵这句的）：固定清单的本地
 *    执行者一直是钩子的组 C，而组 C 自 2026-10-20 起在 `run_group()` 里对 `C` 写 `.skip`
 *    直接 `return 0`（AGENTS 硬规则 7：`COMFY_HEAVY_GATES=1` 也换不回来）。
 *    ⇒ 停用期间这三条用例文件的自动执行者集合是**空**，代价由 `executorsNow: []` 明写，
 *      不由任何一句"本地照跑"承担。判据**本体**（`eslint` / `base-check.mjs` /
 *      `check-bundle-budget.cjs`）仍在各自的门禁里跑，那是另一件事，写在 `guardNote`。
 * 3. **每一条都要写清「停用期间还剩谁在跑这条用例文件」**（`executorsNow`）：
 *    这个字段**不是自述**，它由 `tests/suspended-gate-tests.test.ts` 与钩子的机器事实对账 ——
 *    组 C 的本地执行者自 2026-10-20 撤了（`.githooks/pre-commit` 的 `run_group()` 对 `C`
 *    写 `.skip` 后 `return 0`，`COMFY_HEAVY_GATES=1` 也换不回来），所以「本地钩子组 C」
 *    **不能**被写成执行者：那样一句会把「这三条此刻一个自动执行者都没有」读成"还有一层兜底"。
 *    允许写空数组 —— 空就是空，读数里会照实说"只剩人工"。
 */

/**
 * 一条停用登记。
 *
 * @typedef {{
 *   test: string,
 *   issue: number,
 *   why: string,
 *   resume: string,
 * }} SuspendedTest
 */

/**
 * 平台上暂不执行的固定清单用例（**名单是封闭的**：判据 `tests/suspended-gate-tests.test.ts`
 * 钉住这份名单与 `FIXED_STRUCTURAL_TESTS` 的关系，加一条要人来签字）。
 *
 * 恢复动作：从这份表里删掉那一行 —— 清单本身一个字都不用改。
 *
 * `executorsNow` = 停用期间**这条用例文件**还剩哪些自动执行面（空数组就是空）；
 * `guardNote` = 判据**本体**此刻仍在哪儿跑（两件事不许混写，见文件头规矩 2）。
 *
 * @type {ReadonlyArray<SuspendedTest & { executorsNow: ReadonlyArray<string>, guardNote: string }>}
 */
export const SUSPENDED_GATE_TESTS = [
  {
    test: "tests/eslint-gate-canary.test.ts",
    issue: 2948,
    why:
      "635.3s（平台实测，`scripts/.test-file-timing.json` 里入库读数是 238.5s）：它是 eslint 档位的" +
      "阳性对照，每次真起一次 eslint 冷启动（#2862 记过这一档的冷启动代价）",
    executorsNow: [],
    guardNote:
      "判据本体（eslint 那一批）仍在推送那一跳的 `check:premerge` 与平台档里跑；" +
      "停的是这条**阳性对照** —— 停用期间 eslint 档位合并行为没人验证，只剩人工 " +
      "`pnpm exec vitest run tests/eslint-gate-canary.test.ts`",
    resume: "等 #2862 的冷启动代价降下来，或这一格的墙钟预算重新有富余",
  },
  {
    test: "tests/base-check.test.ts",
    issue: 2948,
    why:
      "209.0s（平台实测，入库读数 103.7s）：在临时工作区里真起 `base-check.mjs` 复算五态，" +
      "每条用例一次子进程",
    executorsNow: [],
    guardNote:
      "判据本体 `node scripts/base-check.mjs` 是人随时可跑的只读入口（归因仍可用）；" +
      "停的是它自己的四态用例 —— 停用期间它回归不了，改坏了没人拦",
    resume: "等复算链不再逐条起子进程，或这一格墙钟预算有富余",
  },
  {
    test: "tests/check-bundle-budget.test.ts",
    issue: 2948,
    why:
      "174.0s（平台实测，入库读数 247.2s）：把判据当黑盒跑在临时工作区里，`--update` / 拒绝话术" +
      "每一格一次真跑",
    executorsNow: [],
    guardNote:
      "判据本体仍在 `pnpm build` 收尾与 `pnpm check:bundle` 两处真跑；停的是它的**自检用例**" +
      "（体积棘轮会不会阻断、是不是空转，停用期间没人验）",
    resume: "等这一格墙钟预算有富余（这一批三条一起恢复）",
  },
];

/**
 * 台账里的用例名集合（调用点与判据共用一份，别各写一遍）。
 *
 * @param {ReadonlyArray<{test: string}>} [ledger] 缺省取 `SUSPENDED_GATE_TESTS`
 * @returns {Set<string>}
 */
export function suspendedNames(ledger = SUSPENDED_GATE_TESTS) {
  return new Set((ledger ?? []).map((entry) => entry.test));
}

/**
 * 从一份清单里剔除停用项，并把「剔了哪几条」交出去（**不静默跳过**）。
 *
 * 剔完为空时**照旧返回空数组**：调用方各自有「空清单」的处置（fixed 段退 1、
 * 全量档仍由 vitest 自行收集），不在这里替它们做决定。
 *
 * @param {string[]} files 待跑的用例清单
 * @param {ReadonlyArray<{test: string}>} [ledger]
 * @returns {{files: string[], dropped: string[]}}
 */
export function withoutSuspended(files, ledger = SUSPENDED_GATE_TESTS) {
  const skip = suspendedNames(ledger);
  const dropped = [];
  const kept = [];
  for (const rel of files ?? []) {
    (skip.has(rel) ? dropped : kept).push(rel);
  }
  return { files: kept, dropped };
}

/**
 * 一行读数（进日志用）：停用了几条、分别是谁、恢复条件挂在哪儿。
 *
 * 为什么必须有这一行：停用**不改变任何判据**，所以它在读数上只剩下这一句；没有它，
 * 「这一格今天少跑了三条」与「这三条根本不在清单里」在日志里逐字同形。
 *
 * @param {string[]} dropped 本次被剔除的用例
 * @param {ReadonlyArray<SuspendedTest & {executorsNow?: ReadonlyArray<string>, guardNote?: string}>} [ledger]
 * @returns {string} 末尾带换行；没有剔除项时返回空串
 */
export function suspendedReading(dropped, ledger = SUSPENDED_GATE_TESTS) {
  if (!dropped || dropped.length === 0) {
    return "";
  }
  const byTest = new Map((ledger ?? []).map((entry) => [entry.test, entry]));
  const lines = dropped.map((rel) => {
    const one = byTest.get(rel);
    if (!one) {
      return `  · ${rel}（台账里没有这一条 —— 清单与报名对不上，先补登记）`;
    }
    const now = one.executorsNow ?? [];
    /* 这一句必须说实话（ISSUE #2957）：固定清单的本地执行者是钩子的组 C，而它已被撤，
     * 所以"本地钩子照跑"是不存在的兜底。空就念「无自动执行者」，不许圆场。 */
    const exec =
      now.length > 0
        ? `自动执行者：${now.join(" / ")}`
        : "自动执行者：**无**（本地组 C 已撤、平台两格与每日全量都剔）⇒ 只剩人工";
    const guard = one.guardNote ? `；${one.guardNote}` : "";
    return `  · ${rel}（ISSUE #${one.issue}：${one.why}）\n      ${exec}${guard}\n      恢复：${one.resume}`;
  });
  return (
    `[suspended] 本格按台账暂不执行 ${dropped.length} 条固定清单用例` +
    "（名字仍在固定清单里，不是「这批判据没了」；但也不许把它读成「本地还有一层」）：\n" +
    `${lines.join("\n")}\n`
  );
}

/**
 * 停用台账 → vitest 的 `--exclude` 实参（ISSUE #2948）。
 *
 * 为什么是 `--exclude` 而不是 `--testPathIgnorePatterns`：后者在 vitest 3 已被移除，
 * 而 `--exclude` 的语义正是「从收集面里剔掉这几条」（与配置文件里的 `exclude` 同一份）。
 * 逐条一个旗标、不拼逗号 —— 拼成一个参数会让「剔了哪几条」在命令行上读不出来，
 * 而这一档的全部可见性就在那一行读数上。
 *
 * 空数组 ⇒ 返回空数组（一个字都不加）：`--exclude=""` 是另一个语义，别顺手写出来。
 *
 * @param {string[]} exclude 要剔的仓库相对路径
 * @returns {string[]}
 */
export function excludeArgs(exclude) {
  return (exclude ?? []).filter(Boolean).flatMap((rel) => ["--exclude", rel]);
}

/**
 * 某一档（`fixed` 段 / 全量档）该跑的清单 —— 台账在这里一次性生效。
 *
 * 存在的理由是 900 行硬闸（§12.6 R5）：调用点 `run-affected-tests.mjs` 已经顶着它，
 * 而「读台账 → 裁清单 → 吐读数」是同一件事的三步，散在调用点里就要三行。
 * 这也是它放在台账这一侧的原因：谁决定「这条不跑」，谁就该把「怎么裁」一起说完。
 *
 * @param {string[]} files 本档原本要跑的清单
 * @param {"fixed" | "full"} segment
 * @returns {{files: string[], excludes: string[], reading: string}}
 *   `fixed` 段在位置参数上裁（`files` 已剔好、`excludes` 为空）；
 *   `full` 档的清单由 vitest 自己收集 ⇒ 反过来：`files` 原样、`excludes` 是台账全集。
 */
export function applySuspension(files, segment) {
  if (segment === "full") {
    const excludes = [...suspendedNames()];
    return { files: files ?? [], excludes, reading: suspendedReading(excludes) };
  }
  const picked = withoutSuspended(files);
  return { files: picked.files, excludes: [], reading: suspendedReading(picked.dropped) };
}

/**
 * `applySuspension` 的**纯字符串**形态：把「剔了哪几条」收成一段日志文本。
 *
 * 为什么再包一层：调用点（`run-affected-tests.mjs`）顶着 900 行硬闸，而那里每多一行
 * 注释/变量都是往闸上撞。台账这一侧把「读数怎么念」说完，调用点只剩一句
 * `process.stderr.write(…)` —— 读数**没有**因此变成可选项，它只是换了落点。
 *
 * @param {{reading: string}} applied `applySuspension()` 的产出
 * @returns {string}
 */
export function suspensionLog(applied) {
  return applied?.reading ?? "";
}
