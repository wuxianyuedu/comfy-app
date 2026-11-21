// 「退出与后台服务」分区：新增的「关闭窗口后保留后台运行」开关（ISSUE #4680）
// 要在分区里可见、可勾选，并把 closeKeepTray 提交进偏好。
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isRecord } from "~/lib/is-record";

import type { ReadySettingsPageController } from "../hooks/use-settings-page";
import { ExitSection } from "./ExitSection";

afterEach(() => {
  cleanup();
});

/** 本分区只读偏好草稿与提交口；接口其余成员与本节无关。 */
function isExitSectionController(v: unknown): v is ReadySettingsPageController {
  if (!isRecord(v)) {
    return false;
  }
  const drafts = v.drafts;
  return isRecord(drafts) && isRecord(drafts.settings) && typeof v.commitPrefs === "function";
}

function controller(
  over: Partial<ReadySettingsPageController["drafts"]["settings"]> = {},
): ReadySettingsPageController {
  const stub: unknown = {
    commitPrefs: vi.fn(),
    drafts: {
      settings: {
        exitKillComfyui: false,
        exitKillOllama: true,
        closeKeepTray: false,
        ...over,
      },
    },
  };
  if (!isExitSectionController(stub)) {
    throw new Error("退出分区的 controller 替身缺少本分区要读的字段");
  }
  return stub;
}

describe("ExitSection —— 关闭窗口行为（ISSUE #4680）", () => {
  it("展示「关闭窗口后保留后台运行」开关，默认不勾选", () => {
    render(<ExitSection c={controller()} />);
    const toggle = screen.getByRole("checkbox", { name: /关闭窗口后保留后台运行/ });
    expect(toggle).not.toBeChecked();
  });

  it("勾选后把 closeKeepTray: true 提交进偏好", async () => {
    const c = controller();
    render(<ExitSection c={c} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /关闭窗口后保留后台运行/ }));
    expect(c.commitPrefs).toHaveBeenCalledWith({ closeKeepTray: true });
  });
});
