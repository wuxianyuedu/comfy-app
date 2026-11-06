/**
 * affected-launch-retry-scope.mjs —— 组 C 隔离复跑的**复跑面**：只重跑失败的那几份。
 *
 * 单独成文件的理由是那条长度硬闸背后的东西：`run-affected-tests.mjs` 里装着
 * 「分块 / 并发 / 负载判决 / 收尾」四件事，再塞第五件就会长到读不动，而这一层是
 * **被执行的那部分代码** —— 它读不动时的表现是「这条判据恒绿」，不是报错
 * （§12.6 R5 / §12.13，与话术层收成 `affected-launch-rerun-report.mjs` 是同一刀）。
 *
 * ## 为什么不能整块重跑
 *
 * 一版实现把 `...chunk` 原样再串行跑一遍，于是**一份**带超时指纹的文件会拖着整块
 * （实测 90~115 份）全部重跑：一次改了 `.cnb.yml` 的提交因此组 C **1411s**、全钩子
 * **1412s**（同一次里 A/B/D 只有 11.7s / 109.0s / 125.1s —— 整条钩子的时长几乎全是这一格）。
 * 负载假红本来只需要重测红的那几份；重跑其余已经绿过的文件**不增加任何证据**。
 *
 * 本地钩子的时长不是小事：超过几分钟，人的实际反应是 `--no-verify`，而那是这条链上
 * 唯一不能换的东西（§13.6 整节的前提就是「钩子必须拦得住」）。
 *
 * ## 单边化的三条退回
 *
 * 读不出失败名单的三种形态一律**退回整块**（没有账本目录 / 文件取不到 / 读数里一份失败
 * 都没有）。方向刻意只往「多跑」偏：漏跑一份真失败的文件，比多跑一百份绿的文件贵得多。
 * 判据强度、旗标、预算、结论档位都由调用点（`runChunk`）决定，这一层只回答「跑哪几份」。
 */
import { cFileXmlName, failingSuitesFromJunit } from "./precommit-timing.mjs";
import { readFileSync } from "node:fs";

/**
 * 算出第 2 遍该跑哪些文件。
 *
 * 名单与本次 chunk **取交集**、按**清单顺序**排：
 *   · 交集 —— junit 里出现陌生路径（复用旧文件、或一块多写的竞态）时把它加进来，
 *     等于跑一份不属于这块的用例，而那会改判据的分母（清单 ⇄ 读数对账是砍线的前提，
 *     见 `precommit-timing.mjs` 的 `collectFileTimings`）；
 *   · 清单顺序 —— 并行跑时 suite 的先后是**完成次序**，拿它当顺序会让同一份输入产出
 *     两条不同的命令行，而「分块不丢不重」与命令行长预算都有判据在数。
 *
 * @param {{chunk: string[], junitDir?: string, chunkId?: number, read?: (file: string, enc: string) => string}} input
 * @returns {{files: string[], why: string}} `why` 要说出口 ——「为什么这次跑了整块」必须读得出来
 */
export function retryScope(input) {
  const { chunk, junitDir = "", chunkId = 0, read = readFileSync } = input;
  if (!junitDir) {
    return { files: chunk, why: "没有账本目录（不在钩子里跑）⇒ 整块复跑" };
  }
  let xml;
  try {
    xml = read(cFileXmlName(junitDir, chunkId, 1), "utf8");
  } catch (error) {
    /* 只取 `code` 那一格：错误对象在本仓的类型口径下不是 `any`，而这一档要说出口的
     * 只有「为什么退回整块」，栈与消息都归不进那一行。 */
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : String(error);
    return {
      files: chunk,
      why: `第 1 遍的 junit 读数取不到（${code}）⇒ 整块复跑`,
    };
  }
  const failedSet = new Set(failingSuitesFromJunit(xml));
  const failed = chunk.filter((f) => failedSet.has(f));
  if (failed.length === 0) {
    return {
      files: chunk,
      why: "读数里没有本块的失败文件（崩在 suite 之前 / reporter 没记上）⇒ 整块复跑",
    };
  }
  return {
    files: failed,
    why: `只复跑 ${failed.length}/${chunk.length} 份失败的`,
  };
}
