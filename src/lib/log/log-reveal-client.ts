/* ── 「点日志里的路径 → 在文件管理器里定位」的网络层（第②层）────────────
 *
 * 这里只做一件事：把候选路径交给 `setting.revealPath`，并把形状收窄成视图能直接
 * 消费的 `{ ok, detail }`。判据（认不认得出路径）在 `./log-path-tokens`，动作
 * （开哪个程序、闸门）在 `~/lib/shell/reveal-path` 与它的路由 —— 三处分职，
 * 各自有自己的用例。
 *
 * 为什么进 `lib` 而不是留在日志行组件里：视图层不得新增 IO（AGENTS.md 硬规则 10），
 * 而这一路是**本机外部动作**，失败必须有可见出口（硬规则 4）—— 那个出口需要一条
 * 能报错、能报成、能防重入的通道，正是 hook 该管的事（见 `use-reveal-log-path`）。
 */

import { errorText } from "~/lib/error-message";
import { vanillaApi } from "~/trpc/vanilla";

/** 打开动作的结果：`detail` 是**已可直接显示**的文案（成功也带，见硬规则 4）。 */
export interface RevealLogPathOutcome {
  ok: boolean;
  detail: string;
}

/**
 * 在文件管理器里定位一个从日志里扫出来的路径。
 *
 * 网络层失败（服务不可达 / 鉴权过期）转成同形状的失败结果而不是抛：调用方是
 * 一次点击，抛出去只会变成一个没人接的 unhandledRejection，用户看到的是
 * 「点了没反应」—— 正是本功能要消灭的那种体验。
 */
export async function revealLogPath(
  path: string,
): Promise<RevealLogPathOutcome> {
  try {
    const result = await vanillaApi.setting.revealPath.mutate({ path });
    return { ok: result.ok === true, detail: result.detail };
  } catch (error) {
    /* 失败文案的动作前缀走唯一出口（规范 16 §16.2.4.45）：这里手拼一份就是全库
     * 又一处「动作 + 冒号 + 详情」的两段式，改措辞要挨个找。 */
    return { ok: false, detail: errorText(error, "打开文件管理器失败") };
  }
}
