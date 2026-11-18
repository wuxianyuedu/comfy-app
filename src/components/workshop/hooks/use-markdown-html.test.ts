// useMarkdownHtml 的失败路径（#4238）：渲染器的动态 import 拒绝时——
//  · rejection 不冒出（旧形态无 .catch，vitest 当场记败）；
//  · console 留痕（LogProvider 面板可见）；
//  · 预览不落地半成品（rendered 保持空）；
//  · text 变更后自然重试。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadMarkdownRenderer = vi.hoisted(() => vi.fn());

vi.mock("~/lib/markdown", () => ({
  loadMarkdownRenderer,
}));

import { useMarkdownHtml } from "./use-markdown-html";

beforeEach(() => {
  loadMarkdownRenderer.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMarkdownHtml 的失败路径（#4238）", () => {
  it("渲染器加载失败：console 留痕、rejection 不冒出、预览不落地", async () => {
    loadMarkdownRenderer.mockRejectedValue(new TypeError("chunk load failed"));

    const { result } = renderHook(() => useMarkdownHtml("第一段剧本"));
    await expect
      .poll(() => console.error, { message: "失败留痕应到达", timeout: 3000 })
      .toHaveBeenCalledWith(
        expect.stringContaining("markdown 渲染器加载失败"),
        expect.any(TypeError),
      );

    /* 预览不落地半成品：text 未变时返回空串（视图按未渲染处理）。 */
    expect(result.current).toBe("");
  });

  it("失败后 text 变更自然重试：恢复成功则正常渲染", async () => {
    loadMarkdownRenderer.mockRejectedValueOnce(new TypeError("chunk load failed"));
    /* text 用闭包变量驱动：renderHook 的 rerender 传参对无参回调无效。 */
    let text = "第一版";
    const { result, rerender } = renderHook(() => useMarkdownHtml(text));
    await vi.waitFor(() => {
      expect(console.error).toHaveBeenCalled();
    });

    loadMarkdownRenderer.mockResolvedValue({
      markdownToHtml: (t: string) => `<p>${t}</p>`,
    });
    text = "第二版";
    await act(async () => {
      rerender();
      await Promise.resolve();
    });
    await expect
      .poll(() => result.current, { message: "重试后应渲染出新文本", timeout: 3000 })
      .toBe("<p>第二版</p>");
    expect(loadMarkdownRenderer).toHaveBeenCalledTimes(2);
  });
});
