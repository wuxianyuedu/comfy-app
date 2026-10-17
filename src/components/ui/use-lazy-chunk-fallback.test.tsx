// @vitest-environment jsdom
/**
 * 分块失败降级的**接线**判据（判定本身在 `~/lib/shell/lazy-chunk-recovery` 的单测里）。
 *
 * 这里只钉两件事，它们都是「静默地错」的方向：
 *   · 分块失败 → 必须出现一个**真能出去**的动作（「重新加载页面」），而不是
 *     一句「重试」——`reset()` 重渲染的是同一棵树、手里的哈希还是旧的那份，
 *     重试必然再撞同一堵墙；
 *   · 其它异常 → 交回 `ErrorBoundary` 自己的降级 UI，不能被说成「文件没加载上」。
 */
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { ErrorBoundary } from "./error-boundary";
import { useLazyChunkFallback } from "./use-lazy-chunk-fallback";

afterEach(cleanup);

function chunkFailure(): Error {
  const err = new Error(
    "Failed to load chunk /_next/static/chunks/src_1w9lw22._.js from module [project]/src/components/workshop/ScriptGenerator.tsx [app-client] (ecmascript, async loader)",
  );
  err.name = "ChunkLoadError";
  return err;
}

/** 一个总是抛错的懒加载替身（`throw` 在渲染期，正是边界接的那一类）。 */
function Boom({ error }: { error: Error }): React.ReactNode {
  throw error;
}

function Panel({ error }: { error: Error }) {
  const fallback = useLazyChunkFallback("剧本工具");
  return (
    <ErrorBoundary fallback={fallback}>
      <Boom error={error} />
    </ErrorBoundary>
  );
}

describe("useLazyChunkFallback — 分块失败的局部出口", () => {
  it("分块失败 → 说明是哪一块没加载上，并给「重新加载页面」", () => {
    render(<Panel error={chunkFailure()} />);
    expect(screen.getByText("剧本工具")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新加载页面" })).toBeTruthy();
  });

  it("点「重新加载页面」走整页刷新（这才是把新哈希拿回来的动作）", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    render(<Panel error={chunkFailure()} />);
    fireEvent.click(screen.getByRole("button", { name: "重新加载页面" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("业务错误不接管：退回 ErrorBoundary 自己的降级 UI", () => {
    render(<Panel error={new Error("数据库表不存在")} />);
    expect(screen.getByText("组件渲染出错")).toBeTruthy();
    expect(screen.queryByText("剧本工具")).toBeNull();
  });
});
