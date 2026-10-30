import type * as TanStackQuery from "@tanstack/react-query";
import type * as CustomNodesModule from "~/config/custom-nodes";
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
 *   · `useWorkflowDetailLoader` 的冷路径直调 `~/trpc/vanilla` 的
 *     `workflow.detailFull.query`（`~/trpc/react` 的桩覆盖不到）；
 *   · 组件挂载即调 `~/config/custom-nodes` 的 `refreshCustomNodes()`（GET 清单）。
 * 两条都会真打到 `localhost:3000`：本机是 ECONNREFUSED，且 happy-dom 会把连接失败
 * 当成窗口级错误再打一遍（ISSUE #2458）。本用例只断言首帧加载态，故详情查询给
 * 「永不 resolve」的桩、清单刷新给 resolve 桩 —— 二者都不改动被测路径的选择。 */
vi.mock("~/trpc/vanilla", () => {
  const pending = <T,>() =>
    // 永不 resolve：本用例只断言加载态，不等详情返回
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- never-resolve pending 桩
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
          <WorkflowEditorInner workflowId="wf-test" onClose={vi.fn()} />
        </ToastProvider>
      </ReactFlowProvider>,
    );

    /* 按 §11.9 断言**用户可见结果**，不再 dump 整棵 DOM。这条判据随 ISSUE #1691
     * 第 3 条翻过一次方向，两侧的来龙去脉都记在这里：
     *   · 曾经它钉的是「加载态是 `FullScreenLayer`」—— 那一条来自 ISSUE #310
     *     （全屏视图别盖掉标题行里的页签）。理由是当时编辑器**只有**全屏形态，
     *     加载态跟着它走最省事；
     *   · 用户实测的诉求是「点击流程会有一个全屏的加载…加载只覆盖右侧部分」：
     *     那一两秒里侧栏与视图页签整条被盖住，用户连「换个视图等一下」都做不到。
     *     过渡屏该占的是**内容列**，而编辑器加载完之后才走全屏层（§310 的口径
     *     不变）。
     *
     * 判据的形状：`absolute inset-0`（由**定位祖先**收窄 —— 壳的内容列是
     * `relative`）+ **不含 `fixed`**。`fixed` 才是「铺到整窗」那一颗，
     * 而 `top-title-bar` 是 `FullScreenLayer` 的定位标记、一并排除。
     * ⚠️ 别再写成「流内兄弟 + `flex-1`」：编辑器与工作流库并列渲染，两个
     * `flex-1` 会平分内容列 —— 实测那会让加载态嵌在库的下半截
     * （`/tmp` 那两张截图的形状），覆盖式才是这一段该有的形态。 */
    expect(screen.getByText("加载工作流节点…")).toBeInTheDocument();
    const layer = /* SAFETY: 类型断言已复核 */ container.firstElementChild as HTMLElement | null;
    expect(layer, "加载态没有渲染出来").toBeTruthy();
    expect(
      layer?.className,
      "过渡屏不许退回 `fixed`（那是整窗浮层，会盖掉侧栏与页签）",
    ).not.toMatch(/(^|\s)fixed(\s|$)/);
    expect(
      layer?.className,
      "过渡屏不许用 top-title-bar（那是 FullScreenLayer 的定位标记）",
    ).not.toMatch(/(^|\s)top-title-bar(\s|$)/);
    expect(layer?.className, "过渡屏要覆盖定位祖先（壳的内容列）").toMatch(/(^|\s)absolute(\s|$)/);
    expect(layer?.className).toMatch(/(^|\s)inset-0(\s|$)/);
  });
});
