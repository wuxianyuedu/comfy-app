/**
 * 「侧边栏」分区的控制器（ISSUE #3623 / #3948）。
 *
 * 这一层要判的是**编辑态**：改一档只动那一项、**改一档即存本机**（ISSUE #3948
 * 去掉了「保存」那一步）、失败时状态提示里有一句人话（而不是一个未处理的 rejection）。
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
          projectDefaults: SidebarTabConfig;
        }
      | undefined,
  },
  actions: {
    resetToDefault: vi.fn(() => Promise.resolve({} as SidebarTabConfig)),
    resetBusy: false,
    /* 入参是整份草稿（改一档即存，ISSUE #3948）—— 桩的形参要跟着写，
       否则用例读不到 `calls[0][0]`。 */
    save: vi.fn((_config: SidebarTabConfig) => Promise.resolve({})),
    saving: false,
  },
}));

vi.mock("~/components/studio/hooks/use-sidebar-tab-config", () => ({
  useSidebarTabConfigActions: () => hooks.actions,
  useSidebarTabConfigQuery: () => hooks.query,
}));

import { useSidebarTabSection } from "./use-sidebar-tab-section";

beforeEach(() => {
  vi.clearAllMocks();
  /* clearAllMocks 只清调用记录、不清实现 —— 失败那格换掉的实现要显式装回去，
     否则它会漏到后面的用例里。 */
  hooks.actions.save.mockImplementation(() => Promise.resolve({}));
  const project = projectSidebarTabConfig();
  hooks.query.data = {
    config: { ...project },
    projectDefaults: project,
  };
});

describe("侧边栏分区的控制器", () => {
  it("草稿由取回来的生效值播种", () => {
    const { result } = renderHook(() => useSidebarTabSection());
    expect(result.current.draft).toEqual(projectSidebarTabConfig());
  });

  it("改一档只动那一项（草稿是逐项的）", () => {
    const { result } = renderHook(() => useSidebarTabSection());
    act(() => {
      result.current.setMode("console", "shared");
    });
    expect(result.current.draft?.console).toBe("shared");
    /* models 的出厂档位是共享：没动它，草稿里保持默认值。 */
    expect(result.current.draft?.models).toBe("shared");
  });

  it("改一档即存本机（不再有「保存」那一步，ISSUE #3948）", async () => {
    const { result } = renderHook(() => useSidebarTabSection());
    await act(async () => {
      result.current.setMode("console", "shared");
      /* 让自动保存那一拍走完（状态提示是它 resolve 之后才写的）。 */
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(hooks.actions.save).toHaveBeenCalledTimes(1);
    /* 交出去的是**整份草稿**（含刚改的那一项），不是只交那一项。 */
    expect(hooks.actions.save.mock.calls[0]?.[0]).toMatchObject({ console: "shared" });
    expect(result.current.status).toContain("已保存");
  });

  it("存失败时状态里有一句人话（不是未处理的 rejection）", async () => {
    hooks.actions.save.mockImplementation(() => Promise.reject(new Error("磁盘满了")));
    const { result } = renderHook(() => useSidebarTabSection());
    await act(async () => {
      result.current.setMode("console", "shared");
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(result.current.status).toContain("磁盘满了");
  });

  it("还原默认：调那个动作，并给一句结果（草稿按服务端回的生效值重种）", async () => {
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
    };
    const { result } = renderHook(() => useSidebarTabSection());
    expect(result.current.customized).toBe(true);
  });
});
