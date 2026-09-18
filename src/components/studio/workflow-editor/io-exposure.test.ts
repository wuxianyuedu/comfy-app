import { describe, expect, it } from "vitest";

import type { WorkflowIOEntry } from "~/components/studio/shared/workflow-io";
import {
  enrichFromViewNodes,
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
  it("作者在面板里的重命名优先于服务端富化名", () => {
    expect(resolveExposedLabel({ label: "seed" }, enriched(), "value_1")).toBe(
      "seed",
    );
  });

  it("本地没重命名过时用服务端富化名", () => {
    expect(
      resolveExposedLabel({}, enriched({ label: "随机种子" }), "value_1"),
    ).toBe("随机种子");
  });

  it("本地与服务端都没有名字时回退原始 pin 名", () => {
    expect(resolveExposedLabel({}, undefined, "value_1")).toBe("value_1");
    expect(
      resolveExposedLabel({}, enriched({ label: undefined }), "value_1"),
    ).toBe("value_1");
  });

  it("空白本地 label 视为未命名", () => {
    expect(resolveExposedLabel({ label: "   " }, undefined, "value_1")).toBe(
      "value_1",
    );
  });

  it("库里的 label 直读 —— 哪怕它长得像别名（不再有让位判定）", () => {
    /* `label` 的唯一写入点是面板改名框（勾选不再抄画布显示名进库），所以
     *  库里存着 `value_1` 就是作者真的要它叫 `value_1`；想回到富化名，清空
     *  改名即可（下一条）。 */
    expect(
      resolveExposedLabel(
        { label: "value_1" },
        enriched({ label: "Seed" }),
        "value_1",
      ),
    ).toBe("value_1");
    expect(
      resolveExposedLabel(
        { label: "image" },
        enriched({ name: "image", label: "Last Frame Image" }),
        "image",
      ),
    ).toBe("image");
  });

  it("清掉改名（label 为空）后回到富化名", () => {
    expect(
      resolveExposedLabel(
        { label: undefined },
        enriched({ label: "Last Frame Image" }),
        "image",
      ),
    ).toBe("Last Frame Image");
    /* 富化链也停在 pin 名时，如实显示 pin 名（没有别的名字可用）。 */
    expect(
      resolveExposedLabel(
        { label: undefined },
        enriched({ label: "value_1" }),
        "value_1",
      ),
    ).toBe("value_1");
  });

  it("与画布同款清洗：剥掉 COMBO 候选串，两处显示完全一致", () => {
    expect(
      resolveExposedLabel({ label: "模型: A = B | C = D" }, undefined, "model"),
    ).toBe("模型");
    expect(
      resolveExposedLabel(
        {},
        enriched({ label: "模型: A = B | C = D" }),
        "model",
      ),
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

  it("本地未保存的 required / modes 整体透传", () => {
    const merged = mergeExposedEntry(
      {
        label: "seed",
        required: true,
        modes: { i2v: { visible: false } },
      },
      enriched(),
    );
    expect(merged.required).toBe(true);
    expect(merged.modes).toEqual({ i2v: { visible: false } });
  });

  it("本地没有 label 时沿用服务端富化名，不会把名字清空", () => {
    const merged = mergeExposedEntry(
      {},
      enriched({ label: "Last Frame Image" }),
    );
    expect(merged.label).toBe("Last Frame Image");
  });
});

describe("enrichFromViewNodes — 子图内层视图的就地富化兜底", () => {
  const viewNodes = [
    {
      id: "1670",
      class_type: "PrimitiveInt",
      raw_inputs: [
        {
          name: "value",
          label: "Seed",
          localized: "随机种",
          type: "INT",
          widgetValue: 1234,
        },
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

  it("无节点 / 无 raw_inputs 时返回空表", () => {
    expect(enrichFromViewNodes(null)).toEqual({});
    expect(enrichFromViewNodes([{ id: "1" }])).toEqual({});
  });
});
