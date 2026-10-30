/**
 * 读 `.githooks/pre-commit` 的**执行编排**（组、组内 `run` 步骤）的共享件。
 *
 * 为什么单独成一份：三处判据问的是同一件事 —— 「某条判据此刻在不在门禁链里、在哪个组、
 * 命令逐字是什么」：
 *   · `tests/doc-check-hook-wiring.test.ts` 核「某几步在钩子里、且 flag 没被抹掉」；
 *   · `tests/precommit-timing.test.ts` 核「每个 `sh -c` 块都接了同一份计时」；
 *   · `tests/hook-affected-launch.test.ts` 核「C 组的正文真的敲的是那个启动器」。
 * 各写一份解析就会漂，而漂的表现不是红，是**同一份钩子在三个判据里长成三个形状**
 * （§12.12 / §12.18：抽共用件的那一侧要真有三个消费点，不是 preemptive 抽象）。
 *
 * 三条口径，缺一条判据就退化成「在注释上命中也算在场」：
 *   ① **只认步骤行**、不认全文 —— 有人把那行前头加个 `# ` 注掉，`toContain` 照样绿；
 *      立案现场见 `tests/doc-check-hook-wiring.test.ts` 的文件头。
 *   ② 组的正文取 `run_group <id> "…" sh -c '<正文>'` 里那段 shell，按**第一个闭合单引号**
 *      收尾。这条同时定义了「块内不许出现单引号」这个书写约束 —— 它是被解析器判出来的，
 *      不是靠人记住（引号混进来时该组会被**静默截断**，而判据读到的是半块）。
 *   ③ 步骤行的两空格缩进就是组内 shell 的形态，行首锚定即「真调用」。
 */
export type HookStep = { label: string; cmd: string };

/** 全文的 `  run "<标签>" <命令…>` 步骤行（**不分组** —— 门禁链的在场判据用它）。 */
export function runSteps(hookText: string): Array<HookStep> {
  return [...hookText.matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map((m) => ({
    label: m[1] ?? "",
    cmd: m[2] ?? "",
  }));
}

/**
 * 某个组的 `sh -c` 正文；解析不出来时返回 `""`（调用方**必须**自己判空 ——
 * 把「读不到」当成「那块里没有步骤」就是 §13.5.12 那一族的静默降级）。
 */
export function groupShBody(hookText: string, id: string): string {
  const re = new RegExp(`run_group ${id}\\s+"[^"]*"\\s+sh\\s+-c\\s+'([\\s\\S]*?)'`);
  return re.exec(hookText)?.[1] ?? "";
}

/** 某个组内的步骤行（= 组正文上的 {@link runSteps}）。 */
export function stepsInGroup(hookText: string, id: string): Array<HookStep> {
  return runSteps(groupShBody(hookText, id));
}

/** 剔掉正文里行首是 `#` 的行（「实调用体」而非「整块文本」）。 */
export function withoutCommentLines(body: string): string {
  return body
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .trim();
}
