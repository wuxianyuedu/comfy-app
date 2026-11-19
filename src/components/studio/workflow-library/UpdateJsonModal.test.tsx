// 「从 JSON 更新」弹窗的视图契约（#4377）：
//  1) 提交前把文本解析成 JSON 再上抛（解析失败就地报错、不上抛）；
//  2) 断线报告就地逐条列出（模式 / 槽位 / 端口），并提示重新配置；
//  3) 无断线时不渲染报告区；提交中禁用更新按钮。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/* #4463：弹窗实例常驻（open 受控），输入草稿与行内错误必须在打开时重置，
 * 不跨开关 / 跨工作流残留 —— 否则给工作流 A 留下的断线报告和输入草稿，
 * 会在切到工作流 B 再点「从 JSON 更新」时原样弹出。 */
describe("UpdateJsonModal 状态随打开重置（#4463）", () => {
  const baseProps = {
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    report: null as UpdateJsonReport | null,
    submitting: false,
    workflowName: "测试工作流",
  };

  it("关闭再打开：输入草稿与行内错误不残留", async () => {
    const view = render(<UpdateJsonModal {...baseProps} open />);
    fireEvent.change(screen.getByLabelText("新的工作流 JSON"), {
      target: { value: "不是 JSON" },
    });
    fireEvent.click(screen.getByRole("button", { name: "更新工作流" }));
    expect(screen.getByText(/不是有效的 JSON/)).toBeDefined();

    view.rerender(<UpdateJsonModal {...baseProps} open={false} />);
    view.rerender(<UpdateJsonModal {...baseProps} open />);

    /* 重置后置到 render 提交后（规范 08 §8.6 写法二），等它落定。 */
    await waitFor(() => {
      expect(screen.getByLabelText("新的工作流 JSON")).toHaveValue("");
    });
    expect(screen.queryByText(/不是有效的 JSON/)).toBeNull();
  });
});
