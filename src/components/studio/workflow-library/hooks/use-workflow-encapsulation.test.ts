// useWorkflowEncapsulation 的参考图上限过滤（ISSUE #4537）：
// 契约口里序号超出「参考图上限」的参考图槽位不进封装视图——装载页签、工坊封装
// 一览与流程测试表单读的是同一份 status.entries / contractIds，过滤要发生在
// 取数层（而不是各视图自己再筛一遍）。未配置上限 = 跟随模式契约（现状行为）。
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ModeContract } from "~/lib/workshop/model-mode-contract";

const { contractsFixture } = vi.hoisted(() => ({
  contractsFixture: [] as Array<ModeContract>,
}));

vi.mock("~/components/workshop/mode-contract/hooks/use-mode-contracts", () => ({
  useModeContracts: () => ({ contracts: contractsFixture }),
}));

import { useWorkflowEncapsulation } from "./use-workflow-encapsulation";

/* I2I 契约：三个参考图槽位（模式契约编辑器可扩到任意多个，#4537 的上限就是在
 * 这之上按工作流收敛）。 */
const CONTRACTS: Array<ModeContract> = [
  {
    mode: "I2I",
    inputs: ["prompt", "reference-image", "reference-image-2", "reference-image-3"],
    required: ["prompt"],
  },
];

function renderEncapsulation(paramMap: Record<string, unknown> | null) {
  contractsFixture.splice(0, contractsFixture.length, ...CONTRACTS);
  return renderHook(() => useWorkflowEncapsulation({ io: {}, mode: "I2I", paramMap }));
}

const referenceIdsOf = (hook: ReturnType<typeof useWorkflowEncapsulation>) =>
  hook.status.entries.map((entry) => entry.id).filter((id) => id.startsWith("reference-image"));

describe("useWorkflowEncapsulation 的参考图上限过滤（#4537）", () => {
  it("未配置上限 → 全部契约参考图槽位都在（现状行为）", () => {
    const hook = renderEncapsulation({}).result.current;
    expect(referenceIdsOf(hook)).toEqual([
      "reference-image",
      "reference-image-2",
      "reference-image-3",
    ]);
  });

  it("配置上限 2 → 第三个参考图槽位不进封装视图", () => {
    const hook = renderEncapsulation({ referenceLoaders: { maxReferences: 2 } }).result.current;
    expect(referenceIdsOf(hook)).toEqual(["reference-image", "reference-image-2"]);
    expect(hook.contractIds).not.toContain("reference-image-3");
    /* 非参考图口不受上限影响。 */
    expect(hook.contractIds).toContain("prompt");
  });

  it("上限 1 → 只保留第一个参考图槽位", () => {
    const hook = renderEncapsulation({ referenceLoaders: { maxReferences: 1 } }).result.current;
    expect(referenceIdsOf(hook)).toEqual(["reference-image"]);
  });

  it("上限大于契约槽位数 → 等价于不设限（不会凭空造出契约外的槽位）", () => {
    const hook = renderEncapsulation({ referenceLoaders: { maxReferences: 8 } }).result.current;
    expect(referenceIdsOf(hook)).toEqual([
      "reference-image",
      "reference-image-2",
      "reference-image-3",
    ]);
  });
});
