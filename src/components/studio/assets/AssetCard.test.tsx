"use client";

/* 资产卡渲染优化回归（ISSUE #5198）：memo 包裹 + 回调上报 id。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AssetCard } from "./AssetCard";
import type { AssetListItem } from "./hooks/use-asset-library";

afterEach(cleanup);

const asset = {
  category: "character",
  createdAt: "2026-01-01T00:00:00.000Z",
  hasParams: true,
  height: 1024,
  id: "asset-1",
  localPath: "",
  mediaType: "image",
  name: "雨夜少女",
  projectId: null,
  prompt: "雨夜",
  scope: "public",
  subdir: "少女",
  width: 1024,
} satisfies AssetListItem & { createdAt: string };

function renderCard(onMove?: (id: string) => void, onRemove = vi.fn()) {
  return render(
    <AssetCard asset={asset} onMove={onMove} onOpenDetail={() => undefined} onRemove={onRemove} />,
  );
}

describe("AssetCard 渲染优化（ISSUE #5198）", () => {
  it("卡片经 memo 包裹，避免资产库全量重渲时逐卡重绘", () => {
    /* 经 memo 包裹的组件带 React 内部标记 $$typeof；渲染计数在 happy-dom
     * 下受 batching 影响不稳定，故用形态断言作防回归口径。 */
    expect("$$typeof" in AssetCard && AssetCard.$$typeof).toBe(Symbol.for("react.memo"));
  });

  it("删除 / 移动回调上报资产 id 而非整行对象", () => {
    const onMove = vi.fn();
    const onRemove = vi.fn();
    renderCard(onMove, onRemove);
    fireEvent.click(screen.getByLabelText(`删除资产 ${asset.name}`));
    expect(onRemove).toHaveBeenCalledWith(asset.id);
    fireEvent.click(screen.getByLabelText(`移动 ${asset.name} 到其他目录`));
    expect(onMove).toHaveBeenCalledWith(asset.id);
  });
});
