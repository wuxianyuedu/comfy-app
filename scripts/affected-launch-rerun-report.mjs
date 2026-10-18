/**
 * `affected-launch-rerun-report.mjs` —— 组 C 那条判决链走完之后**给人看的账**
 * （规范 §13.5.8.2.1 / §13.6.4.1）。
 *
 * 为什么单独一份：`run-affected-tests.mjs` 是**机制层**（算清单、分块、起 vitest、
 * 判超时指纹、决定复不复跑），这里的三段是**话术层** —— 把已经定完的结论排成读数。
 * 混在一处的代价不是「长」，而是 §12.6 R5 那句：这一层长到读不动时的表现是
 * 「这条判据恒绿」而不是报错。拆开后两边各自可测，机制层也回到 900 行以内。
 *
 * 三段都是**纯函数**：入参是调用点已经算好的东西（文件清单 / 每块的判决记录 / 预算），
 * 不读盘、不起进程、不读时钟 —— 于是用例能逐字钉住每一档文案
 * （`tests/hook-affected-launch.test.ts`）。
 */

/**
 * 毫秒收成「12.3s」这一档的人读时长（本模块两处以上要这个形状，所以收成一函数）。
 *
 * @param {number} ms
 * @returns {string}
 */
export function fmtSec(ms) {
  return `${(Number(ms) / 1000).toFixed(1)}s`;
}

/**
 * 「未校验」那一档的收尾报告（纯函数，可被用例逐字钉住）。
 *
 * 为什么单独抽出来：这一档**放行**，所以它的唯一产物就是**这段话**。
 * 如果它没印出来（或印得含糊），放行就退化成「静默通过」—— 那正是这一档最坏的
 * 失效形态（同 §11.23「声明与读者」那一族：写了没有读者等于没写）。
 *
 * @param {string[]} files 这次没被校验到的用例路径
 * @returns {string}
 */
export function unverifiedReport(files) {
  return (
    `[affected-launch] **未校验**：${files.length} 份用例在隔离复跑之后仍然只是\n` +
    "  「机器太满、给不出可信读数」—— 这一档**既不是绿也不是红**，本次提交放行，\n" +
    "  但下面这些文件这次没有被验证过：\n" +
    files.map((f) => `    · ${f}\n`).join("") +
    "  机器空下来后请自己复验一次：\n" +
    "    node scripts/run-affected-tests.mjs --full\n" +
    "  （或直接跑 vitest 入口、带上 `--no-file-parallelism` 与那几份文件。）\n"
  );
}

/**
 * 一次判决链走完之后的**账**：这一次总共等了多久、放行的是第几遍测出来的、
 * 放行时它到底是绿还是「未校验」（纯函数，可被用例逐字钉住）。
 *
 * 为什么要有这一段：把「重测」机器化之后，读数只剩在 stderr 的散落行里 —— 被放行（或被
 * 拦下）的人回答不出那三个问题，而**「负载假红」与「真回归」在人嘴里的分界就是这三个问题**。
 * 放行的一档如果只有散落行，等于这一档没有结论（同 §11.23「写了没有读者等于没写」）。
 *
 * 三条口径：
 *   ① **一块都没复跑时返回空串** —— 绿的那一大半不该为这段账付输出
 *      （同 §13.5.8「面小时连归因都不去算」）；
 *   ② 「放行」与「通过」不许混写：负载假红那一格是「同一批用例在更隔离条件下重测的结果」，
 *      未校验那一格是「这次没测到」；
 *   ③ 等待预算是**整次提交一份**（逐块计就是 5 分钟 × N，实测 8 块 31 分钟，ISSUE #1747），
 *      所以报「累计 / 预算」两个数，而不是只报累计。
 *
 * @param {Array<{outcome: string, waitedMs?: number, settled?: boolean}>} attempts 每一块一条
 * @param {{budgetMs: number}} budget 整次提交那份等待预算
 * @returns {string} 要打到 stderr 的正文；一块都没复跑时是空串
 */
export function rerunReport(attempts, budget) {
  const reran = attempts.filter(
    (a) => a.outcome !== "first-green" && a.outcome !== "red-no-fingerprint",
  );
  if (reran.length === 0) return "";
  /** @type {(outcome: string) => number} */
  const count = (o) => attempts.filter((a) => a.outcome === o).length;
  const waitedMs = reran.reduce((a, r) => a + (r.waitedMs ?? 0), 0);
  const noSettle = reran.filter((r) => r.settled === false).length;
  return (
    "[affected-launch] 本次的等待与复跑账：\n" +
    `  共 ${attempts.length} 块：第 1 遍直接绿 ${count("first-green")} 块，` +
    `红而不带超时指纹（真红，一次都不复跑）${count("red-no-fingerprint")} 块，` +
    `带指纹复跑 ${reran.length} 块。\n` +
    `  等待累计 ${fmtSec(waitedMs)} / 预算 ${fmtSec(budget.budgetMs)}` +
    `（**整次提交一份**，不是每块一份）；没等到回落 ${noSettle} 块` +
    "（等待只是优化，不改变结论）。\n" +
    `  **第 2 遍**的结果：负载假红放行 ${count("rerun-green")} 块、` +
    `**未校验**（仍然只是超时形态）${count("rerun-unverified")} 块、` +
    `真红 ${count("real-red")} 块。\n` +
    "  ⚠️ 「放行」不等于「通过」：前者是同一批用例在更隔离条件下重测的结果，" +
    "后者是这次**没测到**（已逐条点名哪几份）。\n"
  );
}
