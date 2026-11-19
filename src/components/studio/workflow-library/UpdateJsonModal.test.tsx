// 「从 JSON 更新」弹窗的视图契约（#4377）：
//  1) 提交前把文本解析成 JSON 再上抛（解析失败就地报错、不上抛）；
//  2) 断线报告就地逐条列出（模式 / 槽位 / 端口），并提示重新配置；
//  3) 无断线时不渲染报告区；提交中禁用更新按钮。
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UpdateJsonModal } from "./UpdateJsonModal";
import type { UpdateJsonReport } from "./hooks/use-workflow-update-from-json";

const REPORT: UpdateJsonReport = {
  broken: [{ namespace: "mode:T2I", entryId: "images", ioKey: "9::param::images" }],
  droppedIOKeys: ["9::param::images"],
};

function renderModal(args: { report?: UpdateJsonReport | null; submitting?: boolean } = {}) {
  const onSubmit = vi.fn();
  const view = render(
    <UpdateJsonModal
      onClose={vi.fn()}
      onSubmit={onSubmit}
      open
      report={args.report ?? null}
      submitting={args.submitting ?? false}
      workflowName="测试工作流"
    />,
  );
  return { onSubmit, rerender: view.rerender };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("UpdateJsonModal（#4377）", () => {
  it("提交前解析 JSON；解析失败就地报错且不上抛", () => {
    const { onSubmit } = renderModal();
    const box = screen.getByLabelText("新的工作流 JSON");
    fireEvent.change(box, { target: { value: "不是 JSON" } });
    fireEvent.click(screen.getByRole("button", { name: "更新工作流" }));
    expect(screen.getByText(/不是有效的 JSON/)).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("合法 JSON 解析后上抛", () => {
    const { onSubmit } = renderModal();
    const box = screen.getByLabelText("新的工作流 JSON");
    fireEvent.change(box, { target: { value: '{"nodes":[]}' } });
    fireEvent.click(screen.getByRole("button", { name: "更新工作流" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ nodes: [] });
  });

  it("断线报告逐条列出并提示重新配置；无断线时不渲染报告区", () => {
    const { rerender } = renderModal({ report: REPORT });
    expect(screen.getByText(/以下连线在新版本里已断开/)).toBeDefined();
    /* 报告里的提示与弹窗描述文案都含「重新配置」，用报告特有的前缀定位。 */
    expect(screen.getByText(/请到「编辑对外参数」页签重新配置/)).toBeDefined();
    /* 同一 ioKey 可能同时出现在断线清单与 IO 编辑移除清单里（真实响应即如此）。 */
    expect(screen.getAllByText(/9::param::images/).length).toBeGreaterThanOrEqual(1);

    rerender(
      <UpdateJsonModal
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        open
        report={{ broken: [], droppedIOKeys: [] }}
        submitting={false}
        workflowName="测试工作流"
      />,
    );
    expect(screen.queryByText(/以下连线在新版本里已断开/)).toBeNull();
  });

  it("提交中禁用更新按钮", () => {
    renderModal({ submitting: true });
    expect(screen.getByRole("button", { name: "更新中…" })).toBeDisabled();
  });
});
