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
 *      分叉点，第一父未必是）或第一父，取第一个「`--first-parent` 计数 = 总数」的
 *      （= 拿掉合并提交之后历史单调，于是区间不含「已经并进起点又被再合一次」的提交）。
 *      都过不了才退回 `HEAD~1`，并**把这件事念出来** —— 静默换一个面比多说一句更贵。
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
   * `A..HEAD` 里「拿掉合并提交之后历史是否单调」（见文件头 ② 的口径）。
   *
   * @param {string} candidate 区间起点
   * @returns {boolean}
   */
  const monotonic = (candidate) => {
    if (candidate === "") {
      return false;
    }
    /** @param {string[]} args git 参数 */
    const count = (args) => gitOrEmpty(args).split("\n").filter(Boolean).length;
    const all = count(["rev-list", `${candidate}..HEAD`]);
    return all > 0 && all === count(["rev-list", "--first-parent", `${candidate}..HEAD`]);
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
      if (monotonic(candidate)) {
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
      return { before: face.firstParent, after: face.head };
    }
  }
  return adopted(parents);
}
