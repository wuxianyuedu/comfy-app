// 「创作后端」分区**撤掉运行态之后仍然自洽**（ISSUE #1900）。
//
// 这一分区从「配置 + 运行态 + 日志」收成「只配置」。收的过程里最容易出的错是
// **留一段没有出口的空白**：四个动作按钮与日志框没了，而用户按老位置找「启动
// ComfyUI」时看到几个输入框，会以为功能被砍了。所以这里判两件：
//   · 配置项都还在（路径 / 解释器 / 端口 / 启动参数 / 自动拉起 / 存储目录）；
//   · 有一个**能点**的出口指向侧栏「ComfyUI」页（`workspace:navigate`）。
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReadySettingsPageController } from "../hooks/use-settings-page";
import { ComfyuiSection } from "./ComfyuiSection";

const { emitAppEventMock } = vi.hoisted(() => ({
  emitAppEventMock: vi.fn(),
}));
vi.mock("~/lib/app-events", () => ({
  emitAppEvent: emitAppEventMock,
}));

/* 本仓不在 setup 里注册自动清理（`globals: false`），每份用例自己收尾。 */
afterEach(() => {
  cleanup();
  emitAppEventMock.mockClear();
});

function controller(
  over: Partial<ReadySettingsPageController["drafts"]["settings"]> = {},
  instance: ReadySettingsPageController["comfyInstance"] = {
    pathConfigured: true,
    instanceType: "portable",
    desktopManaged: false,
  },
): ReadySettingsPageController {
  return /* SAFETY: 类型断言已复核 */ {
    comfyDefaultPort: 8188,
    comfyInstance: instance,
    comfyStorage: null,
    saving: false,
    savePrefs: vi.fn(async () => undefined),
    patchSettings: vi.fn(),
    drafts: {
      settings: {
        comfyuiPath: "D:/ComfyUI",
        comfyuiExtraArgs: "",
        comfyCliPython: "",
        comfyuiAutoStart: true,
        comfyuiPort: 0,
        exitKillComfyui: true,
        exitKillOllama: true,
        autoSyncLocalWorkflow: false,
        ...over,
      },
    },
  } as unknown as ReadySettingsPageController;
}

describe("ComfyuiSection（只配置路径）", () => {
  it("配置项都还在：路径 / 解释器 / 端口 / 启动参数 / 自动拉起 / 保存", () => {
    render(<ComfyuiSection c={controller()} />);
    for (const label of [
      "ComfyUI 路径（源码根或桌面版实例根）",
      "comfy-cli 解释器（Python 绝对路径）",
      "ComfyUI 端口",
      "ComfyUI 启动参数（可选）",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(
      screen.getByRole("checkbox", {
        name: "提交任务时 ComfyUI 未运行则自动启动",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存偏好" })).toBeInTheDocument();
  });

  it("运行态那几颗按钮与日志框都不在这一分区了", () => {
    render(<ComfyuiSection c={controller()} />);
    for (const name of ["启动 ComfyUI", "关闭 ComfyUI", "打开查看", "在浏览器打开"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    /* 日志框按它自己的标题判（页上那句「…以及每一次启动的日志」是**指路**，
       不是日志框本身）。 */
    expect(screen.queryByText("启动日志（comfyui-runtime.log）")).not.toBeInTheDocument();
  });

  it("给出去侧栏「ComfyUI」页的**可点**出口（撤掉动作之后必须有落点）", async () => {
    const user = userEvent.setup();
    render(<ComfyuiSection c={controller()} />);
    const go = screen.getByRole("button", { name: /去启动与查看日志/ });
    await user.click(go);
    expect(emitAppEventMock).toHaveBeenCalledWith("workspace:navigate", {
      view: "comfyui",
    });
  });

  it("未配置路径时那句话点出后果（侧栏那一页也启动不了它）", () => {
    render(
      <ComfyuiSection
        c={controller(
          { comfyuiPath: "" },
          { pathConfigured: false, instanceType: null, desktopManaged: false },
        )}
      />,
    );
    expect(screen.getByText(/未配置——ComfyUI 未运行时任务会失败/)).toBeInTheDocument();
  });
});
