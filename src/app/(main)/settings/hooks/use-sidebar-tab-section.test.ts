/**
 * 「侧边栏」分区的控制器（ISSUE #3623）。
 *
 * 这一层要判的是**编辑态**：改一档只动那一项、保存时交出去的是当前草稿、失败时
 * 状态提示里有一句人话（而不是一个未处理的 rejection）。
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { projectSidebarTabConfig } from "~/lib/shell/sidebar-tab-behavior";
import type { SidebarTabConfig } from "~/lib/shell/sidebar-tab-behavior";

const hooks = vi.hoisted(() => ({
  query: {
    data: undefined as
      | {
          config: SidebarTabConfig;
          projectDefaultEditable: boolean;
          projectDefaults: SidebarTabConfig;
        }
      | undefined,
  },
  actions: {
    resetToDefault: vi.fn(() => Promise.resolve({})),
    resetBusy: false,
    save: vi.fn(() => Promise.resolve({})),
    saveAsProjectDefaults: vi.fn(() => Promise.resolve("src/lib/shell/sidebar-tab-defaults.json")),
    saving: false,
    savingProjectDefaults: false,
  },
}));

vi.mock("~/components/studio/hooks/use-sidebar-tab-config", () => ({
  useSidebarTabConfigActions: () => hooks.actions,
  useSidebarTabConfigQuery: () => hooks.query,
}));

import { useSidebarTabSection } from "./use-sidebar-tab-section";

beforeEach(() => {
  vi.clearAllMocks();
  const project = projectSidebarTabConfig();
  hooks.query.data = {
    config: { ...project },
    projectDefaults: project,
    projectDefaultEditable: false,
  };
});

describe("侧边栏分区的控制器", () => {
  it("草稿由取回来的生效值播种", () => {
    const { result } = renderHook(() => useSidebarTabSection());
    expect(result.current.draft).toEqual(projectSidebarTabConfig());
    expect(result.current.projectDefaultEditable).toBe(false);
  });

  it("改一档只动那一项（草稿是逐项的）", () => {
    const { result } = renderHook(() => useSidebarTabSection());
    act(() => {
      result.current.setMode("console", "shared");
    });
    expect(result.current.draft?.console).toBe("shared");
    expect(result.current.draft?.models).toBe("independent");
  });

  it("保存把当前草稿交出去，并给一句结果", async () => {
    const { result } = renderHook(() => useSidebarTabSection());
    act(() => {
      result.current.setMode("console", "shared");
    });
    await act(async () => {
      await result.current.save();
    });
    expect(hooks.actions.save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toContain("已保存");
  });

  it("保存失败时状态里有一句人话（不是未处理的 rejection）", async () => {
    hooks.actions.save.mockImplementation(() => Promise.reject(new Error("磁盘满了")));
    const { result } = renderHook(() => useSidebarTabSection());
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toContain("磁盘满了");
  });

  it("「保存为项目默认」把写盘的路径念出来", async () => {
    const { result } = renderHook(() => useSidebarTabSection());
    await act(async () => {
      await result.current.saveAsProjectDefaults();
    });
    expect(result.current.status).toContain("sidebar-tab-defaults.json");
  });

  it("还原默认：调那个动作，并给一句结果", async () => {
    const { result } = renderHook(() => useSidebarTabSection());
    await act(async () => {
      await result.current.resetToDefault();
    });
    expect(hooks.actions.resetToDefault).toHaveBeenCalledTimes(1);
    expect(result.current.status).toContain("已还原默认");
  });

  it("生效值与项目默认不一致时才算「有本机覆盖」", () => {
    const project = projectSidebarTabConfig();
    hooks.query.data = {
      config: { ...project, console: "shared" },
      projectDefaults: project,
      projectDefaultEditable: false,
    };
    const { result } = renderHook(() => useSidebarTabSection());
    expect(result.current.customized).toBe(true);
  });
});
