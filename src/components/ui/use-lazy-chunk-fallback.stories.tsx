import type React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { ErrorBoundary } from "~/components/ui/error-boundary";
import { useLazyChunkFallback } from "~/components/ui/use-lazy-chunk-fallback";

/**
 * 懒加载分块失败的**局部出口**（判据与刷新在 `~/lib/shell/lazy-chunk-recovery`）。
 *
 * 它是一段接线，不是一个长得好看的组件 —— 这条 story 要看的正是**接线本身**：
 * 同样的子树、同样的边界，抛的是分块错误时它接管并给出真正的出路，
 * 抛业务错误时它不接管（退回边界自己的降级 UI）。
 *
 * ## 为什么必须真让它抛
 *
 * `fallback` 只有子树真的抛错时才渲染，Args 面板注不进去 —— 与
 * `ErrorBoundary` 那条 story 同款补法：配一个会抛的兄弟组件，由按钮选择抛哪一种。
 *
 * ## 三件事值得单独看
 *
 * 1. **分块失败** → 「剧本工具 · 这一块的前端文件没有加载上」+「重新加载页面」。
 *    注意**没有**「重试」：边界自己的重试会重渲染同一棵树、手里的分块哈希还是旧的，
 *    必然再撞同一堵墙。这是本条 story 存在的全部理由。
 * 2. **业务错误** → 不接管，退回「组件渲染出错 + 重试」。
 * 3. **文案里点名是哪一块**：工坊六段各有各的边界，只说「加载失败」等于让用户
 *    在六个卡片里自己找。
 *
 * ⚠️ 这条 story 会**故意**在控制台留错误日志（子树真抛），那是它的现场、不是缺陷。
 */
const meta = {
  title: "UI/UseLazyChunkFallback",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

/** 分块**真被换掉**时的那条错误（现场原句，Turbopack dev）。 */
function chunkFailure(): Error {
  const err = new Error(
    "Failed to load chunk /_next/static/chunks/src_abc123._.js from module [project]/src/components/workshop/ScriptGenerator.tsx [app-client] (ecmascript, async loader)",
  );
  err.name = "ChunkLoadError";
  return err;
}

/** 一个总是抛错的子树（`throw` 在渲染期）。 */
function Boom({ error }: { error: Error }): React.ReactNode {
  throw error;
}

/** 一个形状齐全的「懒加载卡片」，只差真去 `import()`。 */
function LazyCard({ error }: { error: Error }) {
  const fallback = useLazyChunkFallback("剧本工具");
  return (
    <div className="w-xl">
      <ErrorBoundary fallback={fallback}>
        <Boom error={error} />
      </ErrorBoundary>
    </div>
  );
}

export const ChunkFailure: Story = {
  parameters: { test: { dangerouslyIgnoreUnhandledErrors: true } },
  render: () => <LazyCard error={chunkFailure()} />,
};

export const BusinessErrorNotTakenOver: Story = {
  parameters: { test: { dangerouslyIgnoreUnhandledErrors: true } },
  render: () => <LazyCard error={new Error("数据库表不存在")} />,
};
