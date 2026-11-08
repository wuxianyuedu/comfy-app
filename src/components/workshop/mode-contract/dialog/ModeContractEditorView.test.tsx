/**
 * `ModeContractEditorView` 的**布局判据**（ISSUE #1870）：形态改坏不会让功能断言变红，故判据落在结构事实上 —— ① 两栏都在（左栏 `role="radiogroup"` 导航、
 * 右栏编辑区，各自独立滚动）；② 右栏跟着选中走，未选给空态文案。不锁样式类。折叠的判据在 `ModeContractModeNav.test.tsx`，这一层不感知它，不重复记两处的账。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { derivedModeContract } from "~/lib/workshop/model-mode-contract";

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
    stored: [],
    saving: false,
    saved: false,
    savedKind: null,
    projectDefaultEditable: false,
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
    nextReferenceImageId: draft !== null && draft.inputs.length > 0 ? null : "reference-image",
    setOutput: vi.fn(),
    save: vi.fn(() => Promise.resolve()),
    saveAsProjectDefault: vi.fn(() => Promise.resolve(null)),
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
});
