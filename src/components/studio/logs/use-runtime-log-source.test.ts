"use client";

/* ── 设置页运行日志数据层的增量口径（ISSUE #4558）────────────────────────
 * 活跃期每秒全量重拉 + 全文重解析曾让三来源同挂时每秒重协调最多 1.2 万个
 * span。这里锁住修复的三条行为：
 *   1) 正文逐字相同 → segments / text 整块复用旧引用（setState 同引用，
 *      React 跳过渲染）；
 *   2) 正文只是前缀延伸 → 只解析新增尾巴，旧片段引用原样保留（渲染协调
 *      只落在新增部分）；
 *   3) 前缀失配（服务端尾窗滑动 / 换会话）→ 对全文重扫，与一次性解析等价。
 * 另锁自定义 parse（Ollama 的 logrus 上色）的降级口径：无变化复用、变化全量。
 * 轮询动作经 `refresh`（= `pull`）手动驱动，不依赖定时器。
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnsiSegment } from "~/lib/log/log-ansi";
import type { LogSessionsPayload } from "~/lib/log/log-sessions";

const { fetchLogSessionsMock } = vi.hoisted(() => ({
  fetchLogSessionsMock:
    vi.fn<(source: unknown, session?: unknown) => Promise<LogSessionsPayload | null>>(),
}));

vi.mock("~/lib/log/log-file-client", () => ({
  fetchLogSessions: (source: unknown, session: unknown) => fetchLogSessionsMock(source, session),
}));

import { useRuntimeLogSource } from "./use-runtime-log-source";

/** 一份最小会话载荷（正文随用例改）。 */
function payload(content: string): LogSessionsPayload {
  return {
    content,
    selectedId: "s1",
    sessions: [{ crashed: false, id: "s1", scope: "current", startedAt: 1000, title: "一次启动" }],
    size: content.length,
    total: 1,
    truncated: false,
    windowed: false,
  };
}

beforeEach(() => {
  fetchLogSessionsMock.mockReset();
  fetchLogSessionsMock.mockResolvedValue(payload(""));
});

afterEach(() => {
  vi.clearAllMocks();
});

/** 换一轮响应并驱动一次拉取。 */
async function pullWith(
  render: { result: { current: ReturnType<typeof useRuntimeLogSource> } },
  content: string,
): Promise<void> {
  fetchLogSessionsMock.mockResolvedValue(payload(content));
  await act(async () => {
    await render.result.current.refresh();
  });
}

describe("useRuntimeLogSource — 增量口径（ISSUE #4558）", () => {
  it("正文逐字相同 → segments / text 引用复用（渲染跳过的前提）", async () => {
    const view = renderHook(() =>
      useRuntimeLogSource({ source: "comfyui-runtime", active: false }),
    );
    await act(async () => {
      await view.result.current.refresh();
    });
    const first = view.result.current;
    await pullWith(view, "hello \u001b[31mworld");
    const second = view.result.current;
    await pullWith(view, "hello \u001b[31mworld");
    expect(view.result.current.segments).toBe(second.segments);
    expect(view.result.current.text).toBe(second.text);
    expect(view.result.current).not.toBe(first);
  });

  it("前缀延伸 → 只追加新片段：旧片段引用原样保留", async () => {
    const view = renderHook(() =>
      useRuntimeLogSource({ source: "comfyui-runtime", active: false }),
    );
    await pullWith(view, "line-1\n");
    const oldSegments = view.result.current.segments;
    await pullWith(view, "line-1\nline-2\n");
    const merged = view.result.current.segments;
    /* 旧片段引用不变（渲染协调只落在新增部分）。 */
    for (const [index, segment] of oldSegments.entries()) {
      expect(merged[index]).toBe(segment);
    }
    expect(merged.length).toBeGreaterThan(oldSegments.length);
    expect(merged.at(-1)?.text).toContain("line-2");
  });

  it("前缀延伸的着色与一次性全文解析等价（SGR 状态跨轮延续）", async () => {
    const view = renderHook(() =>
      useRuntimeLogSource({ source: "comfyui-runtime", active: false }),
    );
    await pullWith(view, "A \u001b[31mred");
    await pullWith(view, "A \u001b[31mred tail \u001b[0mplain");
    const segments = view.result.current.segments;
    /* 增量段里 reset 之前的 " tail "（含前导空格）仍是红色（状态从上一轮
     * 延续）；reset 后的 "plain" 回到默认色 —— 与一次性全文解析逐段一致。 */
    expect(segments.find((segment) => segment.text === " tail ")?.styles).toEqual(["red"]);
    expect(segments.find((segment) => segment.text === "plain")?.styles).toBeUndefined();
  });

  it("前缀失配（服务端尾窗滑动）→ 对全文重扫，与一次性解析一致", async () => {
    const view = renderHook(() =>
      useRuntimeLogSource({ source: "comfyui-runtime", active: false }),
    );
    await pullWith(view, "A \u001b[31mred tail");
    await pullWith(view, "B \u001b[32mgreen only");
    const texts = view.result.current.segments.map((segment) => segment.text).join("");
    expect(texts).toBe("B green only");
    expect(view.result.current.segments.at(-1)?.styles).toEqual(["green"]);
  });

  it("自定义 parse（Ollama logrus）：无变化复用引用；变化全量解析", async () => {
    /* logrus 行上色走 parseOllamaLogText（挂载点传参形态）；这里以等价的
     * 自定义解析器代表「不参与流式增量」的那一档。 */
    const customParse = vi.fn((text: string) => [{ text }] satisfies AnsiSegment[]);
    const view = renderHook(() =>
      useRuntimeLogSource({ source: "ollama-runtime", active: false, parse: customParse }),
    );
    await pullWith(view, "level=INFO started\n");
    const oldSegments = view.result.current.segments;
    const callsAfterFirst = customParse.mock.calls.length;
    await pullWith(view, "level=INFO started\n");
    expect(view.result.current.segments).toBe(oldSegments);
    expect(customParse.mock.calls.length).toBe(callsAfterFirst);
    await pullWith(view, "level=INFO started\nlevel=ERROR boom\n");
    expect(customParse.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    expect(view.result.current.text).toContain("boom");
  });
});
