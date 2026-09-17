import { describe, expect, it } from "vitest";

import type { WorkflowIOMap } from "~/lib/workflow-io-types";
import {
  applyParamMapping,
  buildParamEntries,
  buildSourceOverrides,
  familyOfClass,
  clearModeWiring,
  handleIdForIoKey,
  hasManualWiring,
  ioKeyForHandle,
  isDefaultMapping,
  paramOutputPorts,
  pinFamily,
  defaultOutputPortIndex,
  parseParamMapping,
  pinAcceptsEntry,
  portTypeDisplay,
  resolveMapping,
  runtimeNodeId,
  serializeParamMapping,
  wiredTargetsForEntry,
} from "~/lib/workflow-param-mapping";

/** 造一个 IO 条目：默认都是可编辑 widget 输入。 */
function pin(
  nodeId: string,
  name: string,
  extra: Partial<WorkflowIOMap[string]> = {},
): WorkflowIOMap[string] {
  return {
    direction: "input",
    kind: "widget",
    nodeId,
    name,
    type: "STRING",
    ...extra,
  };
}

describe("pinFamily — 分类只看声明类型", () => {
  it("STRING → text、图片系 → image、数值 / 候选表 → number", () => {
    expect(pinFamily(pin("1", "positive_prompt"))).toBe("text");
    expect(pinFamily(pin("1", "negative_prompt"))).toBe("text");
    /* 名字里写没写「正向 / 负向」都不影响归类：谁是谁由作者的连线声明。 */
    expect(pinFamily(pin("6", "text"))).toBe("text");
    expect(pinFamily(pin("7", "text"))).toBe("text");
    expect(pinFamily(pin("1", "first_frame", { type: "IMAGE" }))).toBe("image");
    expect(pinFamily(pin("1", "last_frame", { type: "IMAGE" }))).toBe("image");
    expect(pinFamily(pin("1", "ref_image", { type: "IMAGE" }))).toBe("image");
    expect(pinFamily(pin("8", "image", { type: "MASK" }))).toBe("image");
    expect(pinFamily(pin("1", "width", { type: "INT" }))).toBe("number");
    expect(pinFamily(pin("1", "aspect_ratio", { type: "COMBO" }))).toBe(
      "number",
    );
    /* 时长口也是数值行 —— 它和「尺寸」同族，谁是谁由连线声明（不再按名字认
     * duration / length / frames）。 */
    expect(pinFamily(pin("1", "fps", { type: "INT" }))).toBe("number");
    /* 未知类型按最宽的数值族收。 */
    expect(pinFamily(pin("1", "seed", { type: "*" }))).toBe("number");
    expect(pinFamily(pin("1", "seed", { type: undefined }))).toBe("number");
  });

  it("连线型端口、输出口、未知类型都不属于任何族", () => {
    expect(pinFamily(pin("1", "model", { kind: "param", type: "MODEL" }))).toBe(
      null,
    );
    expect(
      pinFamily(pin("1", "IMAGE", { direction: "output", type: "IMAGE" })),
    ).toBe(null);
    expect(pinFamily(pin("1", "clip", { type: "CLIP" }))).toBe(null);
  });

  it("族内几个对外参数共享同一份候选（谁是谁由连线声明）", () => {
    expect(familyOfClass("prompt")).toBe("text");
    expect(familyOfClass("negative")).toBe("text");
    expect(familyOfClass("reference-image")).toBe("image");
    expect(familyOfClass("first-frame")).toBe("image");
    expect(familyOfClass("last-frame")).toBe("image");
    expect(familyOfClass("size-aspect")).toBe("number");
    expect(familyOfClass("duration")).toBe("number");
    /* 聚合值 `size` 与六个子口同族（都只吃数值行）；内部参数 `other` 不接受
     * 任何端口。 */
    expect(familyOfClass("size")).toBe("number");
    expect(familyOfClass("other")).toBe(null);
  });
});

describe("pinAcceptsEntry —— 手工拖线的类型闸门", () => {
  const aspect = pin("5", "aspect_ratio", {
    type: "COMBO",
    options: ["16:9"],
  });
  const promptRow = pin("9", "positive_prompt", {
    type: "STRING",
    defaultValue: "一只猫在喝山泉的完整描述词，足够长到被判定成提示词口",
  });

  it("提示词口落不到尺寸口上（STRING 提示词行 vs COMBO 宽高比）", () => {
    expect(pinAcceptsEntry("prompt", promptRow)).toBe(true);
    expect(pinAcceptsEntry("prompt", aspect)).toBe(false);
  });

  it("「尺寸」口接受宽/高/宽高比/像素量，但不吃提示词行", () => {
    expect(pinAcceptsEntry("size", pin("5", "width", { type: "INT" }))).toBe(
      true,
    );
    expect(pinAcceptsEntry("size", aspect)).toBe(true);
    expect(pinAcceptsEntry("size", promptRow)).toBe(false);
  });

  it("参考图口只吃图片行；端口不在 IO 表里（或分类为 other）一律判不上", () => {
    expect(
      pinAcceptsEntry("reference-image", pin("9", "image", { type: "IMAGE" })),
    ).toBe(true);
    expect(pinAcceptsEntry("reference-image", promptRow)).toBe(false);
    expect(pinAcceptsEntry("prompt", undefined)).toBe(false);
    expect(pinAcceptsEntry("prompt", pin("3", "steps", { type: "INT" }))).toBe(
      false,
    );
  });

  it("尺寸族按类型收候选 —— 端口名怎么起都不影响", () => {
    /* 名字不再参与判定：是数值行就是尺寸子口的候选，「这一行是宽还是比例」由
     *  作者连到哪个子口声明（`base_width` / `prompt_width_of_thing` 一视同仁）。 */
    expect(
      pinAcceptsEntry("size-width", pin("1", "base_width", { type: "INT" })),
    ).toBe(true);
    expect(
      pinAcceptsEntry("size-width", pin("1", "prompt_width_of_thing")),
    ).toBe(false);
    expect(
      pinAcceptsEntry(
        "size-aspect",
        pin("1", "prompt_width_of_thing", { type: "INT" }),
      ),
    ).toBe(true);
    expect(pinAcceptsEntry("size-aspect", promptRow)).toBe(false);
  });

  it("连线型端口与输出口不属于任何族（判不上）", () => {
    expect(pinFamily(pin("1", "model", { kind: "param", type: "MODEL" }))).toBe(
      null,
    );
    expect(
      pinFamily({
        direction: "output",
        kind: "output",
        nodeId: "1",
        name: "IMAGE",
      }),
    ).toBe(null);
    /* 连线型类型（CLIP / LATENT…）即使名字像也不会被收进任何族。 */
    expect(pinFamily(pin("1", "clip", { type: "CLIP" }))).toBe(null);
  });
});

describe("buildParamEntries — 统一对外参数契约（按模式）", () => {
  const io: WorkflowIOMap = {
    "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
    "5::widget::height": pin("5", "height", { type: "INT", defaultValue: 512 }),
    "5::widget::steps": pin("5", "steps", { type: "INT", defaultValue: 20 }),
    "9::widget::text": pin("9", "text", {
      defaultValue: "a very long positive prompt used by the workflow author",
    }),
  };

  it("条目只来自契约：工作流内部参数（步数 / CFG…）不再是「对外参数」", () => {
    const ids = buildParamEntries(io, undefined, { mode: "T2I" }).map(
      (entry) => entry.id,
    );
    /* 契约口一律常驻：工作流里没有 `negative` 那一行也照样列出这一口
     *  （落点为空 = 未配置），显示与否不跟着工作流内容走。
     *  「尺寸」在映射层是四个子口（形态由作者连线声明，见 SIZE_SUB_IDS）。 */
    expect(ids).toEqual([
      "prompt",
      "negative",
      "size-width",
      "size-height",
      "size-aspect",
      "size-megapixels",
      "size-resolution",
      "size-multiple",
    ]);
  });

  it("「尺寸」摊成四个子口：候选按类型收，形态由作者连线声明", () => {
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const width = entries.find((entry) => entry.id === "size-width")!;
    /* 三个数值口（width / height / steps）都是候选 —— **按类型收，不看名字**：
     * 「这个口是宽度」由作者把它连到「尺寸 · 宽」来声明，不由端口名判定。 */
    expect(width.pins.map((item) => item.name)).toEqual([
      "width",
      "height",
      "steps",
    ]);
    expect(width.label).toBe("尺寸 · 宽度");
    expect(entries.find((entry) => entry.id === "size-aspect")!.pins).toEqual(
      width.pins,
    );
    /* 名字像「尺寸」的口不再被单独摘出来：形态由子口身份给出，端口名不参与。 */
    expect(width.cls).toBe("size-width");
  });

  it("按模式给口子：单图生视频多一个首帧，文生图没有", () => {
    const videoIO: WorkflowIOMap = {
      ...io,
      "11::widget::image": pin("11", "first_frame", { type: "IMAGE" }),
    };
    expect(
      buildParamEntries(videoIO, undefined, { mode: "I2V" }).map(
        (entry) => entry.id,
      ),
    ).toEqual([
      "prompt",
      "negative",
      "first-frame",
      "size-width",
      "size-height",
      "size-aspect",
      "size-megapixels",
      "size-resolution",
      "size-multiple",
      "duration",
    ]);
    expect(
      buildParamEntries(videoIO, undefined, { mode: "T2I" }).map(
        (entry) => entry.id,
      ),
    ).toEqual([
      "prompt",
      "negative",
      "size-width",
      "size-height",
      "size-aspect",
      "size-megapixels",
      "size-resolution",
      "size-multiple",
    ]);
  });

  it("工作流一个可落点端口都没有时，契约口照样列出（零候选 = 未配置）", () => {
    const internalOnly: WorkflowIOMap = {
      "5::widget::steps": pin("5", "steps", { type: "INT", defaultValue: 20 }),
    };
    const entries = buildParamEntries(internalOnly, undefined, {
      mode: "T2I",
    });
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    expect(Array.from(byId.keys())).toEqual([
      "prompt",
      "negative",
      "size-width",
      "size-height",
      "size-aspect",
      "size-megapixels",
      "size-resolution",
      "size-multiple",
    ]);
    /* 没有可落点的口如实零候选（未配置）。 */
    expect(byId.get("prompt")!.pins).toEqual([]);
    expect(byId.get("negative")!.pins).toEqual([]);
    /* 尺寸的候选按类型收 —— steps 是 INT，所以它也在候选里（选对选错由作者
     * 连的那条线负责，这正是「不猜形态」的代价与前提）。 */
    expect(byId.get("size-width")!.pins.map((item) => item.name)).toEqual([
      "steps",
    ]);
  });

  it("卡片名是契约里的统一名，不跟着工作流端口名走", () => {
    const renamed: WorkflowIOMap = {
      "9::widget::text": pin("9", "text", { label: "画面描述" }),
    };
    const prompt = buildParamEntries(renamed, undefined, { mode: "T2I" }).find(
      (entry) => entry.id === "prompt",
    )!;
    expect(prompt.label).toBe("提示词");
  });

  it("不传 mode 时退到最保守的一套（提示词 + 尺寸子口）", () => {
    const ids = buildParamEntries(io)
      .map((entry) => entry.id)
      .sort();
    expect(ids).toEqual([
      "negative",
      "prompt",
      "size-aspect",
      "size-height",
      "size-megapixels",
      "size-multiple",
      "size-resolution",
      "size-width",
    ]);
  });
});

describe("resolveMapping — 落点只由作者画的线决定", () => {
  const io: WorkflowIOMap = {
    "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
    "5::widget::resolution": pin("5", "resolution", { type: "COMBO" }),
  };
  const entries = buildParamEntries(io, undefined, { mode: "T2I" });
  const entryId = entries[0]!.id;

  it("没有任何线 → 空表（未配置），不再替作者猜一个落点", () => {
    expect(resolveMapping(entries, io, null, "T2I")).toEqual({});
    expect(resolveMapping(entries, io, { manualByMode: {} }, "T2I")).toEqual(
      {},
    );
  });

  it("作者画的线就是落点", () => {
    const mapping = {
      manualByMode: { T2I: { [entryId]: "5::widget::resolution" } },
    };
    expect(resolveMapping(entries, io, mapping, "T2I")[entryId]).toBe(
      "5::widget::resolution",
    );
    /* 另一个模式没有线 → 未配置（线是按模式分开的）。 */
    expect(
      resolveMapping(entries, io, mapping, "I2I")[entryId],
    ).toBeUndefined();
  });

  it("没有模式时不承认任何线（不存在脱离模式的线）", () => {
    const mapping = {
      manualByMode: { T2I: { [entryId]: "5::widget::resolution" } },
    };
    expect(resolveMapping(entries, io, mapping, null)).toEqual({});
  });

  it("某模式下显式断开 → 该模式「未连线」（null 与「没连过」区分开）", () => {
    const mapping = { manualByMode: { I2I: { [entryId]: null } } };
    expect(resolveMapping(entries, io, mapping, "I2I")[entryId]).toBeNull();
    expect(
      resolveMapping(entries, io, mapping, "T2I")[entryId],
    ).toBeUndefined();
  });

  it("落点端口已不存在（改名 / 移除）→ 按未配置处理，不让线静默落空", () => {
    const mapping = {
      manualByMode: { T2I: { [entryId]: "5::widget::gone" } },
    };
    expect(
      resolveMapping(entries, io, mapping, "T2I")[entryId],
    ).toBeUndefined();
  });
});

describe("默认连线状态的判定与恢复默认", () => {
  const io: WorkflowIOMap = {
    "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
  };
  const entryId = buildParamEntries(io, undefined, { mode: "T2I" })[0]!.id;

  it("isDefaultMapping：没有该模式的线才是默认", () => {
    const mapping = {
      manualByMode: { T2I: { [entryId]: "5::widget::width" } },
    };
    expect(isDefaultMapping(mapping, entryId, "T2I")).toBe(false);
    expect(isDefaultMapping(mapping, entryId, "I2I")).toBe(true);
    /* 没有模式 = 不承认任何线 = 永远是默认。 */
    expect(isDefaultMapping(mapping, entryId, null)).toBe(true);
    expect(isDefaultMapping(null, entryId, "T2I")).toBe(true);
  });

  it("hasManualWiring：按模式统计作者改过的线", () => {
    const mapping = { manualByMode: { T2I: { [entryId]: null } } };
    expect(hasManualWiring(mapping, "T2I")).toBe(true);
    expect(hasManualWiring(mapping, "I2I")).toBe(false);
    expect(hasManualWiring(mapping, null)).toBe(false);
  });

  it("clearModeWiring：整模式清空，其余模式原样保留", () => {
    const mapping = {
      manualByMode: { T2I: { a: "x" }, I2I: { a: "y" } },
      labels: { k: "名字" },
    };
    const cleared = clearModeWiring(mapping, "T2I");
    expect(cleared.manualByMode).toEqual({ I2I: { a: "y" } });
    expect(cleared.labels).toEqual({ k: "名字" });
    /* 不改原对象。 */
    expect(mapping.manualByMode.T2I).toEqual({ a: "x" });
  });
});

describe("parseParamMapping / serializeParamMapping", () => {
  it("往返：只写 source 命名空间，其余键原样保留", () => {
    const mapping = {
      manualByMode: { I2I: { "size-width": "5::widget::resolution" } },
    };
    const merged = serializeParamMapping(mapping, { positiveNode: "9" });
    expect(merged.positiveNode).toBe("9");
    expect(merged.source).toEqual({
      "mode:I2I": { "size-width": "5::widget::resolution" },
    });
    const parsed = parseParamMapping(merged);
    expect(parsed.manualByMode).toEqual({
      I2I: { "size-width": "5::widget::resolution" },
    });
    /* 往返之后 resolveMapping 必须仍然认得出来（曾经这里丢了按模式的线）。 */
    const io: WorkflowIOMap = {
      "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
      "5::widget::resolution": pin("5", "resolution", { type: "COMBO" }),
    };
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    expect(resolveMapping(entries, io, parsed, "I2I")["size-width"]).toBe(
      "5::widget::resolution",
    );
  });

  it("拆分前那个单键 `size` 线被丢弃 —— 不再原样往返", () => {
    const parsed = parseParamMapping({
      source: {
        "mode:T2I": { size: "5::widget::width", prompt: "9::widget::text" },
      },
    });
    /* 同一个模式表里其余口子的线照旧。（`size` 不是任何入口的 id：契约里的
     *  「尺寸」在映射层就是六个子口。） */
    expect(parsed.manualByMode).toEqual({
      T2I: { prompt: "9::widget::text" },
    });
    /* 再落库时它不会回来 —— 库里那个键从此消失，不需要额外迁移。 */
    expect(serializeParamMapping(parsed, {})).toEqual({
      source: { "mode:T2I": { prompt: "9::widget::text" } },
    });
  });

  it("整个模式表只剩那个 `size` 键时整条消失（不留空壳）", () => {
    const parsed = parseParamMapping({
      source: { "mode:T2I": { size: "5::widget::width" } },
    });
    expect(parsed.manualByMode).toEqual({});
    expect(serializeParamMapping(parsed, {})).toEqual({ source: {} });
  });

  it("没有 `mode:` 前缀的键一律丢弃（通用手工线已取消）", () => {
    const parsed = parseParamMapping({
      source: {
        /* 历史形状的通用手工线 —— 没有生效语境，丢弃。 */
        "size-width": "5::widget::resolution",
        "5|other": null,
        bad: 123,
        deep: { M1: "ok" },
        "mode:": { any: "x" },
        "mode:T2I": { a: "ok", b: null, c: 5 },
      },
    });
    expect(parsed.manualByMode).toEqual({ T2I: { a: "ok", b: null } });
    expect(parseParamMapping(null).manualByMode).toEqual({});
    expect(parseParamMapping([1, 2]).manualByMode).toEqual({});
    expect(parseParamMapping({ source: [1, 2] }).manualByMode).toEqual({});
  });

  it("某模式显式断开（null）能往返保存", () => {
    const merged = serializeParamMapping(
      { manualByMode: { I2I: { "size-width": null } } },
      {},
    );
    expect(parseParamMapping(merged).manualByMode).toEqual({
      I2I: { "size-width": null },
    });
  });

  it("空模式表不落库", () => {
    const merged = serializeParamMapping({ manualByMode: { I2I: {} } }, {});
    expect(merged.source).toEqual({});
  });
});

describe("applyParamMapping — 运行期落值", () => {
  const io: WorkflowIOMap = {
    "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
    "5::widget::steps": pin("5", "steps", { type: "INT", defaultValue: 20 }),
    "9::widget::text": pin("9", "text", { defaultValue: "built-in" }),
  };

  it("作者画过线的对外参数：用户值只落到被连的端口，该节点其余默认值不掺进来", () => {
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const { inputs } = applyParamMapping({
      io,
      entries,
      mapping: {
        manualByMode: {
          T2I: { "size-width": "5::widget::width" },
        },
      },
      values: { "size-width": 1024 },
      mode: "T2I",
    });
    expect(inputs.find((item) => item.name === "width")?.value).toBe(1024);
  });

  it("没连过的对外参数给了值 → 如实进 unmatched，不替作者挑一个端口", () => {
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const { inputs, unmatched } = applyParamMapping({
      io,
      entries,
      mapping: null,
      values: { "size-width": 1024 },
    });
    expect(unmatched).toContain("size-width");
    /* 没连线 → 什么都不下发（工作流图内的默认值照旧生效）。 */
    expect(inputs).toEqual([]);
  });

  it("显式断开（null）的对外参数：用户值如实录进 unmatched，不凭空落端口", () => {
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const { inputs, unmatched } = applyParamMapping({
      io,
      entries,
      mapping: {
        manualByMode: { T2I: { "size-width": null } },
      },
      values: { "size-width": 1024 },
      mode: "T2I",
    });
    expect(unmatched).toContain("size-width");
    /* 断开的是「外部值往这落」：值不落端口，也不替作者塞默认值。 */
    expect(inputs).toEqual([]);
  });

  it("另一模式的线不影响本模式（模式线只在该模式生效）", () => {
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const { inputs, unmatched } = applyParamMapping({
      io,
      entries,
      mapping: {
        manualByMode: { I2I: { "size-width": "5::widget::width" } },
      },
      values: { "size-width": 1024 },
      mode: "T2I",
    });
    /* 本模式没有线 → 值落不上，如实记进 unmatched。 */
    expect(unmatched).toContain("size-width");
    expect(inputs).toEqual([]);
  });

  it("契约条目：作者按契约 id 画线后，值可以按契约 id（工坊侧）或 ioKey（运行期表单）给", () => {
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const mapping = {
      manualByMode: { T2I: { "size-width": "5::widget::width" } },
    };
    /* 工坊侧按契约 id 给。 */
    const byContract = applyParamMapping({
      io,
      entries,
      mapping,
      values: { size: 1024 },
      mode: "T2I",
    });
    expect(byContract.inputs.find((item) => item.name === "width")?.value).toBe(
      1024,
    );
    /* 运行期表单按 ioKey 给（DynamicWorkflowForm 的行键就是 ioKey）。 */
    const byPinKey = applyParamMapping({
      io,
      entries,
      mapping,
      values: { "5::widget::width": 768 },
      mode: "T2I",
    });
    expect(byPinKey.inputs.find((item) => item.name === "width")?.value).toBe(
      768,
    );
  });

  it("契约条目：改版前落库的 `<节点 id>|<分类>` 键仍算作者的线", () => {
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const { inputs } = applyParamMapping({
      io,
      entries,
      mapping: { manualByMode: { T2I: { "size-width": null } } },
      values: { "5::widget::width": 1024 },
      mode: "T2I",
    });
    /* 作者当年把「尺寸」显式断开了 → 用户值不落任何端口（不凭空兜底）。 */
    expect(inputs.find((item) => item.name === "width")?.value).not.toBe(1024);
  });

  it("未连线时不下发任何值（工作流图内自带的默认值照旧生效）", () => {
    /* 候选是按类型收的：同一份候选被同族几个口子共享（宽 / 高与步数混在
     *  一起），逐个下发它们的工作流默认值会把作者没连过的口写进载荷。
     *  没连线就是「未配置」—— 不落值，也不替作者挑端口。 */
    const { inputs } = applyParamMapping({
      io,
      entries: buildParamEntries(io, undefined, { mode: "T2I" }),
      mapping: null,
      values: {},
    });
    expect(inputs).toEqual([]);
  });
});

describe("buildSourceOverrides", () => {
  it("产出「对外参数 id → 目标 ioKey」的覆盖表（含 null 断开）", () => {
    const io: WorkflowIOMap = {
      "5::widget::width": pin("5", "width", { type: "INT" }),
    };
    const mapping = {
      manualByMode: { T2I: { "size-width": "5::widget::width" } },
    };
    const overrides = buildSourceOverrides(
      buildParamEntries(io, undefined, { mode: "T2I" }),
      io,
      mapping,
      "T2I",
    );
    expect(overrides["size-width"]).toBe("5::widget::width");
    /* 没有线 → 表里没有这个口（未配置，不是「断成 null」）。 */
    expect(
      buildSourceOverrides(
        buildParamEntries(io, undefined, { mode: "T2I" }),
        io,
        null,
        "T2I",
      ),
    ).toEqual({});
  });
});

describe("runtimeNodeId — 运行期节点 id 还原", () => {
  it("顶层勾选原样下发", () => {
    expect(runtimeNodeId({ nodeId: "24" })).toBe("24");
  });

  it("子图内部勾选用宿主 id 拼成 comfy-cli 展开后的 `host:inner`", () => {
    expect(runtimeNodeId({ nodeId: "1670", hostNodeId: "4" })).toBe("4:1670");
    expect(runtimeNodeId({ nodeId: "1670", hostNodeId: "4:5" })).toBe(
      "4:5:1670",
    );
  });

  it("已经是拼接形式（旧数据）时不重复拼", () => {
    expect(runtimeNodeId({ nodeId: "4:1670", hostNodeId: "4" })).toBe("4:1670");
  });
});

describe("applyParamMapping — 子图内部条目的运行期节点 id", () => {
  const innerIo: WorkflowIOMap = {
    "1670::widget::value": pin("1670", "value", {
      type: "INT",
      defaultValue: 1,
      hostNodeId: "4",
    }),
  };

  it("值下发时带上宿主前缀，运行期才能落到 `4:1670`", () => {
    const entries = buildParamEntries(innerIo, undefined, { mode: "T2I" });
    const { inputs } = applyParamMapping({
      io: innerIo,
      entries,
      mapping: {
        manualByMode: { T2I: { "size-width": "1670::widget::value" } },
      },
      values: { size: "1024x768" },
      mode: "T2I",
    });
    expect(inputs).toEqual([{ nodeId: "4:1670", name: "value", value: 1024 }]);
  });
});

describe("handleIdForIoKey / ioKeyForHandle — 两个键空间互转（ISSUE #374）", () => {
  const map: WorkflowIOMap = {
    "1512::widget::value": pin("1512", "value", { type: "BOOLEAN" }),
    "23::widget::upload": pin("23", "upload", { type: "IMAGEUPLOAD" }),
    /* pin 名里带 `::` —— 证明不能靠切分 ioKey 反推 pin 名。 */
    "7::widget::weird::name": pin("7", "weird::name", { type: "STRING" }),
  };

  it("ioKey → 渲染 handle id 取的是 pin 名", () => {
    expect(handleIdForIoKey(map, "1512::widget::value")).toBe("value");
    expect(handleIdForIoKey(map, "23::widget::upload")).toBe("upload");
    expect(handleIdForIoKey(map, "7::widget::weird::name")).toBe("weird::name");
  });

  it("pin 名含 `::` 时不会被切错", () => {
    /* 天真实现（split("::") 取末段）会得到 "name"，与渲染的 handle id 不符。 */
    expect(handleIdForIoKey(map, "7::widget::weird::name")).toBe(
      map["7::widget::weird::name"]!.name,
    );
  });

  it("查不到（条目已移除 / io 未就绪）回 null，调用方据此不画线", () => {
    expect(handleIdForIoKey(map, "404::widget::nope")).toBeNull();
    expect(handleIdForIoKey(map, null)).toBeNull();
    expect(handleIdForIoKey({}, "1512::widget::value")).toBeNull();
  });

  it("逆向：handle id + 节点 id → ioKey", () => {
    expect(ioKeyForHandle(map, "1512", "value")).toBe("1512::widget::value");
    expect(ioKeyForHandle(map, "7", "weird::name")).toBe(
      "7::widget::weird::name",
    );
    /* 节点对不上 / handle 不存在 → null（合法性闸门据此拒绝）。 */
    expect(ioKeyForHandle(map, "23", "value")).toBeNull();
    expect(ioKeyForHandle(map, "1512", "nope")).toBeNull();
    expect(ioKeyForHandle(map, "1512", null)).toBeNull();
  });

  it("往返自洽：ioKey → handle → ioKey 还原同一个键", () => {
    for (const ioKey of Object.keys(map)) {
      const handleId = handleIdForIoKey(map, ioKey)!;
      expect(ioKeyForHandle(map, map[ioKey]!.nodeId, handleId)).toBe(ioKey);
    }
  });
});

describe("paramOutputPorts — 卡片的输出端口（ISSUE #355 复审）", () => {
  const outIo: WorkflowIOMap = {
    "9::widget::text": {
      direction: "input",
      kind: "widget",
      nodeId: "9",
      name: "positive_prompt",
      label: "提示词",
      type: "STRING",
      defaultValue: "3只小猫在喝山泉的完整描述词，足够长到被判成提示词口",
    },
    "5::widget::width": {
      direction: "input",
      kind: "widget",
      nodeId: "5",
      name: "width",
      type: "INT",
      defaultValue: 512,
    },
    "5::widget::height": {
      direction: "input",
      kind: "widget",
      nodeId: "5",
      name: "height",
      type: "INT",
      defaultValue: 512,
    },
    "5::widget::aspect_ratio": {
      direction: "input",
      kind: "widget",
      nodeId: "5",
      name: "aspect_ratio",
      type: "COMBO",
      options: ["16:9", "1:1"],
    },
    "5::widget::megapixels": {
      direction: "input",
      kind: "widget",
      nodeId: "5",
      name: "megapixels",
      type: "FLOAT",
      defaultValue: 1,
    },
  };

  it("类型与端口名取自**真正落到的端口**（提示词落到 text 就是 STRING）", () => {
    const entries = buildParamEntries(outIo, undefined, { mode: "T2I" });
    const prompt = entries.find((entry) => entry.id === "prompt")!;
    const ports = paramOutputPorts(prompt, outIo, "9::widget::text");
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatchObject({
      name: "positive_prompt",
      type: "STRING",
      connected: true,
      ioKey: "9::widget::text",
      handleId: "positive_prompt",
      active: true,
    });
  });

  it("同一个口落到不同类型就有不同类型（尺寸 → COMBO 预设口）", () => {
    const entries = buildParamEntries(outIo, undefined, { mode: "T2I" });
    const size = entries.find((entry) => entry.id === "size-aspect")!;
    const byName = (name: string) =>
      paramOutputPorts(size, outIo, "5::widget::width").find(
        (port) => port.name === name,
      )!;
    expect(byName("width").type).toBe("INT");
    expect(byName("aspect_ratio").type).toBe("COMBO");
  });

  it("**每个候选都给端口** —— 尺寸有几个候选就有几颗点（ISSUE #355 复审）", () => {
    const entries = buildParamEntries(outIo, undefined, { mode: "T2I" });
    const size = entries.find((entry) => entry.id === "size-aspect")!;
    const ports = paramOutputPorts(size, outIo, null);
    /* 宽 / 高 / 宽高比 / 像素量 四个候选 → 四颗端点，而不是一颗。 */
    expect(ports.map((port) => port.name)).toEqual([
      "width",
      "height",
      "aspect_ratio",
      "megapixels",
    ]);
    expect(ports.map((port) => port.type)).toEqual([
      "INT",
      "INT",
      "COMBO",
      "FLOAT",
    ]);
    /* `connected` = 端口在工作流里真实存在（不是「已连上」）—— 候选端口都存在。 */
    expect(ports.every((port) => port.connected)).toBe(true);
    /* 行上显示的是**这个子口自己的名字**（卡片行不写 ComfyUI 内部 pin 名）。 */
    expect(ports.every((port) => port.display === "尺寸 · 宽高比")).toBe(true);
    /* 每颗点自带 handle id（= 该端口的 ioKey）：拖哪颗就连到哪个候选。 */
    expect(ports.map((port) => port.handleId)).toEqual([
      "width",
      "height",
      "aspect_ratio",
      "megapixels",
    ]);
    expect(ports.every((port) => !port.active)).toBe(true);
  });

  it("**已有落点时仍列出全部候选**，生效那颗标 active（ISSUE #355 复审）", () => {
    /* 「尺寸只有一个比例口，像素数哪去了」：卡片要把每个候选的出口都摆出来，
     *  拖哪一颗就连到哪个候选；当前落点那一颗标实心。 */
    const entries = buildParamEntries(outIo, undefined, { mode: "T2I" });
    const size = entries.find((entry) => entry.id === "size-aspect")!;
    const ports = paramOutputPorts(size, outIo, "5::widget::height");
    expect(ports.map((port) => port.name)).toEqual([
      "width",
      "height",
      "aspect_ratio",
      "megapixels",
    ]);
    expect(ports.map((port) => port.active)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(defaultOutputPortIndex(ports)).toBe(1);
  });

  it("未连线时端口名就是候选端口名，不谎报类型", () => {
    const entries = buildParamEntries(outIo, undefined, { mode: "T2I" });
    const prompt = entries.find((entry) => entry.id === "prompt")!;
    const ports = paramOutputPorts(prompt, outIo, null);
    expect(ports.map((port) => port.connected)).toEqual([true]);
    expect(ports[0]!.type).toBe("STRING");
  });

  it("一个候选都没有（工作流没有可落点端口）→ 一条占位，卡片仍画得出端点", () => {
    const entries = buildParamEntries(outIo, undefined, { mode: "T2I" });
    const prompt = entries.find((entry) => entry.id === "prompt")!;
    const empty = { ...prompt, pins: [] };
    const ports = paramOutputPorts(empty, outIo, null);
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatchObject({
      name: "提示词",
      type: "*",
      connected: false,
      ioKey: "",
    });
    /* 端点的 handle id 退到契约展示名：没有可落的地方，但卡片仍画得出端点。 */
    expect(ports[0]!.handleId).toBe("提示词");
  });

  it("落点指向已不存在的端口时列候选、不留一颗悬空点", () => {
    const entries = buildParamEntries(outIo, undefined, { mode: "T2I" });
    const prompt = entries.find((entry) => entry.id === "prompt")!;
    const ports = paramOutputPorts(prompt, outIo, "9::widget::gone");
    /* 端口已从 IO 里移除 → 那个落点画不出端点（io 里查不到类型/名字）。此时照
     * 常列出工作流里真实存在的候选，而不是凭空造一颗标着 active 的点。 */
    expect(ports.map((port) => port.name)).toEqual(["positive_prompt"]);
    expect(ports[0]!.ioKey).toBe("9::widget::text");
    expect(ports[0]!.active).toBe(false);
  });

  it("生效落点排在可识别的位置（第一颗即连上的那颗）", () => {
    const entries = buildParamEntries(outIo, undefined, { mode: "T2I" });
    const size = entries.find((entry) => entry.id === "size-aspect")!;
    const ports = paramOutputPorts(size, outIo, "5::widget::height");
    expect(defaultOutputPortIndex(ports)).toBe(1);
    expect(ports[1]!.name).toBe("height");
  });

  it("portTypeDisplay：声明类型原样大写，缺省 *", () => {
    expect(portTypeDisplay("imageupload")).toBe("IMAGEUPLOAD");
    expect(portTypeDisplay(" STRING ")).toBe("STRING");
    expect(portTypeDisplay(undefined)).toBe("*");
    expect(portTypeDisplay("")).toBe("*");
  });
});

describe("wiredTargetsForEntry — 一个对外参数当前接到哪个端口", () => {
  /* 候选是**按类型**收的（同族几个口子摆的是同一份候选），所以只报作者连上的那
   * 一条：逐条列出来会让一张卡画出十来条线，还把兄弟口子的落点在图上画到本口
   * 名下。候选圆点照给（每个都能拖，见 `paramOutputPorts`）—— 两件事分开。 */
  const sizeIo: WorkflowIOMap = {
    "5::widget::aspect_ratio": pin("5", "aspect_ratio", { type: "COMBO" }),
    "5::widget::megapixels": pin("5", "megapixels", { type: "FLOAT" }),
    "5::widget::width": pin("5", "width", { type: "INT" }),
    "5::widget::height": pin("5", "height", { type: "INT" }),
  };

  it("只报作者连上的那一条（active 标出它）", () => {
    expect(wiredTargetsForEntry({ target: "5::widget::aspect_ratio" })).toEqual(
      [{ ioKey: "5::widget::aspect_ratio", active: true }],
    );
  });

  it("未连线 / 显式断开 → 一条都不画", () => {
    expect(wiredTargetsForEntry({ target: null })).toEqual([]);
    expect(wiredTargetsForEntry({ target: undefined })).toEqual([]);
  });

  it("尺寸子口的候选圆点照旧给全 —— 线只画一条，点是另一回事", () => {
    const size = buildParamEntries(sizeIo, undefined, { mode: "T2I" }).find(
      (entry) => entry.id === "size-aspect",
    )!;
    /* 候选 = 该族全部数值行（作者从哪一行拖都行）。 */
    expect(size.pins.map((item) => item.name).sort()).toEqual([
      "aspect_ratio",
      "height",
      "megapixels",
      "width",
    ]);
    /* 每个候选一颗圆点，落点那颗标 active。 */
    const ports = paramOutputPorts(size, sizeIo, "5::widget::aspect_ratio");
    expect(ports.map((port) => port.ioKey)).toEqual([
      "5::widget::aspect_ratio",
      "5::widget::megapixels",
      "5::widget::width",
      "5::widget::height",
    ]);
    expect(
      ports.filter((port) => port.active).map((port) => port.ioKey),
    ).toEqual(["5::widget::aspect_ratio"]);
  });
});

/* ── 尺寸各项各自取值（ISSUE #355）──
 *
 * 用户口径：「尺寸有多个数值，只有一条线，需要多条线都能连，尺寸那几项每一项都
 * 需要从外部获取值」。画布通路上外部给的「尺寸」是 "WxH"，落到比例 / 像素量这些
 * 端口上要现算成它们各自认的形状 —— 照抄像素串会被 ComfyUI 判成非法选项。
 *
 * 「对齐倍数」不再属于尺寸语义（它只是 W/H 吸附到哪个网格的实现细节，见工坊
 * 尺寸选择器口径），因此不在这里。 */

describe("applyParamMapping — 尺寸各项各自取值", () => {
  const sizeIo: WorkflowIOMap = {
    "5::widget::aspect_ratio": pin("5", "aspect_ratio", {
      type: "COMBO",
      defaultValue: "16:9",
      options: ["16:9", "4:3", "1:1"],
    }),
    "5::widget::megapixels": pin("5", "megapixels", {
      type: "FLOAT",
      defaultValue: 1,
    }),
    "5::widget::width": pin("5", "width", {
      type: "INT",
      defaultValue: 1024,
    }),
  };

  it("尺寸的每个子口各连一行：同一个外部尺寸逐个派生成各自认的形状", () => {
    const entries = buildParamEntries(sizeIo, undefined, { mode: "T2I" });
    const { inputs } = applyParamMapping({
      io: sizeIo,
      entries,
      /* 形态由作者连到哪个子口声明（老数据里那条 `size` 线由迁移逻辑归到子口）。 */
      mapping: {
        manualByMode: {
          T2I: {
            "size-megapixels": "5::widget::megapixels",
            "size-aspect": "5::widget::aspect_ratio",
            "size-width": "5::widget::width",
          },
        },
      },
      values: { size: "1920x1080" },
      mode: "T2I",
    });
    /* 同一个外部尺寸按各自子口的形态派出去：像素量、比例标签、宽。 */
    expect(inputs.find((item) => item.name === "megapixels")?.value).toBe(2);
    expect(inputs.find((item) => item.name === "aspect_ratio")?.value).toBe(
      "16:9",
    );
    expect(inputs.find((item) => item.name === "width")?.value).toBe(1920);
  });

  it("老数据里那条 `size` 键不再被采纳（未配置，作者重连）", () => {
    const entries = buildParamEntries(sizeIo, undefined, { mode: "T2I" });
    const { inputs, unmatched } = applyParamMapping({
      io: sizeIo,
      entries,
      /* 拆分之前「尺寸」只有一个键、形态是从端口名判出来的。那条老线**不**再被
       *  采纳：形态只由子口身份声明，名字表（连存量迁移用的那张）一并删除 ——
       *  六个子口都显示未配置，作者在库里重连一次即可。 */
      mapping: { manualByMode: { T2I: { size: "5::widget::width" } } },
      values: { size: "1920x1080" },
      mode: "T2I",
    });
    expect(inputs).toEqual([]);
    expect(unmatched).toContain("size-width");
  });

  it("尺寸子口没连线 → 不下发（未配置），外部尺寸值如实进 unmatched", () => {
    const entries = buildParamEntries(sizeIo, undefined, { mode: "T2I" });
    const { inputs, unmatched } = applyParamMapping({
      io: sizeIo,
      entries,
      mapping: null,
      values: { size: "1920x1080" },
      mode: "T2I",
    });
    /* 尺寸子口的候选是**按类型**收来的全部数值口，逐个下发它们的工作流默认值会
     * 把作者没连过的行一起写进载荷 —— 所以一行都不下发（工作流图内默认值照常
     * 生效），用户给的尺寸如实进 unmatched。 */
    expect(inputs).toEqual([]);
    expect(unmatched).toEqual([
      "size-width",
      "size-height",
      "size-aspect",
      "size-megapixels",
      "size-resolution",
      "size-multiple",
    ]);
  });

  it("比例不在端口声明的候选里 → 不写非法值，也不兜底（图内默认值生效）", () => {
    const narrow: WorkflowIOMap = {
      "5::widget::aspect_ratio": pin("5", "aspect_ratio", {
        type: "COMBO",
        defaultValue: "4:3",
        options: ["4:3"],
      }),
    };
    const entries = buildParamEntries(narrow, undefined, { mode: "T2I" });
    const { inputs, unmatched } = applyParamMapping({
      io: narrow,
      entries,
      mapping: {
        manualByMode: { T2I: { "size-aspect": "5::widget::aspect_ratio" } },
      },
      values: { size: "1024x1024" },
      mode: "T2I",
    });
    /* 形状算不出来（1:1 不在这个端口的候选里）→ 不写非法值；子口不兜底候选，
     *  于是这一行不下发，ComfyUI 用图内默认值（4:3）。 */
    expect(unmatched).toContain("size-aspect");
    expect(inputs.find((item) => item.name === "aspect_ratio")).toBeUndefined();
  });

  it("非尺寸口原样透传（提示词在所有落点上同形）", () => {
    const io: WorkflowIOMap = {
      "9::widget::text": pin("9", "text", { defaultValue: "built-in" }),
      "9::widget::positive_prompt": pin("9", "positive_prompt", {
        defaultValue: "built-in",
      }),
    };
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const read = (target: string) =>
      applyParamMapping({
        io,
        entries,
        mapping: { manualByMode: { T2I: { prompt: target } } },
        values: { prompt: "一只猫" },
        mode: "T2I",
      }).inputs;
    /* 同族两行（`text` / `positive_prompt`）都是「提示词」的候选，值只落到作者
     *  连的那一行 —— 另一行原样不动（原样透传：提示词在任何落点上同形）。 */
    expect(read("9::widget::positive_prompt")).toEqual([
      { nodeId: "9", name: "positive_prompt", value: "一只猫" },
    ]);
    expect(read("9::widget::text")).toEqual([
      { nodeId: "9", name: "text", value: "一只猫" },
    ]);
  });
});
