import { describe, expect, it } from "vitest";

import type { WorkflowIOMap } from "~/lib/workflow-io-types";
import {
  applyParamMapping,
  buildParamEntries,
  buildSourceOverrides,
  classifyPin,
  clearModeWiring,
  handleIdForIoKey,
  hasManualWiring,
  ioKeyForHandle,
  isDefaultMapping,
  paramOutputPorts,
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

describe("classifyPin", () => {
  it("负面优先于正向、首尾帧优先于普通参考图", () => {
    expect(classifyPin(pin("1", "negative_prompt"))).toBe("negative");
    expect(classifyPin(pin("1", "positive_prompt"))).toBe("prompt");
    expect(classifyPin(pin("1", "first_frame", { type: "IMAGE" }))).toBe(
      "first-frame",
    );
    expect(classifyPin(pin("1", "last_frame", { type: "IMAGE" }))).toBe(
      "last-frame",
    );
    expect(classifyPin(pin("1", "ref_image", { type: "IMAGE" }))).toBe(
      "reference-image",
    );
  });

  it("正负只认名字：同一对文本编码节点的 `text` 两行都判不出（不做图内推导）", () => {
    /* 真实文生图里两个文本编码节点的 pin 名与显示名完全一样（都叫 text /
     *  「文本」）。本项目**不在这一层替作者猜正负**：判不出就是判不出，
     *  「负向提示词」这一口由契约常驻显示、落点由作者在库里连线决定。 */
    expect(classifyPin(pin("6", "text"))).toBe("other");
    expect(classifyPin(pin("7", "text"))).toBe("other");
    /* 名字里写了负向才认。 */
    expect(classifyPin(pin("7", "negative_prompt"))).toBe("negative");
    /* 图片口按图片判，不受名字里的正负词影响。 */
    expect(classifyPin(pin("8", "image", { type: "IMAGE" }))).toBe(
      "reference-image",
    );
  });

  it("时长口认 duration / length / frames，但帧率不算时长", () => {
    expect(classifyPin(pin("1", "duration", { type: "INT" }))).toBe("duration");
    expect(classifyPin(pin("1", "length", { type: "INT" }))).toBe("duration");
    expect(classifyPin(pin("1", "num_frames", { type: "INT" }))).toBe(
      "duration",
    );
    expect(classifyPin(pin("1", "fps", { type: "INT" }))).toBe("other");
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

  it("尺寸类先于提示词判定（base_width 这类下划线命名也认）", () => {
    expect(classifyPin(pin("1", "base_width", { type: "INT" }))).toBe(
      "size-width",
    );
    expect(classifyPin(pin("1", "height", { type: "INT" }))).toBe(
      "size-height",
    );
    expect(classifyPin(pin("1", "aspect_ratio"))).toBe("size-aspect");
    expect(
      classifyPin(pin("1", "prompt_width_of_thing", { type: "INT" })),
    ).toBe("prompt");
  });

  it("连线型端口与输出不算对外参数", () => {
    expect(
      classifyPin(pin("1", "model", { kind: "param", type: "MODEL" })),
    ).toBe("other");
    expect(
      classifyPin({
        direction: "output",
        kind: "output",
        nodeId: "1",
        name: "IMAGE",
      }),
    ).toBe("other");
  });
});

describe("buildParamEntries", () => {
  it("按节点 + 分类归并：同一节点的多个端口 = 一个对外参数", () => {
    const io: WorkflowIOMap = {
      "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
      "5::widget::height": pin("5", "height", {
        type: "INT",
        defaultValue: 512,
      }),
      "5::widget::steps": pin("5", "steps", { type: "INT", defaultValue: 20 }),
      "9::widget::text": pin("9", "text", { label: "正向提示词" }),
    };
    const entries = buildParamEntries(io);
    const width = entries.find((entry) => entry.id === "5|size-width");
    const height = entries.find((entry) => entry.id === "5|size-height");
    expect(width?.pins.map((item) => item.name)).toEqual(["width"]);
    expect(height?.pins.map((item) => item.name)).toEqual(["height"]);
    expect(
      entries
        .find((entry) => entry.id === "5|other")
        ?.pins.map((item) => item.name),
    ).toEqual(["steps"]);
    expect(entries.find((entry) => entry.id === "9|prompt")?.label).toBe(
      "正向提示词",
    );
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
     *  （落点为空 = 未配置），显示与否不跟着工作流内容走。 */
    expect(ids).toEqual(["prompt", "negative", "size"]);
  });

  it("「尺寸」是一个口子：宽 / 高 / 宽高比 / 像素量都算它的候选落点", () => {
    const size = buildParamEntries(io, undefined, { mode: "T2I" }).find(
      (entry) => entry.id === "size",
    )!;
    expect(size.pins.map((item) => item.name)).toEqual(["width", "height"]);
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
    ).toEqual(["prompt", "negative", "first-frame", "size", "duration"]);
    expect(
      buildParamEntries(videoIO, undefined, { mode: "T2I" }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["prompt", "negative", "size"]);
  });

  it("工作流一个可落点端口都没有时，契约口照样列出（零候选 = 未配置）", () => {
    const internalOnly: WorkflowIOMap = {
      "5::widget::steps": pin("5", "steps", { type: "INT", defaultValue: 20 }),
    };
    const entries = buildParamEntries(internalOnly, undefined, {
      mode: "T2I",
    });
    expect(entries.map((entry) => entry.id)).toEqual([
      "prompt",
      "negative",
      "size",
    ]);
    expect(entries.every((entry) => entry.pins.length === 0)).toBe(true);
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

  it("不传 mode 时保持旧的「按节点 + 分类」聚类", () => {
    const ids = buildParamEntries(io)
      .map((entry) => entry.id)
      .sort();
    expect(ids).toEqual([
      "5|other",
      "5|size-height",
      "5|size-width",
      "9|prompt",
    ]);
  });
});

describe("resolveMapping — 落点只由作者画的线决定", () => {
  const io: WorkflowIOMap = {
    "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
    "5::widget::resolution": pin("5", "resolution", { type: "COMBO" }),
  };
  const entries = buildParamEntries(io);
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
  const entryId = buildParamEntries(io)[0]!.id;

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
      manualByMode: { I2I: { "5|size-width": "5::widget::resolution" } },
    };
    const merged = serializeParamMapping(mapping, { positiveNode: "9" });
    expect(merged.positiveNode).toBe("9");
    expect(merged.source).toEqual({
      "mode:I2I": { "5|size-width": "5::widget::resolution" },
    });
    const parsed = parseParamMapping(merged);
    expect(parsed.manualByMode).toEqual({
      I2I: { "5|size-width": "5::widget::resolution" },
    });
    /* 往返之后 resolveMapping 必须仍然认得出来（曾经这里丢了按模式的线）。 */
    const io: WorkflowIOMap = {
      "5::widget::width": pin("5", "width", { type: "INT", defaultValue: 512 }),
      "5::widget::resolution": pin("5", "resolution", { type: "COMBO" }),
    };
    const entries = buildParamEntries(io);
    expect(resolveMapping(entries, io, parsed, "I2I")["5|size-width"]).toBe(
      "5::widget::resolution",
    );
  });

  it("没有 `mode:` 前缀的键一律丢弃（通用手工线已取消）", () => {
    const parsed = parseParamMapping({
      source: {
        /* 历史形状的通用手工线 —— 没有生效语境，丢弃。 */
        "5|size-width": "5::widget::resolution",
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
      { manualByMode: { I2I: { "5|size-width": null } } },
      {},
    );
    expect(parseParamMapping(merged).manualByMode).toEqual({
      I2I: { "5|size-width": null },
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
    const entries = buildParamEntries(io);
    const { inputs } = applyParamMapping({
      io,
      entries,
      mapping: {
        manualByMode: {
          T2I: { "5|size-width": "5::widget::width" },
        },
      },
      values: { "5|size-width": 1024 },
      mode: "T2I",
    });
    expect(inputs.find((item) => item.name === "width")?.value).toBe(1024);
  });

  it("没有线的对外参数：按默认值兜底（用户不改就用工作流默认值）", () => {
    const entries = buildParamEntries(io);
    const { inputs } = applyParamMapping({
      io,
      entries,
      mapping: null,
      values: {},
    });
    expect(inputs.find((item) => item.name === "text")?.value).toBe("built-in");
    expect(inputs.find((item) => item.name === "steps")?.value).toBe(20);
  });

  it("没连过的对外参数给了值 → 如实进 unmatched，不替作者挑一个端口", () => {
    const entries = buildParamEntries(io);
    const { inputs, unmatched } = applyParamMapping({
      io,
      entries,
      mapping: null,
      values: { "5|size-width": 1024 },
    });
    expect(unmatched).toContain("5|size-width");
    expect(inputs.find((item) => item.name === "width")?.value).toBe(512);
  });

  it("显式断开（null）的对外参数：用户值如实录进 unmatched，不凭空落端口", () => {
    const entries = buildParamEntries(io);
    const { inputs, unmatched } = applyParamMapping({
      io,
      entries,
      mapping: {
        manualByMode: { T2I: { "5|size-width": null } },
      },
      values: { "5|size-width": 1024 },
      mode: "T2I",
    });
    expect(unmatched).toContain("5|size-width");
    /* 断开的只是「外部值往这落」，工作流自己的默认值照旧下发。 */
    expect(inputs.find((item) => item.name === "width")?.value).toBe(512);
  });

  it("另一模式的线不影响本模式（模式线只在该模式生效）", () => {
    const entries = buildParamEntries(io);
    const { inputs, unmatched } = applyParamMapping({
      io,
      entries,
      mapping: {
        manualByMode: { I2I: { "5|size-width": "5::widget::width" } },
      },
      values: { "5|size-width": 1024 },
      mode: "T2I",
    });
    /* 本模式没有线 → 值落不上，如实记进 unmatched。 */
    expect(unmatched).toContain("5|size-width");
    expect(inputs.find((item) => item.name === "width")?.value).toBe(512);
  });

  it("契约条目：作者按契约 id 画线后，值可以按契约 id（工坊侧）或 ioKey（运行期表单）给", () => {
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const mapping = {
      manualByMode: { T2I: { size: "5::widget::width" } },
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
      mapping: { manualByMode: { T2I: { "5|size-width": null } } },
      values: { "5::widget::width": 1024 },
      mode: "T2I",
    });
    /* 作者当年把「尺寸」显式断开了 → 用户值不落任何端口（不凭空兜底）。 */
    expect(inputs.find((item) => item.name === "width")?.value).not.toBe(1024);
  });

  it("未连线时默认值兜底 =「每个暴露 pin 都下发」", () => {
    const { inputs } = applyParamMapping({
      io,
      entries: buildParamEntries(io),
      mapping: null,
      values: {},
    });
    expect(inputs.map((item) => `${item.nodeId}.${item.name}`).sort()).toEqual([
      "5.steps",
      "5.width",
      "9.text",
    ]);
  });
});

describe("buildSourceOverrides", () => {
  it("产出「对外参数 id → 目标 ioKey」的覆盖表（含 null 断开）", () => {
    const io: WorkflowIOMap = {
      "5::widget::width": pin("5", "width", { type: "INT" }),
    };
    const mapping = {
      manualByMode: { T2I: { "5|size-width": "5::widget::width" } },
    };
    const overrides = buildSourceOverrides(
      buildParamEntries(io),
      io,
      mapping,
      "T2I",
    );
    expect(overrides["5|size-width"]).toBe("5::widget::width");
    /* 没有线 → 表里没有这个口（未配置，不是「断成 null」）。 */
    expect(
      buildSourceOverrides(buildParamEntries(io), io, null, "T2I"),
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
    const entries = buildParamEntries(innerIo);
    const { inputs } = applyParamMapping({
      io: innerIo,
      entries,
      mapping: {
        manualByMode: { T2I: { "1670|other": "1670::widget::value" } },
      },
      values: { "1670|other": 33 },
      mode: "T2I",
    });
    expect(inputs).toEqual([{ nodeId: "4:1670", name: "value", value: 33 }]);
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
    const size = entries.find((entry) => entry.id === "size")!;
    const byName = (name: string) =>
      paramOutputPorts(size, outIo, "5::widget::width").find(
        (port) => port.name === name,
      )!;
    expect(byName("width").type).toBe("INT");
    expect(byName("aspect_ratio").type).toBe("COMBO");
  });

  it("**每个候选都给端口** —— 尺寸有几个候选就有几颗点（ISSUE #355 复审）", () => {
    const entries = buildParamEntries(outIo, undefined, { mode: "T2I" });
    const size = entries.find((entry) => entry.id === "size")!;
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
    const size = entries.find((entry) => entry.id === "size")!;
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
    const size = entries.find((entry) => entry.id === "size")!;
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

describe("wiredTargetsForEntry — 一个对外参数当前接到哪些端口", () => {
  /* 「尺寸」在 ResolutionSelector 这类节点上由多个端口共同组成（宽高比 / 像素量
   *  由同一块组合控件录入）。默认状态下这些端口都来自这一个对外参数，画面上就该
   *  各有一条线 —— 只画自动判定挑中的那一个，会让「尺寸」看着只有一个出口
   *  （ISSUE #355：「尺寸现在有三个参数，就应该可以连三条线出来」）。 */
  const sizeIo: WorkflowIOMap = {
    "5::widget::aspect_ratio": pin("5", "aspect_ratio", { type: "COMBO" }),
    "5::widget::megapixels": pin("5", "megapixels", { type: "FLOAT" }),
    "5::widget::width": pin("5", "width", { type: "INT" }),
    "5::widget::height": pin("5", "height", { type: "INT" }),
  };
  const grouped = new Set([
    "5::widget::aspect_ratio",
    "5::widget::megapixels",
    "5::widget::width",
    "5::widget::height",
  ]);

  it("作者把尺寸连到组合控件上：该控件覆盖的每个端口各一条线", () => {
    const size = buildParamEntries(sizeIo, undefined, { mode: "T2I" }).find(
      (entry) => entry.id === "size",
    )!;
    const wired = wiredTargetsForEntry({
      entry: size,
      io: sizeIo,
      target: "5::widget::aspect_ratio",
      manual: false,
      groupedKeys: grouped,
    });
    expect(wired.map((item) => item.ioKey)).toEqual([
      "5::widget::width",
      "5::widget::height",
      "5::widget::aspect_ratio",
      "5::widget::megapixels",
    ]);
    /* 自动判定挑中的那一颗标 active（卡片上实心，其余淡一档）。 */
    expect(
      wired.filter((item) => item.active).map((item) => item.ioKey),
    ).toEqual(["5::widget::aspect_ratio"]);
  });

  it("作者把线连到组合控件里的某个端口 → 该控件覆盖的端口一起画", () => {
    const size = buildParamEntries(sizeIo, undefined, { mode: "T2I" }).find(
      (entry) => entry.id === "size",
    )!;
    const wired = wiredTargetsForEntry({
      entry: size,
      io: sizeIo,
      target: "5::widget::megapixels",
      manual: true,
      groupedKeys: grouped,
    });
    /* 这几行由同一块控件录入（宽高比 / 像素量 / 宽高），作者把它连到这块控件上
     *  就等于这几行都取自这一个口 —— 只画一条会让其余几项读作「没接上」。 */
    expect(wired.map((item) => item.ioKey)).toEqual([
      "5::widget::width",
      "5::widget::height",
      "5::widget::aspect_ratio",
      "5::widget::megapixels",
    ]);
    /* 只有作者指定的那一颗是 active（卡片上实心）。 */
    expect(
      wired.filter((item) => item.active).map((item) => item.ioKey),
    ).toEqual(["5::widget::megapixels"]);
  });

  it("作者连到普通端口（不属于任何组合控件）：只画那一条", () => {
    const size = buildParamEntries(sizeIo, undefined, { mode: "T2I" }).find(
      (entry) => entry.id === "size",
    )!;
    const wired = wiredTargetsForEntry({
      entry: size,
      io: sizeIo,
      target: "5::widget::megapixels",
      manual: true,
      /* 宿主表单这一帧没有把组合控件画出来 → 就是一条普通的线。 */
      groupedKeys: new Set<string>(),
    });
    expect(wired.map((item) => item.ioKey)).toEqual(["5::widget::megapixels"]);
  });

  it("未连线 / 显式断开 → 一条都不画", () => {
    const size = buildParamEntries(sizeIo, undefined, { mode: "T2I" }).find(
      (entry) => entry.id === "size",
    )!;
    expect(
      wiredTargetsForEntry({
        entry: size,
        io: sizeIo,
        target: null,
        manual: true,
        groupedKeys: grouped,
      }),
    ).toEqual([]);
  });

  it("单端口条目不受一对多影响（提示词永远只有一条线）", () => {
    const oneIo: WorkflowIOMap = {
      "9::widget::text": pin("9", "positive_prompt", {
        type: "STRING",
        defaultValue: "一段足够长的提示词描述，用来被判定为提示词口",
      }),
    };
    const prompt = buildParamEntries(oneIo, undefined, { mode: "T2I" }).find(
      (entry) => entry.id === "prompt",
    )!;
    const wired = wiredTargetsForEntry({
      entry: prompt,
      io: oneIo,
      target: "9::widget::text",
      manual: false,
      groupedKeys: new Set(["9::widget::text"]),
    });
    expect(wired.map((item) => item.ioKey)).toEqual(["9::widget::text"]);
  });

  it("落点不在组合控件里时按单条线处理（没有可摊开的一组端口）", () => {
    const size = buildParamEntries(sizeIo, undefined, { mode: "T2I" }).find(
      (entry) => entry.id === "size",
    )!;
    const wired = wiredTargetsForEntry({
      entry: size,
      io: sizeIo,
      target: "5::widget::megapixels",
      manual: false,
      /* 宿主表单这一帧没有把组合控件画出来 → 没有「同一块控件的一组端口」。 */
      groupedKeys: new Set<string>(),
    });
    expect(wired.map((item) => item.ioKey)).toEqual(["5::widget::megapixels"]);
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
  const groupedKeys = new Set(Object.keys(sizeIo));

  it("同一个「尺寸」口接到多个端口时，逐个派生成各自认的形状", () => {
    const entries = buildParamEntries(sizeIo, undefined, { mode: "T2I" });
    const { inputs } = applyParamMapping({
      io: sizeIo,
      entries,
      /* 作者把那几条线都连到同一个「尺寸」口上（库里/画布上拖出来的线）。 */
      mapping: {
        manualByMode: {
          T2I: {
            size: "5::widget::megapixels",
          },
        },
      },
      values: { size: "1920x1080" },
      mode: "T2I",
      groupedKeys,
    });
    /* 这几行由同一块控件录入 → 同一个外部尺寸逐个派生成各自认的形状；
     *  不属于那条线的行回工作流默认值。 */
    expect(inputs.find((item) => item.name === "megapixels")?.value).toBe(2);
    expect(inputs.find((item) => item.name === "aspect_ratio")?.value).toBe(
      "16:9",
    );
    expect(inputs.find((item) => item.name === "width")?.value).toBe(1920);
  });

  it("默认（未连线）时按工作流默认值兜底，不拿外部尺寸硬塞", () => {
    const entries = buildParamEntries(sizeIo, undefined, { mode: "T2I" });
    const { inputs, unmatched } = applyParamMapping({
      io: sizeIo,
      entries,
      mapping: null,
      values: { size: "1920x1080" },
      mode: "T2I",
      groupedKeys,
    });
    const byName = new Map(inputs.map((item) => [item.name, item.value]));
    expect(byName.get("aspect_ratio")).toBe("16:9");
    expect(byName.get("megapixels")).toBe(1);
    expect(byName.get("width")).toBe(1024);
    /* 没有线 → 外部给的尺寸落不上，如实记进 unmatched。 */
    expect(unmatched).toContain("size");
  });

  it("比例不在端口声明的候选里 → 不写非法值，退回默认值", () => {
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
        manualByMode: { T2I: { size: "5::widget::aspect_ratio" } },
      },
      values: { size: "1024x1024" },
      mode: "T2I",
    });
    /* 形状算不出来（1:1 不在这个端口的候选里）→ 不写非法值，外部值如实进
     * unmatched；该端口照旧下发工作流自己的默认值。 */
    expect(unmatched).toContain("size");
    expect(inputs.find((item) => item.name === "aspect_ratio")?.value).toBe(
      "4:3",
    );
  });

  it("非尺寸口原样透传（提示词在所有落点上同形）", () => {
    const io: WorkflowIOMap = {
      "9::widget::text": pin("9", "text", { defaultValue: "built-in" }),
      "9::widget::positive_prompt": pin("9", "positive_prompt", {
        defaultValue: "built-in",
      }),
    };
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const promptEntry = entries.find((entry) => entry.id === "prompt")!;
    const { inputs } = applyParamMapping({
      io,
      entries,
      mapping: {
        manualByMode: {
          T2I: { prompt: promptEntry.pins[0]!.ioKey },
        },
      },
      values: { prompt: "一只猫" },
      mode: "T2I",
    });
    expect(inputs.find((item) => item.name === "positive_prompt")?.value).toBe(
      "一只猫",
    );
  });
});
