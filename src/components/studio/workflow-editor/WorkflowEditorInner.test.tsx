import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";

/* 覆盖范围说明（与审计 F6 一致：先有护栏再动刀）
 * 本文件目前锁定 WorkflowEditorInner 的「挂载 + 首帧加载态」这一条路径：
 * 组件内部串联了 tRPC 查询、reactflow 画布与多个派生 hook，在 jsdom 下
 * 让它们全部走到 loaded 分支会依赖 ResizeObserver / 真实 detail 数据，
 * 成本高且不稳定。因此这里只替换数据入口（tRPC react 客户端）并断言
 * loading 早期返回，保证：
 *   1. 组件能在 ReactFlowProvider 内正常挂载（不因 store 初始化而崩）；
 *   2. 加载态 UI 的渲染结果被快照锁定。
 * 后续拆分时，加载分支（loading 早期返回）可安全抽出，其余分支建议
 * 先补 loaded 态集成测试（或交给 e2e）再动。 */
vi.mock("~/trpc/react", () => ({
  api: {
    workflow: {
      update: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn().mockResolvedValue({}),
          isPending: false,
          isIdle: true,
          isSuccess: false,
          isError: false,
          reset: vi.fn(),
        }),
      },
      detail: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

import { ToastProvider } from "../ToastProvider";
import { WorkflowEditorInner } from "./WorkflowEditorInner";

afterEach(cleanup);

describe("WorkflowEditorInner", () => {
  it("在 ReactFlowProvider 内挂载并渲染加载态", () => {
    const { container } = render(
      <ReactFlowProvider>
        <ToastProvider>
          <WorkflowEditorInner workflowId="wf-test" onClose={vi.fn()} />
        </ToastProvider>
      </ReactFlowProvider>,
    );

    expect(screen.getByText("加载工作流节点…")).toBeInTheDocument();
    /* 按 §11.9 断言**用户可见结果**，不再 dump 整棵 DOM。这里要钉的其实是
     * ISSUE #310 那条回归（全屏视图盖掉窗口标题行里的页签、用户切不回去）：
     *   · 加载态有一句可读文案（spinner 的可访问名由基元持有）；
     *   · 覆盖层是 `FullScreenLayer` —— `top-title-bar`（让出标题行）而不是
     *     `inset-0`，且 `data-*` 形状与宿主一致；这一条是「用户还能看到页签」。
     * 用 `startsWith` 而不是 `toContain`：`bottom-0 left-0` 里也含 `top` 子串时
     * `toContain` 会假绿（判据自己会静默失效的那一类）。 */
    expect(screen.getByText("加载工作流节点…")).toBeInTheDocument();
    const layer = container.querySelector<HTMLElement>(
      '[class*="top-title-bar"]',
    );
    expect(
      layer,
      "加载态不是 FullScreenLayer（没有 top-title-bar）",
    ).toBeTruthy();
    expect(layer?.className, "全屏层必须让出标题行").toMatch(
      /(^|\s)top-title-bar(\s|$)/,
    );
    expect(layer?.className, "不许回到 inset-0（会盖掉页签）").not.toMatch(
      /(^|\s)inset-0(\s|$)/,
    );
  });
});
