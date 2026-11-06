/* ── 拉起流程 → 运行态变化通知的收口（lifecycle 的薄件）────────────────
 *
 * 为什么单独一份：`lifecycle.ts` 是仓库里最大的几个模块之一，已经贴着文件长度
 * 硬闸（见 `docs/standards/12-代码组织与文件结构.md` §12.6），而这四处通知是
 * **措辞**而不是**判决** —— 它们是「这份代码在哪一刻知道运行态变了」的登记，
 * 放回主文件只会把它推过阈值。同理，措辞集中在这里也避免了同一句话在启动 /
 * 就绪 / 失败三个分支里各写一遍。
 *
 * 语义：**只说「变了」，不说「变成了什么」**。真正的结论由设置页重问状态得出
 * （`setting.comfyStatus` 四态）—— 这里若也下结论，就成了第一个会漂的第二判据。
 */
import { noteComfyStateChange } from "./state-watch";

/** 用户点了「启动 ComfyUI」（或自动启动被放行）：运行态从这一刻起就在变。 */
export function noteComfyStartRequested(): void {
  noteComfyStateChange("start", "用户启动了 ComfyUI");
}

/**
 * 拉起流程走完了。
 *
 * `ok` 为真 ↔ 流程拿到了可用的 base（真正就绪）；否则只说明「这次启动的等待
 * 结束了」—— 超时 / 报错 / 被闩锁拦下都算。**刻意不细分原因**：设置页会立刻
 * 重问一次状态，那边给出的四态才是用户看到的东西，这里细分成因只会变成第二份
 * 会漂的文案（而且它没有出口 —— 通知的载荷只有一个说明串，本来就不打算展示）。
 */
export function noteComfyLaunchSettled(ok: boolean): void {
  if (ok) {
    noteComfyStateChange("ready", "ComfyUI 已就绪");
    return;
  }
  noteComfyStateChange("start", "本次启动已结束（未探明就绪）");
}

/** 用户点了「关闭 ComfyUI」。`ok` 为假 = 关不干净，但那同样是一次状态变化
 *  （状态行会从「关闭中…」落到别的结论上），所以两条分支都要通知。 */
export function noteComfyStopRequested(ok: boolean): void {
  noteComfyStateChange("stop", ok ? "用户关闭了 ComfyUI" : "关闭命令已发送，实例仍在响应");
}
