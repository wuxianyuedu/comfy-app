// @vitest-environment jsdom
// 「界面打开耗时」那条日志的判据：测量点落在**内容挂载**那一刻，耗时 =
// 内容挂载时刻 - 该屏的打开时刻（由 context 提供）。
import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ViewOpenReport, ViewOpenedAtContext } from "./ViewOpenReport";
import type { WorkspaceView } from "./NavItems";

/* 记账日志调用：只换 `postAppRuntimeLog`，其余保留真实实现（挂载链上别处对
   `log-file-client` 的用法不被一起换掉）。 */
const { postAppRuntimeLogMock, runtimeLogCalls } = vi.hoisted(() => {
  const calls: Array<{
    fields?: unknown;
    level: string;
    msg: string;
    ns: string;
  }> = [];
  return {
    postAppRuntimeLogMock: vi.fn((ns: string, level: string, msg: string, fields?: unknown) => {
      calls.push({ fields, level, msg, ns });
      return Promise.resolve();
    }),
    runtimeLogCalls: calls,
  };
});
vi.mock("~/lib/log/log-file-client", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("~/lib/log/log-file-client");
  return { ...actual, postAppRuntimeLog: postAppRuntimeLogMock };
});

/** 渲染一个被包的屏；`openedAt` 即该屏的打开时刻（不是该屏时给 null）。 */
function renderReport(view: WorkspaceView, openedAt: number | null, strict = false) {
  const element = (
    <ViewOpenedAtContext.Provider
      value={(candidate: WorkspaceView) => (candidate === view ? openedAt : null)}
    >
      <ViewOpenReport view={view}>
        <span>内容</span>
      </ViewOpenReport>
    </ViewOpenedAtContext.Provider>
  );
  return render(strict ? <StrictMode>{element}</StrictMode> : element);
}

describe("界面打开耗时写进 app-runtime 日志", () => {
  beforeEach(() => {
    runtimeLogCalls.length = 0;
    vi.spyOn(performance, "now").mockReturnValue(900);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("内容挂载时按「打开时刻」算出耗时，写一条带 durationMs 的日志", () => {
    renderReport("settings", 500);
    expect(runtimeLogCalls).toContainEqual({
      fields: { durationMs: 400, view: "settings" },
      level: "info",
      msg: "界面打开：设置 耗时 400ms",
      ns: "app",
    });
  });

  it("不是当前屏（打开时刻为 null）时一条都不记", () => {
    renderReport("settings", null);
    expect(runtimeLogCalls).toHaveLength(0);
  });

  /* 同一个打开时刻只记一次：StrictMode 双挂载（挂载 → 卸载 → 再挂载）也拦得住。 */
  it("StrictMode 双挂载下只记一条", () => {
    renderReport("settings", 500, true);
    expect(runtimeLogCalls).toHaveLength(1);
  });
});
