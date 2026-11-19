import { UIKitGallery } from "~/components/ui/ui-kit-gallery";

// 只写本页那一段：根布局的 title.template 会把「· Comfy-APP」补上
// （最终是「UI 控件总览 · Comfy-APP」），品牌统一在 `src/app/layout.tsx` 收口。
export const metadata = { title: "UI 控件总览" };

/**
 * 独立路由 `/ui-kit`（ISSUE #3525）—— UI 控件总览的挂载点：把全部基元摆到
 * 同一屏上检查明暗两态的颜色 / 背景错档。实现只有 `ui/ui-kit-gallery` 一份，
 * 这里只给 metadata（`"use client"` 与 `export const metadata` 不能共存）。
 * 与 `/models` 同形：地址栏直达，不在工作区导航里占位；应用内入口走命令面板。
 */
export default function UiKitPage() {
  return <UIKitGallery />;
}
