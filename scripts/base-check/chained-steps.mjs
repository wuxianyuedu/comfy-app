/**
 * chained-steps.mjs — **挂在 `--base` 这批里、但不在钩子步骤上的**判据
 * （`base-check.mjs` 的「第二个来源」，规范 §13.6.2 / ISSUE #1605）。
 *
 * ── 为什么要单独一份 ──────────────────────────────────────────────────
 *
 * `resolveMergeBatch()` 的面本来是**从 `.githooks/pre-commit` 的步骤行现算**的
 * （§13.6.2 那条「面从哪来」）。而有一族判据**天然进不了钩子**、理由与「代价高」
 * 无关 —— 是**本地看不到那个形态**：
 *
 *   · 首发成员 `scripts/check-commit-claims.mjs`（「提交信息里的声明 ⇄ 那次提交的
 *     事实」，11 §11.23.5）判的是**某一次提交**的树（「§x.y 照旧保留」），而丢失
 *     发生在**平台侧 squash** 那一刻 —— 实测 `ad81a912` / `bdabd26f` / `b9bedd37`
 *     在 `master` 上都是**单亲**、提交信息里却带 `Merge origin/master into …` 字样，
 *     所以 `check-merge-parents`（§13.6.1，判「声明是合并就必须真有两个父」）在
 *     squash 之后**判不出来**：单亲是它的**正常形态**。
 *   · 硬塞进钩子只会让人学会绕开它（§13.6.2 的边界原话）。
 *
 * 它单独成模块、而不是长在 `base-check.mjs` 里，有一条**具体的**理由：
 * `scripts/.tsc-diagnostic-executors.json` 把 `base-check.mjs` 的**声明行数**当
 * 零增量棘轮管（§13.5.14）—— 在那份文件里新写一处 JSDoc / 类型注解，就得回答
 * 「它由谁执行、谁来敲」，而这一族的答案在**别处**（`--base` 那条链）。写在同目录
 * 的这份模块里，棘轮的**对象与答案才落在同一个地方**（同 §12.5.3 对目录归属的口径）。
 *
 * ── 两条口径（都不许省）────────────────────────────────────────────────
 *
 * **① `baseSide: false`** —— 这一条**不在基线那一侧跑**：它的对象是**本检出这条线上**
 * 的提交对象，而基线快照是一个**不含那些提交**的干净上游（两侧问的根本不是同一个问题，
 * 同 `resolveMergeBaseRef` 那段「两个问题」）。不排除的后果实测过：新判据在基线上必然
 * `MODULE_NOT_FOUND` ⇒ 127 ⇒ `summarizeRows` 的优先级把**整批**压成 `inconclusive`
 * （「拿一个无法归因的读数下判决」），而这一批里其它几十条判据的读数本来是好的。
 *
 * **② 判的是 `<ref>..HEAD`** —— 与 `--base` 问的「并进去之后会不会红」同源；没有待并
 * 提交时给空，不报假红。
 *
 * ── 事实从哪来 ────────────────────────────────────────────────────────
 *
 * 从下面 `CHAINED_STEPS` 那一份清单现算（`scripts/.on-demand-duties.json` 里对应行的
 * `fact.kind` 是 `base-check-chained`，由 `check-on-demand-duties.cjs` 双向核对 ——
 * **它读的就是这个文件里的 `const script = "…"`**，不另抄第二份）。
 */
import fs from "node:fs";
import path from "node:path";

/**
 * 这一族的成员表 —— **唯一一份清单**（别的判据按形状读它，不手抄）。
 *
 * `script` 的写法是**约定的**：`check-on-demand-duties.cjs` 按 `const script = "…"`
 * 这个形状现算「有哪些成员」，好与 `.on-demand-duties.json` 的登记**双向**核对
 * （新增一条却忘了登记 ⇒ 当场红）。改这个形状要同批改那一边。
 */
export const CHAINED_STEPS = [
  { script: "scripts/check-commit-claims.mjs" },
];

/**
 * 把这一族展开成 `resolveMergeBatch` 的 `{argv, label, baseSide}` 条目。
 *
 * **不复算「该不该有这一条」** —— 那一半归各成员自己（`check-commit-claims.mjs`
 * 在没提交可核时报 0 次提交、退出 0）；这里只管「在不在、跑哪个范围」。
 *
 * @param {object} deps
 * @param {string} deps.root 本检出根目录
 * @param {() => (string | null)} deps.resolveBaseRef 「要并进去的那条」引用
 * @param {(args: string[]) => {ok: boolean, stdout: string}} deps.git 跑一条只读 git
 * @returns {Array<{argv: string[], label: string, baseSide?: boolean}>}
 */
export function chainedSteps({ root, resolveBaseRef, git }) {
  const ref = resolveBaseRef();
  if (!ref) return [];
  const range = `${ref}..HEAD`;
  /* 没有待并提交 ⇒ 这一族无事可问：给空，不造一条恒绿的假行。 */
  const count = git(["rev-list", "--count", range]);
  if (!count.ok || Number(count.stdout) === 0) return [];
  return CHAINED_STEPS.filter((s) =>
    fs.existsSync(path.join(root, s.script)),
  ).map((s) => ({
    argv: ["node", s.script, "--range", range],
    label: `提交信息里的声明 ⇄ 事实（${range}）`,
    baseSide: false,
  }));
}
