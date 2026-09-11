import { describe, expect, it } from "vitest";

import type { WorkflowIOEntry } from "~/components/studio/shared/workflow-io";
import { mergeExposedEntry, resolveExposedLabel } from "./io-exposure";

/** 服务端富化条目（workflow-detail-io 的输出形状）。 */
function enriched(partial: Partial<WorkflowIOEntry> = {}): WorkflowIOEntry {
  return {
    direction: "input",
    kind: "widget",
    nodeId: "node-uuid",
    name: "value_1",
    label: "value_1",
    type: "INT",
    defaultValue: -94475632327396,
    ...partial,
  };
}

describe("resolveExposedLabel — 暴露条目的显示名回退链", () => {
  it("本地 label（画布勾选时写入的业务名）优先于服务端富化名", () => {
    expect(resolveExposedLabel({ label: "seed" }, enriched(), "value_1")).toBe("seed");
  });

  it("本地没重命名过时用服务端富化名", () => {
    expect(resolveExposedLabel({}, enriched({ label: "随机种子" }), "value_1")).toBe("随机种子");
  });

  it("本地与服务端都没有名字时回退原始 pin 名", () => {
    expect(resolveExposedLabel({}, undefined, "value_1")).toBe("value_1");
    expect(resolveExposedLabel({}, enriched({ label: undefined }), "value_1")).toBe("value_1");
  });

  it("空白本地 label 视为未命名", () => {
    expect(resolveExposedLabel({ label: "   " }, undefined, "value_1")).toBe("value_1");
  });

  it("存量别名 label（等于 pin 名）让位给富化的作者名", () => {
    /* 勾选那一刻写进本地 label 的是画布显示名；修复前封装节点的显示名恰好
     *  是槽位别名 value_1。服务端已能按本层作者 label 修好富化名（"Seed"），
     *  本地那串机器名不能把它压回去（ISSUE #349）。 */
    expect(resolveExposedLabel({ label: "value_1" }, enriched({ label: "Seed" }), "value_1")).toBe(
      "Seed"
    );
  });

  it("本地 label 与 pin 名相同但富化名也相同（真的是这个名字）时原样保留", () => {
    expect(resolveExposedLabel({ label: "value_1" }, enriched({ label: "value_1" }), "value_1")).toBe(
      "value_1"
    );
  });

  it("本地作者手写的名字（非别名）依旧最高优先", () => {
    expect(resolveExposedLabel({ label: "我的种子" }, enriched({ label: "Seed" }), "value_1")).toBe(
      "我的种子"
    );
  });

  it("与画布同款清洗：剥掉 COMBO 候选串，两处显示完全一致", () => {
    expect(
      resolveExposedLabel({ label: "模型: A = B | C = D" }, undefined, "model")
    ).toBe("模型");
    expect(
      resolveExposedLabel({}, enriched({ label: "模型: A = B | C = D" }), "model")
    ).toBe("模型");
  });
});

describe("mergeExposedEntry — 本地编辑态覆盖服务端富化", () => {
  it("子工作流封装节点的槽位名被本地业务名盖住，其余富化字段保留", () => {
    const merged = mergeExposedEntry({ label: "seed" }, enriched());
    expect(merged.label).toBe("seed");
    expect(merged.type).toBe("INT");
    expect(merged.defaultValue).toBe(-94475632327396);
    expect(merged.nodeId).toBe("node-uuid");
  });

  it("本地未保存的 value / required / modes 整体透传", () => {
    const merged = mergeExposedEntry(
      {
        label: "seed",
        value: 7,
        required: true,
        modes: { i2v: { visible: false } },
      },
      enriched()
    );
    expect(merged.value).toBe(7);
    expect(merged.required).toBe(true);
    expect(merged.modes).toEqual({ i2v: { visible: false } });
  });

  it("本地没有 label 时沿用服务端富化名，不会把名字清空", () => {
    const merged = mergeExposedEntry({}, enriched({ label: "Last Frame Image" }));
    expect(merged.label).toBe("Last Frame Image");
  });
});
