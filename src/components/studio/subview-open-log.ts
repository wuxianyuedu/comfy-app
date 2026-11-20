/**
 * 「子界面打开 / 页签切换」日志的统一出口（ISSUE #4580）。
 *
 * 顶层视图已有「界面打开：<屏> 耗时 <n>ms」（见 `./ViewOpenReport`，测量点在
 * 内容挂载）；但视图**内部**的动作 —— 在工作流库里点开一条详情、切详情页签、
 * 切设置分区 —— 原先不留痕，时间花在哪只能靠 `[trpc]` 的慢查询行反推。这里补
 * 同族的两条：
 *   · `子界面打开：<scope>·<name> 耗时 <n>ms` —— 点开视图内的一个子界面
 *     （工作流库 → 某条工作流的详情），耗时从点击到内容（含详情数据）就绪；
 *   · `页签切换：<scope>·<name> 耗时 <n>ms` —— 同一屏内切页签 / 分区，耗时
 *     从点击到切换提交完成（懒页签后续的分块下载不在这一段里，另由 Suspense
 *     的加载态呈现）。
 *
 * 耗时口径与「界面打开」一致：`performance.now()` 差取整毫秒。时刻一律在
 * **交互处理器**里取（渲染期读 `performance.now()` 违 react-hooks/purity），
 * 内容就绪侧在 effect / 回调里调 `logSubviewOpen` 落日志；同一次打开只落一条，
 * 由调用方把「已消费的时刻」清回 null 兜底。
 */

import { postAppRuntimeLog } from "~/lib/log/log-file-client";

/** 子界面动作的种类（日志动词，与「界面打开」同一面板同一通道）。 */
export type SubviewOpenKind = "子界面打开" | "页签切换";

/** 导航意图发生的那一刻 —— 在点击 / 切换处理器里调，返回值交给 `logSubviewOpen`。 */
export function markSubviewOpenStart(): number {
  return performance.now();
}

/** 内容就绪（挂载 / 数据落定）时落一条日志；负差值（时钟异常）按 0 记。 */
export function logSubviewOpen(
  kind: SubviewOpenKind,
  scope: string,
  name: string,
  openedAt: number,
  extra?: Record<string, unknown>,
): void {
  const durationMs = Math.max(0, Math.round(performance.now() - openedAt));
  void postAppRuntimeLog("app", "info", `${kind}：${scope}·${name} 耗时 ${durationMs}ms`, {
    kind,
    scope,
    name,
    durationMs,
    ...extra,
  });
}
