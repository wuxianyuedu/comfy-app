/**
 * `merge-state-report.mjs` — 合并态复算的报告与整批结论（从 `base-check.mjs` 拆出）。
 * @module base-check/merge-state-report — 整批结论 / 下一动作 / 合并态报告打印
 *
 * 拆出原因：base-check.mjs 第二次越过 900 行硬闸（ISSUE #4832 的清理健壮性
 * 加上去后 945 行）。这一簇自包含：只依赖 verdict.mjs 的 `judge` / `nextSteps`，
 * 与文件里其余的编排 / 落盘机制没有耦合。`base-check.mjs` 侧保留 re-export，
 * `tests/base-check.test.ts` 与各调用点的名字不变。
 */
import { judge, nextSteps } from "./verdict.mjs";

/** 合并态那一跑的报告打印（`--merge-state` 的可见出口）。
 *
 * @param {{json: boolean, summary: "current-green" | "inconclusive" | "merge-red" | "baseline-red" | "yours" | "load-flake", into: string, intoSha: string, headSha: string, rows: Array<{label: string, mergeCode: number | null, currentCode: number, verdict?: string, didNotRun?: string, mergeOutputTail?: string}>}} input
 */
export function printMergeStateReport({ json, summary, into, intoSha, headSha, rows }) {
  const tree = `${into}@${intoSha.slice(0, 8)} ⊕ HEAD ${headSha.slice(0, 8)}`;
  if (json) {
    process.stdout.write(`${JSON.stringify({ summary, tree, rows }, null, 2)}\n`);
    return;
  }
  for (const r of rows) {
    process.stdout.write(
      `  · ${r.mergeCode === 0 ? "绿" : r.verdict}  ${r.label}` +
        `（本检出 ${r.currentCode} / 合并态 ${r.mergeCode ?? "未跑"}）\n`,
    );
    if (r.didNotRun) {
      process.stdout.write(`      ↳ 没跑出结论：${r.didNotRun}\n`);
    }
  }
  process.stdout.write(`[base-check] 结论：${summary}（树：${tree}）\n`);
  for (const line of nextSteps(summary, { ref: into })) {
    process.stdout.write(`[base-check] ${line}\n`);
  }
  for (const r of rows) {
    if (!r.mergeOutputTail) {
      continue;
    }
    process.stdout.write(`[base-check] 「${r.label}」合并态输出末尾：\n`);
    process.stdout.write(
      `${r.mergeOutputTail
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n")}\n`,
    );
  }
}

/**
 * 一组行 → 整批的结论（纯函数，两向都能被用例钉住）。
 *
 * **优先级是 `inconclusive` 最高**，不是「有红就报红」：127 说明这一条**没跑起来**，
 * 而「没跑起来」与「跑了且红」在退出码上同形 —— 把整批结论落在它上面等于拿一个
 * 无法归因的读数下判决。
 *
 * `yours` 压过 `load-flake`：你自己引入的那条必须改代码，而负载假红只需要隔离复跑
 * 一次 —— 报成 `load-flake` 会让「有一条真红」这件事被一条抖动盖住（同下一条理由）。
 * `load-flake` 压过 `baseline-red`：混着一批「别线的红」时，若其中也有超时形态的，
 * 整批报 `baseline-red` 会让人把抖动一起登记进 `KNOWN_FAILED_FILES`。
 *
 * @param {Array<{currentCode: number, baseCode: number | null, output?: string, currentOutput?: string, baseOutput?: string, didNotRun?: string}>} rows
 * @returns {"current-green" | "inconclusive" | "baseline-red" | "yours" | "load-flake"}
 */
export function summarizeRows(rows) {
  if (rows.length === 0) {
    return "inconclusive";
  }
  /* 逐条全走同一份 `judge()`（ISSUE #2400）：0 码但「一条用例都没收集到」的行
   * 在 judge 里落 inconclusive，「段绿 + 逐条里混着一条没判的」在整批这里就折成
   * inconclusive（段码 2），不再只在 baseline-red 那一支才被读出来。 */
  const verdicts = rows.map((r) =>
    judge({
      currentCode: r.currentCode,
      baseCode: r.baseCode,
      /* 两个来源都收：行里显式给了 `currentOutput` 就用它，否则回落到
       * `output`（本检出那一次的全文，见上面 rows.push 的注释）。 */
      currentOutput: r.currentOutput ?? r.output,
      baseOutput: r.baseOutput,
    }),
  );
  if (verdicts.includes("inconclusive")) {
    return "inconclusive";
  }
  if (verdicts.every((v) => v === "current-green")) {
    return "current-green";
  }
  /* 混着「别线的红」与「你的红」时，**按更严重的那一档报**（`yours`）——
   * 别线的红可以就地收掉或登记，而你自己引入的那条必须改代码，两者都要人看见；
   * 报成 `baseline-red` 会让人以为整批都与自己无关。 */
  if (verdicts.includes("yours")) {
    return "yours";
  }
  if (verdicts.includes("load-flake")) {
    return "load-flake";
  }
  return "baseline-red";
}

/**
 * 整批结论的「下一动作」话术 —— 与单命令档同源（`nextSteps`），只在有红时点名是哪几条。
 * @param {"current-green" | "inconclusive" | "baseline-red" | "yours" | "load-flake"} summary
 * @param {Array<{label: string, verdict?: string}>} reds
 * @param {{ref: string}} context
 * @returns {string[]}
 */
export function nextStepsMany(summary, reds, { ref }) {
  if (summary === "current-green") {
    return nextSteps("current-green", { ref });
  }
  const head = reds.map((r) => `${r.label}（${r.verdict}）`);
  return [`红的那几条：${head.join("、")}。`, ...nextSteps(summary, { ref })];
}
