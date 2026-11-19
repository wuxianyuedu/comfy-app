// 工坊封装页签的懒加载日志弹窗必须有**局部** Suspense 边界（ISSUE #4525）。
//
// 本面板在「选中一条工作流」的同步更新里挂载，首帧就渲染懒加载的
// `LazyWorkflowRunLogModal`；没有局部边界时 suspend 会一路冒到路由级
// fallback（app/workspace/loading.tsx），把顶栏标题、左侧工作流列表与侧栏
// 选中态整屏顶成加载骨架 —— 用户看到的就是「选个工作流，全页都在加载」。
// 行为判据：分块悬着未到时，面板自身内容照常渲染，测试层那个「路由级」
// fallback 不许出现。

import { readFileSync } from "node:fs";
import path from "node:path";

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { useEncapsulationTestRun } from "../hooks/use-encapsulation-test-run";
import type { useWorkflowEncapsulation } from "../hooks/use-workflow-encapsulation";
import { WorkshopEncapsulationPanel } from "./WorkshopEncapsulationPanel";

/* 日志弹窗的分块永远「在路上」：模拟 dev 按需编译 / 慢网下懒分块未到的那一拍。
 * 旧实现（无局部边界）会在这里把整棵测试树顶进 Suspense fallback。 */
vi.mock("../WorkflowRunLogModal", () => {
  return new Promise<never>(() => {
    /* 故意不给 resolve / reject：分块一直没到，lazy 组件持续 suspend。 */
  });
});

/* 契约口取数打桩：真 hook 走 tRPC（useModeContracts），本文件只判渲染边界。 */
let encapsulation: ReturnType<typeof useWorkflowEncapsulation>;
vi.mock("../hooks/use-workflow-encapsulation", () => ({
  useWorkflowEncapsulation: () => encapsulation,
}));

/* 流程测试运行编排打桩：真 hook 接生成链路与 SSE，与本判据无关。 */
let testRun: ReturnType<typeof useEncapsulationTestRun>;
vi.mock("../hooks/use-encapsulation-test-run", () => ({
  useEncapsulationTestRun: () => testRun,
}));

function stubEncapsulation(): ReturnType<typeof useWorkflowEncapsulation> {
  return {
    contractEntries: [],
    contractIds: [],
    requiredInputs: [],
    status: {
      entries: [],
      missingLabels: [],
      missingRequired: [],
      ready: false,
      resolvedCount: 0,
    },
  };
}

function stubTestRun(): ReturnType<typeof useEncapsulationTestRun> {
  return {
    error: "",
    progress: 0,
    resultUrl: null,
    run: vi.fn(),
    running: false,
    taskId: null,
    uploadImage: vi.fn(() => Promise.resolve("")),
  };
}

afterEach(() => {
  cleanup();
});

function renderPanel() {
  encapsulation = stubEncapsulation();
  testRun = stubTestRun();
  return render(
    /* 测试层这一层边界**代指路由级**：fallback 出现即意味着 suspend 冒出了面板。 */
    <React.Suspense fallback={<div>路由级整屏加载中</div>}>
      <WorkshopEncapsulationPanel
        displayName="测试工作流"
        mode="T2I"
        modes={["T2I"]}
        paramMap={{}}
        workflowId="wf-1"
        workflowIO={null}
      />
    </React.Suspense>,
  );
}

describe("工坊封装页签：懒加载日志弹窗不顶掉整页（ISSUE #4525）", () => {
  it("日志弹窗分块未到时，面板内容照常渲染，不冒泡到路由级 fallback", () => {
    renderPanel();
    expect(screen.getByText("工坊封装")).toBeTruthy();
    expect(screen.queryByText("路由级整屏加载中")).toBeNull();
  });

  it("源码契约：LazyWorkflowRunLogModal 必须包在局部 React.Suspense 里", () => {
    const src = readFileSync(path.resolve(__dirname, "WorkshopEncapsulationPanel.tsx"), "utf8");
    expect(src).toMatch(/<React\.Suspense[^>]*>\s*<LazyWorkflowRunLogModal/);
  });
});
