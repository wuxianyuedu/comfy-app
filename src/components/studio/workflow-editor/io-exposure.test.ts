import { describe, expect, it } from "vitest";

import type { WorkflowIOEntry } from "~/components/studio/shared/workflow-io";
import {
  enrichFromViewNodes,
  isStaleExposedAlias,
  mergeExposedEntry,
  resolveExposedLabel,
} from "./io-exposure";

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

  it("本地 label 与 pin 名相同且富化名也是同一串（无从判定）时原样保留", () => {
    expect(resolveExposedLabel({ label: "value_1" }, enriched({ label: "value_1" }), "value_1")).toBe(
      "value_1"
    );
    expect(resolveExposedLabel({ label: "value_1" }, undefined, "value_1")).toBe("value_1");
  });

  it("富化名是别名时，本层作者名（slotLabel）也能把存量别名顶掉", () => {
    /* 作者名写在 wrapper 本层槽位上（`{ name: "value_1", label: "Seed" }`），
     *  但富化链里通用翻译排在前，显示名停在别名 —— 只有 slotLabel 能作证本层
     *  确实有作者命名（ISSUE #349）。 */
    expect(
      resolveExposedLabel(
        { label: "value_1" },
        enriched({ label: "value_1", slotLabel: "Seed" }),
        "value_1"
      )
    ).toBe("value_1");
    expect(isStaleExposedAlias("value_1", "value_1", "value_1", "Seed")).toBe(true);
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

describe("enrichFromViewNodes — 子图内层视图的就地富化兜底", () => {
  const viewNodes = [
    {
      id: "1670",
      class_type: "PrimitiveInt",
      raw_inputs: [
        { name: "value", label: "Seed", localized: "随机种", type: "INT", widgetValue: 1234 },
        { name: "model_name", localized: "模型", type: "COMBO" },
      ],
    },
  ];

  it("按 nodeId::widget::name 建表，label → localized → name 取名", () => {
    const map = enrichFromViewNodes(viewNodes);
    expect(map["1670::widget::value"]!.label).toBe("Seed");
    expect(map["1670::widget::value"]!.type).toBe("INT");
    expect(map["1670::widget::value"]!.defaultValue).toBe(1234);
    expect(map["1670::widget::model_name"]!.label).toBe("模型");
  });

  it("带上节点类名，供「首帧 / 尾帧」这类按类名判定的消费方使用", () => {
    expect(enrichFromViewNodes(viewNodes)["1670::widget::value"]!.classType).toBe("PrimitiveInt");
  });

  it("无节点 / 无 raw_inputs 时返回空表", () => {
    expect(enrichFromViewNodes(null)).toEqual({});
    expect(enrichFromViewNodes([{ id: "1" }])).toEqual({});
  });
});


describe("isStaleExposedAlias — 本地存的名字是不是机器生成的槽位名", () => {
  it("基准里只有槽位名（富化名也停在别名）时不判定，宁可留着旧值", () => {
    /* 无从区分「作者真把参数命名成 value_1」与「勾选时固化了别名」——
     *  没有第二个来源就不动手，避免清掉作者命名。 */
    expect(isStaleExposedAlias("value_1", "value_1")).toBe(false);
    expect(isStaleExposedAlias("image", "image")).toBe(false);
  });

  it("富化名与槽位名不同、本地存的正是别名 → 是别名（ISSUE #349 的复现路径）", () => {
    /* 富化现在给出的显示名是 `Seed` / `Last Frame Image`，本地那串 `value_1` /
     *  `image` 是修复前勾选写进去的机器名，必须让位 —— 否则任何一次写入
     *  （切 seed 行为、改必填、改值）都会把它重新当作者命名固化回库。 */
    expect(isStaleExposedAlias("value_1", "value_1", "Seed")).toBe(true);
    expect(isStaleExposedAlias("image", "image", "Last Frame Image")).toBe(true);
  });

  it("本地名已经是富化名 → 不是别名，不动", () => {
    expect(isStaleExposedAlias("Seed", "value_1", "Seed")).toBe(false);
  });

  it("富化名仍是别名，但本层槽位另有一个作者业务名 → 本地存的别名让位", () => {
    expect(isStaleExposedAlias("value_1", "value_1", "value_1", "Seed")).toBe(true);
    expect(isStaleExposedAlias("value_1", "value_1", "value_1", "value_1")).toBe(false);
  });

  it("作者手写的名字永不让位", () => {
    expect(isStaleExposedAlias("我的种子", "value_1", "Seed")).toBe(false);
    expect(isStaleExposedAlias("我的种子", "value_1", "value_1", "Seed")).toBe(false);
  });

  it("基准缺失（富化还没到）时一律不判定", () => {
    expect(isStaleExposedAlias("value_1", undefined, "Seed")).toBe(false);
    expect(isStaleExposedAlias(undefined, "value_1", "Seed")).toBe(false);
  });

  it("本地名是被解析好的显示名（seed）→ 不是别名", () => {
    expect(isStaleExposedAlias("seed", "value_1")).toBe(false);
  });

  it("作者手写的名字 → 不是别名", () => {
    expect(isStaleExposedAlias("我的种子", "value_1")).toBe(false);
  });

  it("基准缺失（富化未加载）或本地未命名 → 不判定", () => {
    expect(isStaleExposedAlias("value_1", undefined)).toBe(false);
    expect(isStaleExposedAlias(undefined, "value_1")).toBe(false);
  });
});
