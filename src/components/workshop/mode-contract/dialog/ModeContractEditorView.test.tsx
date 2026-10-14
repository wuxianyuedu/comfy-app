/**
 * `ModeContractEditorView` 的**布局判据**（ISSUE #1870）。
 *
 * 这一刀把模式清单从「按类别平铺的三排 chip」改成「左侧一棵树 + 右侧编辑区」的
 * 两栏。形态改坏不会让任何功能断言变红，所以判据落在结构事实上：
 *
 *   1. **两栏都在**：左栏是模式导航（`role="radiogroup"`），右栏是编辑区 ——
 *      「树」与「正文」是同一屏里两个独立滚动的区域；
 *   2. **右栏跟着选中走**：选中某模式时右栏给出它的标题与输入口；未选时给出
 *      空态文案（不是一片空白）。
 *
 * 不锁样式类：栏宽度、颜色改了不该让用例红。
 *
 * ⚠️ 折叠那一条（同级反馈的第二刀）的判据在 `ModeContractModeNav.test.tsx`：
 * 折叠是导航自己的交互状态，这一层只摆布局、不感知它 —— 在这里再判一遍等于
 * 把同一条账记两处。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { derivedModeContract } from "~/lib/workshop/model-mode-contract";

import type { ModeContractEditorController } from "../hooks/use-mode-contract-editor";
import { ModeContractEditorView } from "./ModeContractEditorView";

afterEach(cleanup);

/** 一个只填必要字段的控制器替身：本用例判的是**布局**，不是编辑行为。 */
function stubController(mode: string | null): ModeContractEditorController {
  const draft = mode ? derivedModeContract(mode) : null;
  return {
    mode,
    draft,
    stored: [],
    saving: false,
    saved: false,
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
    nextReferenceImageId: draft?.inputs.length ? null : "reference-image",
    setOutput: vi.fn(),
    save: vi.fn(() => Promise.resolve()),
  };
}

describe("模式契约编辑器的两栏布局（ISSUE #1870）", () => {
  it("左栏是模式导航、右栏是编辑区（未选模式时给空态）", () => {
    render(<ModeContractEditorView controller={stubController(null)} />);
    expect(
      screen.getByRole("radiogroup", { name: "选择要配置的模式" }),
    ).toBeTruthy();
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
    expect(
      screen.getByRole("radiogroup", { name: "选择要配置的模式" }),
    ).toBeTruthy();
  });
});
