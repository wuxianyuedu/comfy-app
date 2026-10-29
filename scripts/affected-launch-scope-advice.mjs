/**
 * `affected-launch-scope-advice.mjs` —— 「改动面归因」这一跳（收窄**代价**的读数）。
 *
 * ## 为什么单独一份
 *
 * 它本来住在 `run-affected-tests.mjs` 里（与 `scopeAdvice` 同一格：一个算归因、一个排
 * 成给人读的话）。那一层已经贴着 900 行硬闸（§12.6 R5），而越闸的形态不是报错，是
 * 「那一层读不动了」—— 判据恒绿那种失效正是从读不动开始的。拆法与话术层、复跑面、
 * 日志预算同一刀：**只搬位置，判据一个字不改**。
 *
 * ## 它答的问题
 *
 * 「这次的受影响面里，每一份是被哪个改动文件拉进来的」—— 给「把大改动拆小」那条建议
 * 用的（`scopeAdvice` 的入参 `top`）。它是**纯提示**：不改清单、不参与筛选、不影响退出码。
 * 拿不到就回空数组，绝不让一个提示把整条链崩掉。
 *
 * ## 两条不肯让步的形状
 *
 *   · **改动面要一起送过去**（ISSUE #2240 的第三格）：送的是 `COMFY_AFFECTED_CHANGED`
 *     那一份，不是让 `affected-tests.mjs` 自己去读暂存区 —— 平台侧没有暂存区，那样
 *     归因在平台上**恒为空**（那条「拆小」建议在平台上从来没生效过，只影响提示）；
 *   · **失败要出声**：拿不到归因就打一行 stderr（「仅影响下面那条建议，不影响本次判定」）。
 *     静默吞掉会让「归因从来没成功过」这件事没人知道（同 §11.23「声明 ⇄ 读者」那族）。
 *
 * 载体（stdin 而不是 argv）与「改动面从哪读」都由 `affected-launch-changed-list.mjs`
 * 拥有 —— 本模块借它的 `spawnAffected`，不另抄一份命令行形状，也**不另读一遍**
 * `COMFY_AFFECTED_CHANGED`（读法抄两份的漂移形态是静默的：一侧照常跑、另一侧从此
 * 拿不到归因）。
 */
import process from "node:process";

import {
  changedFromEnv,
  spawnAffected,
} from "./affected-launch-changed-list.mjs";

/**
 * 调 `affected-tests.mjs --attribute` 拿「每个改动文件各自影响多少份」。
 *
 * @returns {Array<{file: string, affected: number}>}
 */
export function collectAttribute() {
  const res = spawnAffected(["--attribute"], changedFromEnv());
  if (res.status !== 0) {
    process.stderr.write(
      "[affected-launch] 改动面归因拿不到（仅影响下面那条建议，不影响本次判定）\n",
    );
    return [];
  }
  try {
    const parsed = JSON.parse(String(res.stdout ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error("不是数组");
    return parsed;
  } catch {
    process.stderr.write(
      "[affected-launch] 改动面归因输出读不懂（仅影响下面那条建议）\n",
    );
    return [];
  }
}
