import { describe, expect, it } from "vitest";

import type { WorkflowIOEntry } from "~/components/studio/shared/workflow-io";
import {
  enrichFromViewNodes,
  isMachineName,
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

  it("存量别名 label（等于 pin 名）让位给富化的作者名", () => {
    /* 勾选那一刻写进本地 label 的是画布显示名；修复前封装节点的显示名恰好
     *  是槽位别名 value_1。服务端已能按本层作者 label 修好富化名（"Seed"），
     *  本地那串机器名不能把它压回去（ISSUE #349）。 */
    expect(
      resolveExposedLabel(
        { label: "value_1" },
        enriched({ label: "Seed" }),
        "value_1",
      ),
    ).toBe("Seed");
  });

  it("本地 label 与 pin 名相同且富化名也是同一串（无从判定）时原样保留", () => {
    expect(
      resolveExposedLabel(
        { label: "value_1" },
        enriched({ label: "value_1" }),
        "value_1",
      ),
    ).toBe("value_1");
    expect(
      resolveExposedLabel({ label: "value_1" }, undefined, "value_1"),
    ).toBe("value_1");
  });

  it("富化名是别名时，本层作者名（slotLabel）也能把存量别名顶掉", () => {
    /* 作者名写在 wrapper 本层槽位上（`{ name: "value_1", label: "Seed" }`），
     *  但富化链里通用翻译排在前，显示名停在别名 —— 只有 slotLabel 能作证本层
     *  确实有作者命名（ISSUE #349）。 */
    expect(
      resolveExposedLabel(
        { label: "value_1" },
        enriched({ label: "value_1", slotLabel: "Seed" }),
        "value_1",
      ),
    ).toBe("value_1");
    expect(isStaleExposedAlias("value_1", "value_1", "value_1", "Seed")).toBe(
      true,
    );
  });

  it("本地作者手写的名字（非别名）依旧最高优先", () => {
    expect(
      resolveExposedLabel(
        { label: "我的种子" },
        enriched({ label: "Seed" }),
        "value_1",
      ),
    ).toBe("我的种子");
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

  it("本地未保存的 value / required / modes 整体透传", () => {
    const merged = mergeExposedEntry(
      {
        label: "seed",
        value: 7,
        required: true,
        modes: { i2v: { visible: false } },
      },
      enriched(),
    );
    expect(merged.value).toBe(7);
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

  it("带上节点类名，供「首帧 / 尾帧」这类按类名判定的消费方使用", () => {
    expect(
      enrichFromViewNodes(viewNodes)["1670::widget::value"]!.classType,
    ).toBe("PrimitiveInt");
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
    expect(isStaleExposedAlias("image", "image", "Last Frame Image")).toBe(
      true,
    );
  });

  it("本地名已经是富化名 → 不是别名，不动", () => {
    expect(isStaleExposedAlias("Seed", "value_1", "Seed")).toBe(false);
  });

  it("富化名仍是别名，但本层槽位另有一个作者业务名 → 本地存的别名让位", () => {
    expect(isStaleExposedAlias("value_1", "value_1", "value_1", "Seed")).toBe(
      true,
    );
    expect(
      isStaleExposedAlias("value_1", "value_1", "value_1", "value_1"),
    ).toBe(false);
  });

  it("封装节点的自动编号槽位：作者名回收不到时也判定为别名", () => {
    /* 作者名、富化名全都停在别名 —— 只有「宿主是封装节点 + 槽位名是自动
     *  编号」这条事实可依（ISSUE #349 的复现路径）。 */
    const wrapper = "e0940f57-80b2-480e-8a38-36968dc1763d";
    expect(
      isStaleExposedAlias("value_1", "value_1", "value_1", undefined, wrapper),
    ).toBe(true);
    expect(isStaleExposedAlias("1", "1", "1", undefined, wrapper)).toBe(true);
    /* 普通节点的同名 pin 不受影响。 */
    expect(
      isStaleExposedAlias(
        "value_1",
        "value_1",
        "value_1",
        undefined,
        "PrimitiveInt",
      ),
    ).toBe(false);
  });

  it("作者手写的名字永不让位", () => {
    expect(isStaleExposedAlias("我的种子", "value_1", "Seed")).toBe(false);
    expect(isStaleExposedAlias("我的种子", "value_1", "value_1", "Seed")).toBe(
      false,
    );
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

describe("isMachineName — 机器名判定的两条前提（ISSUE #349）", () => {
  it("候选串必须与真实 pin 名逐字相同才可能被当成机器名", () => {
    /* 作者手写的名字（`seed` / `我的种子`）与 pin 名不同 → 一律不是机器名，
     *  哪怕富化链给的是另一个名字。这是「作者命名永不让位」的机器化表达。 */
    expect(
      isMachineName("seed", { name: "value_1", enrichedLabel: "value_1" }),
    ).toBe(false);
    expect(
      isMachineName("我的种子", { name: "value_1", enrichedLabel: "Seed" }),
    ).toBe(false);
    expect(
      isMachineName("Seed", { name: "value_1", enrichedLabel: "value_1" }),
    ).toBe(false);
  });

  it("① 候选串就是 pin 名、富化链另有更好的名字 → 机器名", () => {
    expect(
      isMachineName("value_1", { name: "value_1", enrichedLabel: "Seed" }),
    ).toBe(true);
    expect(
      isMachineName("image", {
        name: "image",
        enrichedLabel: "Last Frame Image",
      }),
    ).toBe(true);
  });

  it("② 富化名也停在 pin 名，但勾选时画布透传的作者名不是它 → 机器名", () => {
    /* 图一 / 图二那条工作流的形状：wrapper 槽位 `value_1` → 内部
     * `PrimitiveInt.value`，富化名停在槽位名，只有 slotLabel 还能作证本层
     * 有作者命名。只看名字相不相等永远判不出来 —— 那正是它一直复活的原因。 */
    expect(
      isMachineName("value_1", {
        name: "value_1",
        enrichedLabel: "value_1",
        slotLabel: "Seed",
      }),
    ).toBe(true);
    expect(
      isMachineName("1", { name: "1", enrichedLabel: "1", slotLabel: "Seed" }),
    ).toBe(true);
  });

  it("③ 槽位名是封装节点的自动编号别名 → 机器名，不需要别的来源作证", () => {
    /* 作者名可能整体回收不到（子图导出缺 `-10` 哨兵边），此时①与②都无从
     *  作证；而 `value_N` / 裸序号本来就是 ComfyUI 编出来的，不可能是作者
     *  手写 —— 少了这条判据，别名会一直以「未命名」的名义活下来，切一次
     *  seed 行为就被重新固化回库（ISSUE #349 的复现路径）。 */
    const wrapper = { classType: "e0940f57-80b2-480e-8a38-36968dc1763d" };
    expect(
      isMachineName("value_1", {
        name: "value_1",
        enrichedLabel: "value_1",
        ...wrapper,
      }),
    ).toBe(true);
    expect(isMachineName("1", { name: "1", ...wrapper })).toBe(true);
    expect(isMachineName("value_12", { name: "value_12", ...wrapper })).toBe(
      true,
    );
  });

  it("③ 只对封装节点生效：普通节点的 pin 名即使长得像也不清", () => {
    /* `LoadImage.image`、`KSampler.seed` 这类 pin 名是插件作者定义的，
     *  可能恰好长成 `value_1`；把普通节点也纳入会让作者命名被误清。 */
    expect(
      isMachineName("value_1", { name: "value_1", enrichedLabel: "value_1" }),
    ).toBe(false);
    expect(
      isMachineName("value_1", {
        name: "value_1",
        enrichedLabel: "value_1",
        classType: "PrimitiveInt",
      }),
    ).toBe(false);
    expect(
      isMachineName("1", {
        name: "1",
        enrichedLabel: "1",
        classType: "LoadImage",
      }),
    ).toBe(false);
  });

  it("③ 作者手写的名字（与槽位名不同）依旧不让位", () => {
    const wrapper = { classType: "e0940f57-80b2-480e-8a38-36968dc1763d" };
    expect(isMachineName("我的种子", { name: "value_1", ...wrapper })).toBe(
      false,
    );
    expect(isMachineName("Seed", { name: "Seed", ...wrapper })).toBe(false);
  });

  it("两个来源都指不出别的名字 → 无从判定，宁可留着", () => {
    expect(
      isMachineName("value_1", { name: "value_1", enrichedLabel: "value_1" }),
    ).toBe(false);
    expect(isMachineName("value_1", { name: "value_1" })).toBe(false);
    expect(
      isMachineName("value_1", {
        name: "value_1",
        enrichedLabel: "value_1",
        slotLabel: "value_1",
      }),
    ).toBe(false);
  });

  it("基准缺失（富化还没到 / 未命名）时一律不判定", () => {
    expect(
      isMachineName("value_1", { name: undefined, enrichedLabel: "Seed" }),
    ).toBe(false);
    expect(
      isMachineName(undefined, { name: "value_1", enrichedLabel: "Seed" }),
    ).toBe(false);
    expect(
      isMachineName("   ", { name: "value_1", enrichedLabel: "Seed" }),
    ).toBe(false);
  });

  it("判定不依赖「我们记得写过这个键」——同一组事实反复判结果一致", () => {
    const facts = { name: "value_1", enrichedLabel: "Seed", slotLabel: "Seed" };
    expect(isMachineName("value_1", facts)).toBe(true);
    expect(isMachineName("value_1", facts)).toBe(true);
    expect(isMachineName("Seed", facts)).toBe(false);
  });
});

describe("resolveExposedLabel — 本地 label 与富化名同源时以富化链为准（ISSUE #349）", () => {
  it("本地存的与富化名逐字相同、且都不是 pin 名 → 取富化名，不把它竖成作者命名", () => {
    /* 勾选那一刻写进本地 label 的就是画布显示名，而画布显示名正是从同一个
     *  槽位读出来的：它在本地躺着并不代表作者命名过。把它当作者命名会让任何
     *  一次写入重新固化它，显示名随即退回那串名字。 */
    expect(
      resolveExposedLabel({ label: "1" }, enriched({ label: "1" }), "value_1"),
    ).toBe("1");
    expect(
      resolveExposedLabel(
        { label: "1" },
        enriched({ label: "1", slotLabel: "Seed" }),
        "value_1",
      ),
    ).toBe("1");
  });

  it("富化链另有更好的名字时本地那串机器名让位", () => {
    expect(
      resolveExposedLabel(
        { label: "value_1" },
        enriched({ label: "Seed" }),
        "value_1",
      ),
    ).toBe("Seed");
  });

  it("作者手写的名字（与富化名不同、与 pin 名也不同）依旧最高优先", () => {
    expect(
      resolveExposedLabel(
        { label: "我的种子" },
        enriched({ label: "Seed" }),
        "value_1",
      ),
    ).toBe("我的种子");
    expect(
      resolveExposedLabel(
        { label: "seed" },
        enriched({ label: "value_1" }),
        "value_1",
      ),
    ).toBe("seed");
  });

  it("本地未命名时按 富化名 → pin 名 回退", () => {
    expect(
      resolveExposedLabel({}, enriched({ label: "Seed" }), "value_1"),
    ).toBe("Seed");
    expect(resolveExposedLabel({}, undefined, "value_1")).toBe("value_1");
  });
});
