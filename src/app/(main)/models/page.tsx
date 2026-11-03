import { ModelLibrary } from "~/components/studio/ModelLibrary";

// 只写本页那一段：根布局的 title.template 会把「· Comfy-APP」补上
// （最终仍是「模型库 · Comfy-APP」），品牌统一在 `src/app/layout.tsx` 收口。
export const metadata = { title: "模型库" };

/**
 * 独立路由 `/models` —— 「模型库」的挂载点，实现只有工作区那份 `studio/ModelLibrary`（浏览版已退役），
 * 地址栏直达与首页「去模型库」的落点不变。本页只给 `metadata`（`"use client"` 与 `export const metadata` 不能共存），
 * 页头在 `ModelLibrary` 里（`pageHeaderTitle` 是 client 侧函数，server component 调不到）；不在 `AppShell`，`ViewActions` 退化成屏内右对齐。
 */
export default function ModelsPage() {
  return (
    <div className="py-6">
      <ModelLibrary />
    </div>
  );
}
