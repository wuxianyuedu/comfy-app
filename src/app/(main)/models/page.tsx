import { ModelLibrary } from "~/components/studio/ModelLibrary";

// 只写本页那一段：根布局的 title.template 会把「· Comfy-APP」补上
// （最终仍是「模型库 · Comfy-APP」），品牌统一在 `src/app/layout.tsx` 收口。
export const metadata = { title: "模型库" };

/**
 * 独立路由 `/models` —— 「模型库」这个界面的一个挂载点。
 *
 * 此前这一页挂的是 `components/model/` 下的**浏览版**实现（卡片网格 + 详情
 * 弹窗），与工作区「模型」视图（管理版）两套并存、能力不同。定性退役浏览版
 * 之后，本页改挂工作区那份实现，模型库从此只有 `studio/ModelLibrary` 一份
 * 实现；地址栏直达与首页「去模型库」链接的落点不变。
 *
 * 它只负责 `metadata`（`"use client"` 与 `export const metadata` 不能共存）
 * 与把实现挂上来；**页头在 `ModelLibrary` 里**，不在这一层 —— 见那个文件里
 * 为什么（`pageHeaderTitle` 是 client 侧的函数，server component 调不到它）。
 *
 * 本页不在 `AppShell` 里、没有顶栏：`ViewActions` 会退化成屏内右对齐一行
 * （该组件为无壳路径留了退化形态），「模型目录配置」与搜索照常可用。
 */
export default function ModelsPage() {
  return (
    <div className="py-6">
      <ModelLibrary />
    </div>
  );
}
