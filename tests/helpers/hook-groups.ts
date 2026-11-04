/**
 * 读 `.githooks/pre-commit` 执行编排（组、组内 `run` 步骤）的共享件。三处判据（doc-check-hook-wiring / precommit-timing /
 * hook-affected-launch）各写一份解析必然漂成三个形状（§12.12 / §12.18）。口径：① 只认步骤行不认全文（`# ` 注掉后 `toContain`
 * 照样绿）；② 组正文按第一个闭合单引号收尾，块内禁单引号否则静默截断；③ 步骤行两空格缩进即真调用（立案见 `doc-check-hook-wiring` 文件头）。
 */
export type HookStep = { cmd: string; label: string };

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
