/**
 * `ModeContractEditorView` 的**布局判据**（ISSUE #1870）：形态改坏不会让功能断言变红，故判据落在结构事实上 —— ① 两栏都在（左栏 `role="radiogroup"` 导航、
 * 右栏编辑区，各自独立滚动）；② 右栏跟着选中走，未选给空态文案。不锁样式类。折叠的判据在 `ModeContractModeNav.test.tsx`，这一层不感知它，不重复记两处的账。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { derivedModeContract, type ModeContract } from "~/lib/workshop/model-mode-contract";

import type { ModeContractEditorController } from "../hooks/use-mode-contract-editor";
import { ModeContractEditorView } from "./ModeContractEditorView";

afterEach(cleanup);

/** 一个只填必要字段的控制器替身：本用例判的是**布局**，不是编辑行为。 */
function stubController(
  mode: string | null,
  overrides: Partial<ModeContractEditorController> = {},
): ModeContractEditorController {
  const draft = mode !== null && mode !== "" ? derivedModeContract(mode) : null;
  return {
    mode,
    draft,
    configured: [],
    stored: [],
    saving: false,
    saved: false,
    savedKind: null,
    saveError: null,
    projectDefaultEditable: false,
    resetting: false,
    savingProjectDefaults: false,
    selectMode: vi.fn(),
    setDraft: vi.fn(),
    appendInput: vi.fn(),
    removeInput: vi.fn(),
    moveInput: vi.fn(),
    addCustomInput: vi.fn(),
    renameCustomInput: vi.fn(),
    isRequired: () => false,
    toggleRequired: vi.fn(),
    hasAnyRequired: true,
    /* 未保存 / 切换确认（ISSUE #3762）：布局用例里恒为「不脏、无挂起切换」。 */
    dirty: false,
    pendingMode: null,
    confirmSwitch: vi.fn(() => Promise.resolve()),
    discardSwitch: vi.fn(),
    cancelSwitch: vi.fn(),
    nextReferenceImageId: draft !== null && draft.inputs.length > 0 ? null : "reference-image",
    setOutput: vi.fn(),
    save: vi.fn(() => Promise.resolve()),
    saveAsProjectDefault: vi.fn(() => Promise.resolve(null)),
    resetToDefault: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe("模式契约编辑器的两栏布局（ISSUE #1870）", () => {
  it("左栏是模式导航、右栏是编辑区（未选模式时给空态）", () => {
    render(<ModeContractEditorView controller={stubController(null)} />);
    expect(screen.getByRole("radiogroup", { name: "选择要配置的模式" })).toBeTruthy();
    expect(screen.getByText(/从左侧选一条模式/)).toBeTruthy();
  });

  it("选中某模式时右栏给出它的标题（模式码一并写在标题上）", () => {
    render(<ModeContractEditorView controller={stubController("T2I")} />);
    /* 区块小标题（`SectionLabel`）也是 `h4`，所以按**文案**取这一行：
       「<模式名> 的统一对外参数」是编辑区独有的那一行。 */
    const heading = screen.getByRole("heading", {
      level: 4,
      name: /的统一对外参数/,
    });
    expect(heading.textContent).toContain("T2I");
    /* 左栏仍在（两栏是并列的，不是「选了才换屏」）。 */
    expect(screen.getByRole("radiogroup", { name: "选择要配置的模式" })).toBeTruthy();
  });

  it("「保存为项目默认」只在开发检出渲染（正式包只有本机保存，ISSUE #3396）", () => {
    render(<ModeContractEditorView controller={stubController("T2I")} />);
    expect(screen.queryByRole("button", { name: /保存为项目默认/ })).toBeNull();
  });

  it("开发检出给出「保存为项目默认」入口（ISSUE #3396）", () => {
    render(
      <ModeContractEditorView
        controller={stubController("T2I", { projectDefaultEditable: true })}
      />,
    );
    expect(screen.getByRole("button", { name: /保存为项目默认/ })).toBeTruthy();
  });

  it("保存失败的原因要给用户看得见（#3637：失败不许只静默转圈）", () => {
    render(
      <ModeContractEditorView
        controller={stubController("T2I", { saveError: "每个模式至少要有一个输入口" })}
      />,
    );
    expect(screen.getByText(/保存失败/)).toBeTruthy();
    expect(screen.getByText(/至少要有一个输入口/)).toBeTruthy();
  });

  it("只剩最后一个输入口时不许删（#3637：空清单的契约保存不了、工坊也驱动不起来）", () => {
    const single: ModeContract = { ...derivedModeContract("T2I"), inputs: ["prompt"] };
    render(<ModeContractEditorView controller={stubController("T2I", { draft: single })} />);
    expect(screen.getByRole("button", { name: "移除 提示词" })).toBeDisabled();
  });

  it("输入口还有多个时移除按钮照常可用（#3637 的回归守卫）", () => {
    render(<ModeContractEditorView controller={stubController("T2I")} />);
    for (const button of screen.getAllByRole("button", { name: /^移除 / })) {
      expect(button).toBeEnabled();
    }
  });
});
