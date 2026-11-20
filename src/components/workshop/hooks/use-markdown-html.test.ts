// useMarkdownHtml 的失败路径（#4238）：渲染器的动态 import 拒绝时——
//  · rejection 不冒出（旧形态无 .catch，vitest 当场记败）；
//  · console 留痕（LogProvider 面板可见）；
//  · 预览不落地半成品（rendered 保持空）；
//  · text 变更后自然重试。
// 另覆盖 #4610 的解析防抖：窗口内连续变更只解析最后一次、窗口内预览不闪空、
// 空串输入闸（#4384）不因防抖失效。防抖用例走**真定时器**（250ms 窗口 + 400ms
// 落定）—— React 19 的 passive effects 在 vi.useFakeTimers 下晚一拍冲刷，
// rerender 的效果没在时钟推进前落地（探针实测），真时钟没有这层歧义。
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

describe("useMarkdownHtml 的解析防抖（#4610）", () => {
  it("窗口内连续变更只解析最后一次；窗口内预览保持上一份结果不闪空", async () => {
    const parse = vi.fn((t: string) => `<p>${t}</p>`);
    loadMarkdownRenderer.mockResolvedValue({ markdownToHtml: parse });

    let text = "第一版";
    const { result, rerender } = renderHook(() => useMarkdownHtml(text));
    /* 首轮落定 —— 防抖管的是「变更后的再解析」，不挡首帧（挂载即解析一次）。 */
    await expect.poll(() => parse.mock.calls.length).toBe(1);
    expect(result.current).toBe("<p>第一版</p>");

    /* 窗口内连敲三键（同步完成，未越过 250ms 窗口）。 */
    act(() => {
      text = "第二版";
      rerender();
      text = "第三版";
      rerender();
      text = "第四版";
      rerender();
    });
    /* 窗口内：没再解析（逐键全量解析正是 #4610 的病灶），
     * 预览仍显示上一份已解析结果 —— 慢半拍，但不闪空。 */
    expect(parse).toHaveBeenCalledTimes(1);
    expect(result.current).toBe("<p>第一版</p>");

    /* 安静超过窗口 ⇒ 只解析最后一次。 */
    await expect
      .poll(() => parse.mock.calls.length, { message: "窗口走完后只应再解析一次" })
      .toBe(2);
    expect(parse).toHaveBeenLastCalledWith("第四版");
    expect(result.current).toBe("<p>第四版</p>");
  });

  it("空串输入闸不因防抖失效：debouncedText 归空后不解析、不加载渲染器", async () => {
    const parse = vi.fn((t: string) => `<p>${t}</p>`);
    loadMarkdownRenderer.mockResolvedValue({ markdownToHtml: parse });

    let text = "有内容";
    const { rerender } = renderHook(() => useMarkdownHtml(text));
    await expect.poll(() => parse.mock.calls.length).toBe(1);
    expect(loadMarkdownRenderer).toHaveBeenCalledTimes(1);

    /* 预览关闭 → text 归空：防抖窗口过后也不该再解析 / 加载（#4384 语义不变）。 */
    text = "";
    act(() => {
      rerender();
    });
    // sleep-ok: 等一个「不会发生的事」—— 归空后不得再解析 / 加载，
    // 轮询表达不了「一直没发生」（规范 11 §11.14 的合法逃逸口）。
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
    expect(loadMarkdownRenderer).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });
});
