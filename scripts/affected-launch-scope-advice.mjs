/**
 * `affected-launch-scope-advice.mjs` —— 「改动面归因」这一跳（收窄**代价**的读数）。
 *
 * ## 为什么单独一份
 *
 * 这一格有**两半**：`collectAttribute` 算归因、`scopeAdvice` 把归因排成给人读的话 ——
 * 它们从来是同一个问题的两个切面（「这次的面是哪个改动文件撑起来的」），所以住同一份。
 * 两半本来都在 `run-affected-tests.mjs` 里。那一层已经贴着 900 行硬闸（§12.6 R5），而越闸的形态不是报错，是
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
/* 「毫秒→秒」的格式归话术层（`affected-launch-rerun-report.mjs`）—— 抄一份的漂移形态是
 * 静默的：一处改了进位、另一处照旧，而同一次收尾里会同时出现两种写法。 */
import { fmtSec } from "./affected-launch-rerun-report.mjs";

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

/**
 * 「改动面偏大」这件事的**下限**（受影响份数，不含固定清单的那几十份）。
 *
 * 60 的出处是实测的分界（8 核、热缓存、机器空闲，同一份检出）：只加一个 changelog
 * 碎片是 77 份 / **28.3s**，改一个只被几处消费的组件（`sheet.tsx`，受影响 10 份）
 * 是 87 份 / ≈30s —— 这一档与「没改代码」没区别。而受影响 60 以上的那一档全部
 * 翻倍：`tooltip.tsx`（65）**142 份 / 57.7s**、`button.tsx`（106）**183 份 / 71.2s**、
 * `core/repository.ts`（134）**211 份 / 63.1s**。所以 60 落在「固定清单的一半」
 * 这个量级上，是这个仓库自己的数据划出来的，不是拍的一个整数。
 */
export const SCOPE_ADVICE_MIN = 60;

/**
 * 「这次改动面多大、该从哪一刀切」的收尾建议。
 *
 * **为什么需要它**：规范 §13.5.8.1 末尾那句「真正能让每次提交更快的是**把大改动拆小**」
 * 写了很久，却一直**没有执行者** —— 提交的人拿不到三件事：① 这次到底多大；
 * ② 这几十上百份里哪几份是**被哪一个改动文件**拉进来的；③ 拆完能省多少。
 * 没有这三件，「拆小」就只是口号，而口号不会有人照做。
 *
 * **为什么只提示、不阻断**：大改动有时**不可分**（一次接口重命名天然横跨几十个文件）。
 * 判据能说的只有「这次的面很大、代价是这个数、如果拆得开就这么拆」——把它变成阻断
 * 就是拿一个代价问题当正确性问题来判（与 §13.5.8.1「抬预算 / 抬并发都不成立」同一族的
 * 边界：**代价不许伪装成结论**）。
 *
 * ⚠️ 归因的数**不可加**：它给的是「单独改它一个会跑多少份」，不是「从总数里减掉多少」
 * （同一份测试常被多个改动文件共同拉到）。下面那句「去掉它 ≈ 剩多少」是**估算**，
 * 用 `总受影响 - 最大那个的 affected` 算出来、只会偏大 —— 这一点在规范与用例里都写死，
 * 不许把估算说成精确值。
 *
 * `elapsedMs` 可省：主干在**起 vitest 之前**就打（那时还拿不到墙钟），而「面有多大」
 * 这件事在真红时**更需要**被看到 —— 放在收尾打印的话，一条真断言红就会把它截断掉
 * （实测踩到过：探针触发 `check-dead-exports` 真红，整段建议一次都没印）。
 *
 * @param {{total: number, fixed: number, affected: number, elapsedMs?: number, top: {file: string, affected: number}[]}} input
 * @returns {string} 要打到 stderr 的正文
 */
export function scopeAdvice(input) {
  const { total, fixed, affected, elapsedMs, top } = input;
  const biggest = top[0];
  /** 去掉最大的那一刀之后还剩多少（估算，见上面那条不可加的口径）。 */
  const rest = biggest ? affected - biggest.affected : affected;
  const lines = [
    `[affected-launch] 改动面这件事：本次 ${total} 份用例（固定 ${fixed} + 受影响 ${affected}）` +
      (elapsedMs === undefined
        ? "。"
        : `，这一档实测墙钟 ${fmtSec(elapsedMs)}` +
          " —— 「不改代码」那一档（只加一个 changelog 碎片）约 28s。"),
    "  受影响面是按**反向 import 闭包**算的，所以一个被广泛 import 的文件会把面撑得很大；",
    "  这件事与「这次改动本身难不难」无关 —— 它是**代价**，不是判据，本行不阻断提交。",
  ];
  if (top.length > 0) {
    lines.push(
      "  本次把面撑起来的改动文件（各自**单独**改会跑多少份，不可相加）：",
      ...top
        .slice(0, 3)
        .map(
          (t) =>
            `    · ${t.file} → 受影响 ${t.affected} 份` +
            (t === biggest ? "（最大的一刀）" : ""),
        ),
    );
    if (rest > 0) {
      lines.push(
        `  ⇒ 这一刀如果能独立成一次提交，剩下约 ${rest} 份受影响（**估算**：同一份测试` +
          "可能被多个改动文件共同拉到，实际值只会比它小）—— 那一档≈固定清单的量级。",
      );
    }
  }
  lines.push(
    "  拆不动也没关系（一次接口重命名天然横跨很多文件）——只是每次提交都会付这个墙钟。",
    "  真要压并发：`COMFY_PRECOMMIT_MAX_WORKERS=1 git commit …`（只调并发，不碰任何判据）。",
    "  规范 §13.5.8.1 / §13.5.8.2「第六笔账」。",
  );
  return lines.join("\n") + "\n";
}
