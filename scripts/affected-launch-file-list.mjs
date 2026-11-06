/**
 * `affected-launch-file-list.mjs` —— 日志预算的**另一半**：quiet 档下「跑了哪些用例」。
 *
 * ## 它补的是哪一格
 *
 * `affected-launch-log-budget.mjs` 把平台那一格的 reporter 从默认换成 `dot`（102400 字节的
 * 硬上限，见那份文件头）。代价实测过、也写在明处：`dot` **只打点**，而本仓常态的增量面是
 * 103 份固定清单 + 上百份受影响（实测一跑是 100 份上下），于是那屏日志里**一个文件名都没有**
 * —— 只剩 `Tests 1116 passed (1116)` 这类总数。于是「这次到底跑了哪些用例」这个问题在平台上
 * 不可答：绿了不知道自己守的是什么，红了想复跑那几份也得先猜。
 *
 * ## 三条口径
 *
 *   · **quiet 档才打**：不 quiet 时默认 reporter 已经逐文件打过了，再打一遍是双份 ——
 *     那一档本来就是「日志预算不够」才开的，重复打印是反方向；
 *   · **只打清单，永不为它多起一次 vitest**：这里拿的是**送进 vitest 的那一份清单**
 *     （`run-affected-tests.mjs` 里已经算好、分好块），不是从 junit 反读的实到结果。
 *     判据一个字不动 —— 这一档买的是可读性，不是第二份证据；
 *   · **行数封顶、超了要说出口**（`MAX_LISTED`）：清单本身也是日志预算的消耗方，
 *     一份几千条的改动面（改名 / 依赖升级）逐行打出来会把结论挤出去，而**那才是要读的东西**。
 *     截断必须念出来（打「只列前 N 份、另 M 份未列出」），不许静默少打 —— 「少打一份」
 *     与「少跑一份」在日志上长得一模一样，是本仓立案最狠的那一族。
 *
 * 单独成文件的理由与话术层那一刀相同（§12.6 R5 / §12.13）：机制层再塞第七件事就越过
 * 900 行硬闸，而越闸的形态不是报错，是「那一层读不动了」。
 */

/** 逐份清单最多打多少行（超出部分只念条数）。 */
export const MAX_LISTED = 200;

/**
 * 这一跑要跑的清单（quiet 档的收尾读数）。
 *
 * @param {string[]} files 本次真正交给 vitest 的用例路径（清单顺序，不是实到顺序）
 * @param {{quiet: boolean, max?: number}} input
 * @returns {string} 要打到日志里的正文；不 quiet 时是空串
 */
export function fileListReport(files, input) {
  if (!input.quiet) {
    return "";
  }
  /* 行数由调用点注入（用例给小的值就能钉住截断那一档）；不给或不合法就按封顶值。 */
  const raw = input.max;
  const max = typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : MAX_LISTED;
  const total = files.length;
  if (total === 0) {
    /* 空清单在这条链上**本来就不许发生**（`main` 会拦住它）。真到了这一句，说明清单是在
     * 那道守卫之后被清掉的 —— 那时唯一正确的话是「一份都没有」，不是空串。 */
    return "[affected-launch] 本次清单：0 份（空清单不该出现在这一档 —— 见启动器的空集守卫）\n";
  }
  const shown = files.slice(0, max);
  return (
    `[affected-launch] 本次清单：${total} 份用例（reporter 是 dot ⇒ 这 ${shown.length} 行是\n` +
    `  **这一跑跑了哪些**的唯一出处；不 quiet 时由默认 reporter 逐文件打，故此处不打）：\n${shown
      .map((f) => `    · ${f}\n`)
      .join("")}${
      total > shown.length
        ? `  ……另有 ${total - shown.length} 份未列出（日志预算；要完整清单就本地跑\n` +
          "    `node scripts/affected-tests.mjs` 或看 vitest 自己的默认 reporter）\n"
        : ""
    }`
  );
}
