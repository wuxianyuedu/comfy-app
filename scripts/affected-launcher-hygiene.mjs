/**
 * affected-launcher-hygiene.mjs — 受影响用例的判据 ⑤：编排器产物清单判据（ISSUE #3812）。
 *
 * `tests/dist-artifact-hygiene.test.ts` 对编排器闭包成员（`db-backup-core.mjs` /
 * `launcher-core/*` …）的消费是**运行时读文本解析**，静态 import 图追不到；改动命中
 * 闭包成员、或判据直接读文本的两份本体（`check-standalone-contents.cjs` /
 * `build-desktop.mjs`）时，把这份判据带进增量面 —— 否则「新增内部分件漏登记
 * `RUNTIME_SCRIPTS`」会以同一形态反复漏出去（#3732 那批就是这样落到主干的）。
 * 从 `affected-tests.mjs` 拆出的直接原因：该文件撞基础设施层 900 行硬闸
 * （§12.6 R5 姊妹档），出口只有一个：按职责拆。
 */
import { collectLauncherScriptClosure } from "./launcher-closure.mjs";
import { normalizeRel } from "./git-name-status.mjs";

/** 判据用例在增量面里的落点。 */
export const LAUNCHER_HYGIENE_TEST = "tests/dist-artifact-hygiene.test.ts";

/**
 * 判据**直接读文本 / require** 的两份本体（`standalone-private-inputs.mjs` 走静态
 * import，反向 import 闭包已覆盖，不在此列）。
 */
const LAUNCHER_HYGIENE_SOURCES = new Set([
  "scripts/check-standalone-contents.cjs",
  "scripts/build-desktop.mjs",
]);

/**
 * @param {string} rel 归一后的改动路径
 * @param {Set<string> | null} launcherClosure 编排器闭包成员（相对仓库根；null = 没算，判据不生效）
 * @param {(rel: string, why: string) => void} add 受影响面的登记口（`resolveAffectedTests` 的 `add`）
 * @returns {void}
 */
export function noteLauncherHygiene(rel, launcherClosure, add) {
  if (launcherClosure?.has(rel) || LAUNCHER_HYGIENE_SOURCES.has(rel)) {
    add(LAUNCHER_HYGIENE_TEST, "编排器产物清单判据");
  }
}

/**
 * 只有改动面真命中 `scripts/*.mjs` 才算编排器闭包（读几十个文件，按需付这个成本）。
 * @param {string[]} changed 改动路径（逐条归一后判）
 * @returns {Set<string> | null}
 */
export function launcherClosureIfNeeded(changed) {
  return changed.some((p) => /^scripts\/.+\.mjs$/.test(normalizeRel(p)))
    ? collectLauncherScriptClosure()
    : null;
}
