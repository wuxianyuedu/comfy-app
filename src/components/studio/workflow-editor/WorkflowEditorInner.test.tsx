import type * as TanStackQuery from "@tanstack/react-query";
import type * as CustomNodesModule from "~/config/custom-nodes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";

/* 覆盖范围说明（与审计 F6 一致：先有护栏再动刀）
 * 本文件只锁 WorkflowEditorInner 的「挂载 + 首帧加载态」：内部串了 tRPC 查询、
 * reactflow 画布与多个派生 hook，jsdom 下全走 loaded 分支依赖 ResizeObserver 与
 * 真实 detail 数据，成本高且不稳。因此只替换数据入口并断言 loading 早期返回：
 * 组件能在 ReactFlowProvider 内正常挂载；加载态 UI 由快照锁定。 */
/* 新集成下 hub 交出的是「options 工厂」，取数/变更本体在 TanStack 那一侧：
 * 所以这里替两样 —— `useTRPC` 只给能对上键的工厂，状态由下面 `importOriginal`
 * 局部替掉的 `useQuery` / `useMutation` 给。本文件的题目仍是「挂载 + 首帧加载态」，
 * 不测 TanStack（覆盖范围说明见上方那段）。 */
vi.mock("~/trpc/react", () => ({
  useTRPC: () => ({
    workflow: {
      update: { mutationOptions: (options?: unknown) => options },
      detail: { queryOptions: () => ({ queryKey: ["workflow", "detail"] }) },
    },
  }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof TanStackQuery>();
  return {
    ...actual,
    useQuery: () => ({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
      isIdle: true,
      isSuccess: false,
      isError: false,
      reset: vi.fn(),
    }),
  };
});

/* 上面替换的只是 `~/trpc/react` 那一路；挂载期还有两条**不经它**的数据入口：
 *   · `useWorkflowDetailLoader` 冷路径直调 `~/trpc/vanilla` 的 detailFull.query；
 *   · 挂载即调 `~/config/custom-nodes` 的 `refreshCustomNodes()`。
 * 两条都会真打 localhost:3000（本机 ECONNREFUSED，happy-dom 会当窗口级错误再打
 * 一遍，ISSUE #2458）。故详情查询给「永不 resolve」桩、清单刷新给 resolve 桩。 */
vi.mock("~/trpc/vanilla", () => {
  const pending = <T,>() =>
    // 永不 resolve：本用例只断言加载态，不等详情返回
    // oxlint-disable-next-line typescript/no-empty-function -- never-resolve pending 桩
    new Promise<T>(() => {});
  const query = () => vi.fn(() => pending());
  return {
    vanillaApi: {
      workflow: {
        detailFull: { query: query() },
        subgraph: { query: query() },
      },
    },
  };
});
vi.mock("~/config/custom-nodes", async (importOriginal) => {
  const actual = await importOriginal<typeof CustomNodesModule>();
  return {
    ...actual,
    refreshCustomNodes: vi.fn().mockResolvedValue(undefined),
  };
});

import { ToastProvider } from "../ToastProvider";
import { WorkflowEditorInner } from "./WorkflowEditorInner";

afterEach(cleanup);

describe("WorkflowEditorInner", () => {
  it("在 ReactFlowProvider 内挂载并渲染加载态", () => {
    const { container } = render(
      <ReactFlowProvider>
        <ToastProvider>
          <WorkflowEditorInner onClose={vi.fn()} workflowId="wf-test" />
        </ToastProvider>
      </ReactFlowProvider>,
    );

    /* 按 §11.9 断言**用户可见结果**。判据随 ISSUE #1691 第 3 条翻过方向：曾钉
     * 「加载态是 `FullScreenLayer`」（ISSUE #310，当时编辑器只有全屏形态）；用户
     * 实测要求加载只覆盖右侧内容列（那一两秒里侧栏与页签被盖住，连换视图都做不了）。
     * 形状：`absolute inset-0`（由定位祖先收窄）+ **不含 `fixed`**（那才是整窗），
     * `top-title-bar` 一并排除。⚠️ 别写成流内 `flex-1` 兄弟：两者会平分内容列。 */
    expect(screen.getByText("加载工作流节点…")).toBeInTheDocument();
    const layer = container.firstElementChild;
    if (!(layer instanceof HTMLElement)) {
      throw new Error("加载态没有渲染出来");
    }
    expect(layer.className, "过渡屏不许退回 `fixed`（那是整窗浮层，会盖掉侧栏与页签）").not.toMatch(
      /(?:^|\s)fixed(?:\s|$)/,
    );
    expect(
      layer.className,
      "过渡屏不许用 top-title-bar（那是 FullScreenLayer 的定位标记）",
    ).not.toMatch(/(?:^|\s)top-title-bar(?:\s|$)/);
    expect(layer.className, "过渡屏要覆盖定位祖先（壳的内容列）").toMatch(
      /(?:^|\s)absolute(?:\s|$)/,
    );
    expect(layer.className).toMatch(/(?:^|\s)inset-0(?:\s|$)/);
  });
});
