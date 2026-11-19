import type React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ErrorBoundary } from "~/components/ui/error-boundary";
import { useLazyChunkFallback } from "~/components/ui/use-lazy-chunk-fallback";

/**
 * 懒加载分块失败的局部出口（判据与刷新在 `~/lib/shell/lazy-chunk-recovery`）。这条 story 看的是接线本身：同一子树与边界，分块错误时接管并给出真正的出路，业务错误时退回边界自己的降级 UI。
 * 必须真让它抛（Args 注不进 `fallback`）：配一个会抛的兄弟组件，由按钮选择抛哪种。分块失败 → 「这一块的前端文件没有加载上」+「重新加载页面」，注意没有「重试」（reset 重渲染同一棵树、哈希仍是旧的，必然再撞墙）；业务错误 → 不接管；文案点名是哪一块。
 * ⚠️ 这条 story 会故意在控制台留错误日志（子树真抛），那是现场、不是缺陷。
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
