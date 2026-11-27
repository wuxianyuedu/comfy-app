/**
 * 请求 / 响应读数面板的 body / excerpt 文本缓存（ISSUE #5227 D9~D11）：
 * 面板每 500ms 会因生成秒表重渲，body / excerpt 的 stringify 必须按 rows
 * 缓存，不能跟着秒表一遍遍算。这里用 spy 数 stringify 调用次数并断言
 * 展示内容在 excerptPretty 开关切换后仍正确。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { RequestDetailSection } from "./ModelTestRequestDetail";
import type { ApiCallDebugRow } from "~/lib/workshop/api-channel-shared";

afterEach(cleanup);

const ROW: ApiCallDebugRow = {
  body: { prompt: "a cat", steps: 20 },
  durationMs: 1200,
  endpoint: "http://127.0.0.1:11434/v1/chat/completions",
  excerpt: { text: "meow" },
  ok: true,
  phase: "relay",
  status: 200,
};

const BASE_PROPS = {
  excerptPretty: true,
  generating: false,
  generatingSince: null,
  onExcerptPretty: () => undefined,
  rows: [ROW],
  variant: "request" as const,
};

describe("RequestDetailSection 缓存 body / excerpt 序列化（ISSUE #5227）", () => {
  it("相同 rows 与开关下重渲不再重复 stringify，展示内容不变", () => {
    const spy = vi.spyOn(JSON, "stringify");
    try {
      const view = render(<RequestDetailSection {...BASE_PROPS} />);
      expect(screen.getByText(/"prompt": "a cat"/)).toBeTruthy();
      expect(screen.getByText(/"text": "meow"/)).toBeTruthy();
      const before = spy.mock.calls.length;
      view.rerender(<RequestDetailSection {...BASE_PROPS} />);
      expect(spy.mock.calls.length).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });

  it("切换 excerptPretty 后摘要展示按新开关重新计算", () => {
    const view = render(<RequestDetailSection {...BASE_PROPS} />);
    expect(screen.getByText(/"text": "meow"/)).toBeTruthy();
    view.rerender(<RequestDetailSection {...BASE_PROPS} excerptPretty={false} />);
    // 原始形态：JSON.stringify 不带缩进。
    expect(screen.getByText('{"text":"meow"}')).toBeTruthy();
  });

  it("excerpt 为 null 时不渲染摘要 <pre>，body 仍照常展示", () => {
    render(<RequestDetailSection {...BASE_PROPS} rows={[{ ...ROW, excerpt: null }]} />);
    expect(screen.getByText(/"prompt": "a cat"/)).toBeTruthy();
    expect(screen.queryByText(/meow/)).toBeNull();
  });
});
