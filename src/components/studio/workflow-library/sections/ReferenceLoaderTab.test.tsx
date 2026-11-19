// 「参考图装载」独立页签（ISSUE #4526）。
//
// 此前参考图槽位的「装载预设」配置混在「工坊封装」页签里，多参考图工作流的
// 装载配置与契约口清单挤在一屏。拆分后：DetailBody 的 reference 分支渲染本
// 组件，工坊封装面板不再含装载配置。行为判据：有参考图槽位 → 渲染装载配置区；
// 没有槽位 / 没有模式语境 → 给出对应空态，不渲染配置区。

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EncapsulationEntryStatus } from "~/lib/workshop/workshop-encapsulation-status";
import { ReferenceLoaderTab } from "./ReferenceLoaderTab";

/* 契约口取数打桩：真 hook 读模式契约注册表（tRPC），本文件只判渲染分支。 */
let status: { entries: Array<EncapsulationEntryStatus> };
vi.mock("../hooks/use-workflow-encapsulation", () => ({
  useWorkflowEncapsulation: () => ({ status }),
}));

/* 预设库取数打桩：真 hook 走 tRPC；装载配置区只读 presets / loading。 */
vi.mock("../hooks/use-reference-loader-presets", () => ({
  useReferenceLoaderPresets: () => ({ presets: [], loading: false }),
}));

/* 弹窗自带 ToastProvider 依赖（与 ReferenceLoaderBindingSection.test.tsx 同款
 * 处理）：本文件只判页签分支，桩成空壳。 */
vi.mock("../reference-loader/ReferenceLoaderPresetModal", () => ({
  ReferenceLoaderPresetModal: () => null,
}));

function entry(over: Partial<EncapsulationEntryStatus>): EncapsulationEntryStatus {
  return {
    control: "image",
    id: "reference-image",
    label: "参考图",
    required: false,
    targetIoKey: "45::widget::upload",
    ...over,
  };
}

afterEach(() => {
  cleanup();
});

function renderTab(over: Partial<Parameters<typeof ReferenceLoaderTab>[0]> = {}) {
  return render(
    <ReferenceLoaderTab
      activeMode="T2I"
      io={null}
      onPatchParamMap={vi.fn()}
      paramMap={{}}
      {...over}
    />,
  );
}

describe("参考图装载独立页签（ISSUE #4526）", () => {
  it("有参考图槽位 → 渲染装载配置区（标题 + 槽位行）", () => {
    status = { entries: [entry({})] };
    renderTab();
    expect(screen.getByText("参考图装载")).toBeTruthy();
    expect(screen.getByText("参考图")).toBeTruthy();
  });

  it("非参考图口不算槽位 → 空态，不渲染配置区", () => {
    status = { entries: [entry({ id: "prompt", label: "提示词", control: "text" })] };
    renderTab();
    expect(screen.getByText(/没有参考图槽位/)).toBeTruthy();
    expect(screen.queryByText("参考图装载")).toBeNull();
  });

  it("没有模式语境 → 空态（无从按模式存绑定）", () => {
    status = { entries: [entry({})] };
    renderTab({ activeMode: null });
    expect(screen.getByText(/没有可配置的模式/)).toBeTruthy();
  });

  it("源码契约：装载配置已从工坊封装面板拆出，reference 页签经本组件渲染", () => {
    const root = path.resolve(__dirname);
    const panel = readFileSync(path.join(root, "WorkshopEncapsulationPanel.tsx"), "utf8");
    const body = readFileSync(path.join(root, "DetailBody.tsx"), "utf8");
    expect(panel).not.toMatch(/ReferenceLoaderBindingSection/);
    expect(body).toMatch(/tab === "reference" && \(/);
    expect(body).toMatch(/<ReferenceLoaderTab/);
  });
});
