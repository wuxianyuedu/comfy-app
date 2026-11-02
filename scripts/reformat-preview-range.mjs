#!/usr/bin/env node
/**
 * reformat-preview-range.mjs — 「合并预览下这次改动从哪算起」的**机制层**
 * （规范 §13.5.2 第 8 条 / ISSUE #3038）。
 *
 * ── 为什么单独一份模块 ────────────────────────────────────────────────
 *
 * 它是 `check-reformat-only.cjs` 里**唯一一段与平台拓扑打交道**的取数：那份脚本
 * 贴近 900 行硬闸（§12.6 R5），而这一段的职责与「哪些文件是纯格式化」毫不相干 ——
 * 拆的是职责，不是行数，所以搬走之后两边的判据都不动（与 `reformat-per-commit.mjs`
 * 同一条理由）。
 *
 * ## 它回答的那一问
 *
 * 「没有 `--range`、也没有暂存改动」那一支要判「`HEAD` 这一次提交」，而本地事后复盘
 * 与平台那一跑落到的是同一条支，**HEAD 的形态却不同**：
 *
 *   · 本地复盘：HEAD 是普通提交 ⇒ `HEAD~1..HEAD` 就是「这一条」；
 *   · 平台：HEAD 是**合并预览**（父提交数 ≥ 2），`HEAD~1` 是它的**第一父** ——
 *     是哪一侧由平台拼法决定。实测第二父那一侧才是本 PR ⇒ `HEAD~1` 是目标分支，
 *     整段主干进了分母，逐提交护栏把「重排独占一条」读成夹带
 *     （`cnb-kf6-1k6bvdese` 120/162、`cnb-3lk-1k6d2lm2l` 118/164，两跑各是拼法的一侧）。
 *
 * ## 两条分支，都不猜
 *
 *   ① 认得出合成提交（`CNB_COMMIT` 是 HEAD 的某一父）⇒ 交给 `changed-scope.mjs` 的
 *      `reconcileSyntheticMergeFace()`（与 `shell-gate --base` **同一个函数**，不在这里
 *      另算一份父关系）：区间是「第一父 .. 第一父名下的那个 sha」。只挪起点不够 ——
 *      `#3022` 早先终点留 `HEAD`，两个父的对称差就漏进来了。
 *   ② 认不出 ⇒ 按**拓扑**挑起点：`merge-base(目标 sha, HEAD)`（平台给了基线时它才是
 *      分叉点，第一父未必是）或第一父，取第一个「区间里不含合并提交**或**历史单调」的
 *      （两条口径各治一形，见 `clean()`）。都过不了才退回 `HEAD~1`，并**把这件事念出来**
 *      —— 静默换一个面比多说一句更贵。
 *
 * ⚠️ **这一档不许豁免**：合并提交本身已由 `perCommitShape` 的 `--no-merges` 摘出
 * 逐提交那张表，汇总口径只在「重排独占**整段**」时才放行，所以这里给的是「PR 带来的
 * 那一整段」，不是「合并这一笔」。
 *
 * ## 这一份不做什么
 *
 * 不读 `process.argv`、不打印判决行（那句 `[skip]` 由入口念）、不碰阈值；取数件
 * （`gitOrEmpty` / `gateSkip`）由入口**注入** —— 内核不反过来依赖执行者（§18.4）。
 *
 * @module scripts/reformat-preview-range.mjs — 判据机制层（取数 + 判定，输出交回入口）
 */

/**
 * 区间两侧 —— 「这一次要判哪一段」。
 *
 * @param {{
 *   gitOrEmpty: (args: string[]) => string,
 *   warn: (line: string) => void,
 *   env?: Record<string, string | undefined>,
 *   resolveBaseRef: (deps: {env: Record<string, string | undefined>}) =>
 *     {ok: true, ref: string, via: string} | {ok: false, reason: string},
 *   reconcile: (ref: string, deps: {env: Record<string, string | undefined>}) =>
 *     {used: false, why: string} | {used: true, firstParent: string, head: string},
 * }} deps 入口注入面
 * @returns {{before: string, after: string}} 普通提交形态回 `HEAD~1` / `HEAD`
 */
export function previewRangeEnds(deps) {
  const { gitOrEmpty, env = process.env } = deps;
  /** 普通提交形态：与改动前逐字一致。 */
  const plain = { before: "HEAD~1", after: "HEAD" };
  /**
   * `A..HEAD` 能不能当「本次改动」—— 两条口径，**任一成立即可**。
   *
   *   ① **区间里不含合并提交**：每一条都落在这条分支自己的一线上，那就是「PR 带来的
   *      提交」；有合并就说明这段跨过了别的分支，带进来的东西是不是本 PR 做的分不出来
   *      （平台合预览时会把主干整批带进去）。
   *   ② **`--first-parent` 计数 = 全长**：拿掉合并提交之后历史是单调的 —— 于是区间里
   *      **没有**「已经并进起点、又被再合一次」的提交（那种提交会让「本 PR 带来的」
   *      被读成翻倍）。这一条同时覆盖「先同步 master、再自己提交」这种**正确形态**：
   *      它有合并，但合进来的那一侧全在分叉点之前。
   *
   * 两条各治一形，缺一个就有一批正确形态被误判成「对不上账」（实测：只看 ① 时，
   * 一条带过 8 次同步的 PR 被判成对不上账而退回 `HEAD~1`，退回的正是红过的形状）。
   * 点名的 `A` 自身是合并提交不算 —— 它正是分叉点，不在 `A..HEAD` 里。
   *
   * @param {string} candidate 区间起点
   * @returns {boolean}
   */
  const clean = (candidate) => {
    if (candidate === "") {
      return false;
    }
    const rows = gitOrEmpty(["rev-list", "--parents", `${candidate}..HEAD`])
      .split("\n")
      .map((line) => line.trim().split(/\s+/).filter(Boolean))
      .filter((row) => row.length > 0);
    if (rows.length === 0) {
      return false;
    }
    if (rows.every((row) => row.length <= 2)) {
      return true;
    }
    const firstParent = gitOrEmpty(["rev-list", "--first-parent", `${candidate}..HEAD`])
      .split("\n")
      .filter(Boolean).length;
    return firstParent === rows.length;
  };
  /**
   * 合并预览、但对不上账：按拓扑把区间钉成「PR 引入的那一段」。
   *
   * @param {string[]} parents `HEAD` 的父提交（`rev-list --parents` 那一行，首项是 HEAD 自己）
   * @returns {{before: string, after: string}}
   */
  const adopted = (parents) => {
    const base = deps.resolveBaseRef({ env });
    const candidates = [];
    if (base.ok) {
      const mb = gitOrEmpty(["merge-base", base.ref, "HEAD"]).trim();
      if (mb !== "") {
        candidates.push(mb);
      }
    }
    candidates.push(parents[1] ?? "");
    for (const candidate of candidates) {
      if (clean(candidate)) {
        return { before: candidate, after: "HEAD" };
      }
    }
    /* 两条候选都不成立 ⇒ 没有可信的判决面。退回 `HEAD~1`，但把原因念出来。 */
    deps.warn(
      "合并不对账（认不出本 PR 那一段），按 HEAD~1..HEAD 判 —— 这一档的读数与本次改动对不上账",
    );
    return plain;
  };
  const parents = gitOrEmpty(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/);
  if (parents.length < 3) {
    return plain;
  }
  const base = deps.resolveBaseRef({ env });
  if (base.ok) {
    const face = deps.reconcile(base.ref, { env });
    if (face.used) {
      /* ⚠️ **终点不许取 `face.head`（= 合成提交）**：合成提交的另一个父就是目标分支，
       * 于是 `第一父..合成提交` 正好是**整个 PR 区间** —— 逐提交口径下它没问题（合并
       * 自身被 `--no-merges` 摘掉），可它把「PR 自己那条线」与「这次合并带进来的主干
       * 那一批」混成一段，`report()` 的汇总口径就按整段算分母（实测 170 份里 118 份
       * 被判纯格式化，而逐提交复算只有 `8d052468` 一条 offender）。
       *
       * 该判的是**本 PR 自己那条线**：`第一父 .. 第二父`（源分支 tip）。平台给的
       * `CNB_COMMIT` 通常就是它；认不出时退回「HEAD 的两个父里不是第一父的那个」
       * （拓扑上就是本 PR 那一侧），拿不到才用 `face.head`（至少不比 `HEAD~1` 更糟）。 */
      const tip = String(env.CNB_COMMIT ?? "").trim();
      const other = parents.find((p) => p !== face.firstParent && p !== "") ?? "";
      const after = tip !== "" ? tip : other || face.head;
      /* 起点取**分叉点**：`第一父` 是「目标分支那一刻的顶端」，它自己也可能在分叉点
       * 之后落过提交（主干那批）—— 拿它当起点会把那批算进本 PR 的分母。分叉点算不出来
       * 才退回 `第一父`。 */
      const forkPoint = gitOrEmpty(["merge-base", face.firstParent, after]).trim();
      return { before: forkPoint !== "" ? forkPoint : face.firstParent, after };
    }
  }
  return adopted(parents);
}
