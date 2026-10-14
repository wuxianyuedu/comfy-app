import { ModelLibrary } from "~/components/model/ModelLibrary";

// 只写本页那一段：根布局的 title.template 会把「· Comfy-APP」补上
// （最终仍是「模型库 · Comfy-APP」），品牌统一在 `src/app/layout.tsx` 收口。
export const metadata = { title: "模型库" };

/**
 * 独立路由 `/models` —— 「模型库」这个界面的一个挂载点。
 *
 * 它只负责 `metadata`（`"use client"` 与 `export const metadata` 不能共存）
 * 与把实现挂上来；**页头在 `ModelLibrary` 里**，不在这一层 —— 见那个文件里
 * 为什么（`pageHeaderTitle` 是 client 侧的函数，server component 调不到它）。
 */
export default function ModelsPage() {
  return (
    <div className="py-6">
      <ModelLibrary />
    </div>
  );
}
