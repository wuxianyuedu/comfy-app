/**
 * 「子界面打开 / 页签切换」日志（ISSUE #4580）的判据，两组：
 *   ① 助手本体 —— 耗时口径（performance.now() 差取整毫秒、负差按 0）、
 *     消息形状（动词： scope·name 耗时 n ms）、额外字段透传；
 *   ② 接线形状 —— 三处导航点（工作流详情打开 / 详情页签切换 / 设置分区切换）
 *     真的接了这套助手。渲染整链要拖起 controller 与查询桩，按本仓既有做法
 *     （见 tests/dev-launcher-runtime-heal.test.ts）读源码钉形状。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* 记账日志调用：只换 `postAppRuntimeLog`，其余保留真实实现。 */
const { postAppRuntimeLogMock, runtimeLogCalls } = vi.hoisted(() => {
  const calls: Array<{ fields?: unknown; level: string; msg: string; ns: string }> = [];
  return {
    postAppRuntimeLogMock: vi.fn((ns: string, level: string, msg: string, fields?: unknown) => {
      calls.push({ ns, level, msg, fields });
      return Promise.resolve();
    }),
    runtimeLogCalls: calls,
  };
});
vi.mock("~/lib/log/log-file-client", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("~/lib/log/log-file-client");
  return { ...actual, postAppRuntimeLog: postAppRuntimeLogMock };
});

import { logSubviewOpen, markSubviewOpenStart } from "./subview-open-log";

describe("子界面日志助手（ISSUE #4580）", () => {
  beforeEach(() => {
    runtimeLogCalls.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("耗时 = now − 打开时刻，取整毫秒；消息含动词 / 范围 / 名称", () => {
    vi.spyOn(performance, "now").mockReturnValue(1500);
    logSubviewOpen("子界面打开", "工作流详情", "测试流", 1234);
    expect(runtimeLogCalls).toContainEqual({
      ns: "app",
      level: "info",
      msg: "子界面打开：工作流详情·测试流 耗时 266ms",
      fields: { kind: "子界面打开", scope: "工作流详情", name: "测试流", durationMs: 266 },
    });
  });

  it("负差值（时钟异常）按 0 记，不报负数耗时", () => {
    vi.spyOn(performance, "now").mockReturnValue(100);
    logSubviewOpen("页签切换", "设置", "外观", 500);
    expect(runtimeLogCalls[0]?.msg).toBe("页签切换：设置·外观 耗时 0ms");
    expect(runtimeLogCalls[0]?.fields).toMatchObject({ durationMs: 0 });
  });

  it("额外字段（如 workflowId / tab / section）原样透传", () => {
    vi.spyOn(performance, "now").mockReturnValue(2000);
    logSubviewOpen("页签切换", "工作流详情", "IO 预览", 1990, { tab: "io" });
    expect(runtimeLogCalls[0]?.fields).toMatchObject({ durationMs: 10, tab: "io" });
  });

  it("markSubviewOpenStart 取的就是 performance.now()（交互处理器里的时刻）", () => {
    vi.spyOn(performance, "now").mockReturnValue(4321);
    expect(markSubviewOpenStart()).toBe(4321);
  });
});

describe("接线形状：三处导航点都接了子界面日志（ISSUE #4580）", () => {
  const ROOT = path.resolve(__dirname);
  const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

  it("工作流库：点开一条工作流（选中且不同于当前）时记开始时刻", () => {
    const src = read("workflow-library/WorkflowLibrary.tsx");
    expect(src).toContain("const handleSelect = (id: string | null) => {");
    expect(src).toContain("detailOpenedAtRef.current = markSubviewOpenStart()");
    // 时刻只经 ref 递给详情，不走 controller（它不是详情的状态）。
    expect(src).toContain("openedAtRef={detailOpenedAtRef}");
  });

  it("工作流详情：数据落定记「子界面打开」，页签提交后记「页签切换」", () => {
    const src = read("workflow-library/WorkflowLibraryDetailView.tsx");
    expect(src).toContain('logSubviewOpen("子界面打开", "工作流详情"');
    expect(src).toContain('logSubviewOpen("页签切换", "工作流详情"');
    // 切换时刻取在 onValueChange（交互处理器），不在渲染期（purity 判据）。
    expect(src).toContain("tabSwitchedAtRef.current = markSubviewOpenStart()");
    // 数据没落定（isLoading）不记 —— 那时候子界面还没真的就绪。
    expect(src).toContain("if (workflow === null || isLoading || openedAtRef === undefined)");
  });

  it("设置：分区切换经包装的 handleSectionSelect 记时刻与日志", () => {
    const src = read("../settings/SettingsView.tsx");
    expect(src).toContain("handleSectionSelect");
    expect(src).toContain('logSubviewOpen("页签切换", "设置"');
    // 同一分区的重复点击不记（没发生切换）。
    expect(src).toContain("if (next !== section)");
  });
});
