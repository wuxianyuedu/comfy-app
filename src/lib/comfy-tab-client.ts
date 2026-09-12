/* ── ComfyUI 页签的打开决策（第②层：网络 + 壳交互）────────────────────
 * 视图（`use-settings-page.ts` 的「打开查看」）只消费本模块的返回值，
 * 不自己判响应头、不自己拼 iframe，也不直接 invoke 壳命令（规范 17 §17.2）。
 *
 * 目标形态（ISSUE #310 用户明确要求）：**点「打开查看」只出多页签，不弹第二个
 * 窗口**。所以本模块只回两种结果——能嵌就内嵌，判定不能嵌也仍然在**同一个
 * 页签**里渲染一张应用内的可见说明（成因 + 修复动作），不从这条路径退到壳内
 * 独立窗口。
 *
 * 注：设置页另有一个**并列**的「在浏览器打开」按钮（`setting.comfyOpen` →
 * `src/lib/comfyui/lifecycle.ts` 的 `openComfyUi`），那是用户主动点的另一条
 * 出口（放大看 / 装插件 / 多屏），与这里「打开查看 → 页签」互不替代。
 * 这条决策路径本身仍然不碰系统浏览器。
 *
 * 为什么「能不能嵌」要在服务端探：跨源读不到响应头，iframe 的 error/load
 * 事件都不带失败原因 —— 被拒绝与「页面确实是空的」在 JS 里长得一样，
 * 用户看到的只有一片空白。判据在 `comfy-embed.ts`，经 tRPC
 * `setting.comfyEmbeddable` 暴露。
 *
 * 正常情况下这里应该总是 `embed`：ComfyUI 是本应用 spawn 的，启动参数带了
 * `--enable-cors-header`，跨源不再被 origin-only 中间件拦 403。`blocked`
 * 只出现在「外部启动的实例不受本应用参数控制 / 用户手填参数覆盖」时。
 */

import { vanillaApi } from "~/trpc/vanilla";

/** 打开 ComfyUI 的结果：`target` 说明最终形态，`detail` 可直接展示。 */
export type OpenComfyTabResult = {
  /** 最终形态：内嵌页签 / 页签内阻止说明（两者都在应用内，不弹窗）。 */
  target: "embed" | "blocked";
  /** 内嵌时可用的 URL（`target === "embed"` 时非空）。 */
  embedUrl: string | null;
  /** 可直接展示给用户的说明（含不可嵌时的修复动作）。 */
  detail: string;
};

/**
 * 决定 ComfyUI 页签怎么打开。
 *
 * @param base        运行中 ComfyUI 的地址（设置页状态里已探好的 base）
 * @param hostOrigin  应用自身的源（`window.location.origin`）
 */
export async function openComfyTab(
  base: string,
  hostOrigin: string,
): Promise<OpenComfyTabResult> {
  const verdict = await vanillaApi.setting.comfyEmbeddable
    .query({ base, hostOrigin })
    .catch(() => ({
      embeddable: false,
      reason: "内嵌策略探测失败（未能问到服务端结论）",
    }));

  if (verdict.embeddable) {
    return {
      target: "embed",
      embedUrl: base,
      detail: `已在页签中打开 ComfyUI（${base}）`,
    };
  }

  // 不可嵌也留在页签内：页签本身照常打开，只是内容换成可读的说明。
  return {
    target: "blocked",
    embedUrl: null,
    detail: `ComfyUI 未放行跨源内嵌（${verdict.reason}）`,
  };
}
