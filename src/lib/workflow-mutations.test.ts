// workflow.update 的两条失败策略单测。「静默写」与「抛错写」的区别不是
// 偷懒：IO 排序 / 分组 bypass 属于次要写，失败也不该打断用户继续拖画布，
// 服务端会在下次整体保存时重新落库；而模式保存失败必须让调用方知道，
// 否则界面会留下服务端没有的 zombie chip。

import { afterEach, describe, expect, it, vi } from "vitest";

import { patchWorkflow, patchWorkflowSilently } from "./workflow-mutations";

const updateMutate = vi.fn();

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    workflow: {
      update: { mutate: (...args: unknown[]) => updateMutate(...args) as never },
    },
  },
}));

afterEach(() => {
  updateMutate.mockReset();
  updateMutate.mockResolvedValue({});
});

describe("patchWorkflow", () => {
  it("成功时原样透传输入", async () => {
    await patchWorkflow({ id: "wf-1", workflowIO: {} });
    expect(updateMutate).toHaveBeenCalledWith({ id: "wf-1", workflowIO: {} });
  });

  it("失败向外抛（调用方负责回滚与提示）", async () => {
    updateMutate.mockRejectedValue(new Error("保存模式失败，请重试"));
    await expect(patchWorkflow({ id: "wf-1" })).rejects.toThrow("保存模式失败，请重试");
  });
});

describe("patchWorkflowSilently", () => {
  it("成功时发出请求", () => {
    patchWorkflowSilently({ id: "wf-1", groups: [{ id: "g1", bypass: true }] });
    expect(updateMutate).toHaveBeenCalledWith({
      id: "wf-1",
      groups: [{ id: "g1", bypass: true }],
    });
  });

  it("失败静默吞掉，不抛错（次要写不该打断交互）", () => {
    updateMutate.mockReturnValue(Promise.reject(new Error("离线")));
    expect(() => patchWorkflowSilently({ id: "wf-1" })).not.toThrow();
  });

  it("同步返回 undefined，调用方无法 await（刻意：不等结果）", () => {
    expect(patchWorkflowSilently({ id: "wf-1" })).toBeUndefined();
  });
});
