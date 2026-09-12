/* ── ComfyUI 页签的打开决策（第②层：网络 + 壳交互）────────────────────
 * 视图（`use-settings-page.ts` 的「打开查看」）只消费本模块的返回值，
 * 不自己判 X-Frame-Options、不自己拼 iframe，也不直接 invoke 壳命令
 * （规范 17 §17.2）。
 *
 * 为什么决策要放在这一层而不是视图里：**宿主页根本判不出来**。
 * ComfyUI 与应用不同源（端口不同即跨源），iframe 里的 `error` / `load`
 * 事件都不带失败原因，被 `X-Frame-Options: DENY` 拒绝与「页面确实是空的」
 * 在 JS 里长得一样；控制台只会留一句浏览器自己发的
 * 「已阻止此内容。请与网站所有者联系以解决此问题。」——用户看到的就是
 * 一张空白页签（ISSUE #310 三次回归的现场）。所以「能不能嵌」必须由
 * 服务端探测（`setting.comfyEmbeddable`）回答。
 *
 * 兜底链：可嵌 → 内嵌页签；不可嵌且在壳内 → 壳内独立窗口（Rust
 * `open_comfyui_window`，仍在同一应用里）；其余 → 系统浏览器。
 */

import { vanillaApi } from "~/trpc/vanilla";

import { isDesktopShell, openUrlInShell } from "./desktop-shell-client";

/** 打开 ComfyUI 的结果：`target` 说明最终去了哪里，`detail` 可直接展示。 */
export type OpenComfyTabResult = {
  /** 最终打开方式。 */
  target: "embed" | "shell-window" | "browser";
  /** 内嵌时可用的 URL（`target === "embed"` 时非空）。 */
  embedUrl: string | null;
  /** 可直接展示给用户的说明。 */
  detail: string;
};

/**
 * 打开 ComfyUI 页签。
 *
 * @param base        运行中 ComfyUI 的地址（设置页状态里已探好的 base）
 * @param hostOrigin  应用自身的源（`window.location.origin`）
 */
export async function openComfyTab(
  base: string,
  hostOrigin: string,
): Promise<OpenComfyTabResult> {
  const inShell = isDesktopShell();
  const verdict = await vanillaApi.setting.comfyEmbeddable
    .query({ base, hostOrigin })
    .catch(() => ({ embeddable: false, reason: "内嵌策略探测失败" }));

  if (verdict.embeddable) {
    return {
      target: "embed",
      embedUrl: base,
      detail: `已在页签中打开 ComfyUI（${base}）`,
    };
  }

  // 不可嵌：壳内退到独立窗口（仍是本应用的一部分），否则交给系统浏览器。
  if (inShell) {
    const r = await openUrlInShell(base);
    return {
      target: "shell-window",
      embedUrl: null,
      detail: r.ok
        ? `ComfyUI 不允许被内嵌（${verdict.reason}），已在应用内的独立窗口中打开`
        : `${r.detail}（原因：${verdict.reason}）`,
    };
  }
  return {
    target: "browser",
    embedUrl: null,
    detail: `ComfyUI 不允许被内嵌（${verdict.reason}），已改用系统浏览器打开`,
  };
}
