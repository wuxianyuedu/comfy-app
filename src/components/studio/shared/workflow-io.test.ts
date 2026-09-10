import { describe, it, expect } from "vitest";
import {
  controlForEntry,
  isUploadPinName,
  mergeRefreshedDefaults,
  splitWorkflowIO,
  inferDimensionGroup,
  inferGroups,
  parseRatioFromLabel,
  typeDisplay,
  type WorkflowIOMap,
  type WorkflowIOEntry,
  type EnrichedWidget,
} from "./workflow-io";

/* ComfyUI 离线时保存的 workflowIO 不带 type，width/height 因此被
 * 判成 text，inferDimensionGroup 从不命中，「比例 + 清晰度」选择器整体消失。
 * 本文件锁定 type 缺失时的回退推断行为，防止该回归复发。 */

/** 构造一个 widget pin；省略 type 即模拟 IO 未富化的场景。 */
function pin(name: string, label: string, type?: string): WorkflowIOEntry {
  return {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name,
    label,
    ...(type ? { type } : {}),
  };
}

/** 走真实的 splitWorkflowIO，保证用例覆盖的是运行时同一条链路。 */
function widgetsOf(...entries: WorkflowIOEntry[]): EnrichedWidget[] {
  const map: WorkflowIOMap = {};
  for (const entry of entries) {
    map[`${entry.nodeId}::widget::${entry.name}`] = entry;
  }
  return splitWorkflowIO(map).widgetInputs;
}

describe("controlForEntry — type 缺失时的回退推断", () => {
  it("width/height 无 type 时推断为 int，不再退化成 text", () => {
    expect(controlForEntry(pin("width", "宽度"))).toBe("int");
    expect(controlForEntry(pin("height", "高度"))).toBe("int");
  });

  it("aspect_ratio 无 type 时推断为 text，由 DimensionControl 接管", () => {
    expect(controlForEntry(pin("aspect_ratio", "宽高比"))).toBe("text");
  });

  it("aspect_ratio 带 options 时推断为 select", () => {
    const entry = { ...pin("aspect_ratio", "宽高比"), options: ["1:1", "16:9"] };
    expect(controlForEntry(entry)).toBe("select");
  });

  it("megapixels 无 type 时推断为 float", () => {
    expect(controlForEntry(pin("megapixels", "百万像素"))).toBe("float");
  });

  it("数字 defaultValue 优先于名称推断", () => {
    expect(controlForEntry({ ...pin("foo", "自定义"), defaultValue: 3 })).toBe("int");
    expect(controlForEntry({ ...pin("foo", "自定义"), defaultValue: 1.5 })).toBe("float");
  });

  it("显式声明的 STRING 不受回退影响（提示词仍是 text）", () => {
    expect(controlForEntry(pin("text", "正向提示词", "STRING"))).toBe("text");
  });

  it("显式声明的 INT / FLOAT 仍走既有分支", () => {
    expect(controlForEntry(pin("steps", "步数", "INT"))).toBe("int");
    expect(controlForEntry(pin("cfg", "引导系数", "FLOAT"))).toBe("float");
  });

  it("无 type 且名称无数字语义时仍回落 text", () => {
    expect(controlForEntry(pin("text", "正向提示词"))).toBe("text");
  });
});

describe("inferDimensionGroup — 两种形态", () => {
  it("W/H 形态：无 type 也能命中（回归：组合选择器消失）", () => {
    const group = inferDimensionGroup(widgetsOf(pin("width", "宽度"), pin("height", "高度")));
    expect(group).not.toBeNull();
    expect(group?.width?.ioKey).toBe("7::widget::width");
    expect(group?.height?.ioKey).toBe("7::widget::height");
    expect(group?.aspect).toBeUndefined();
    expect(group?.megapixels).toBeUndefined();
  });

  it("宽高比 + 百万像素形态（ResolutionSelector 类节点）", () => {
    const group = inferDimensionGroup(
      widgetsOf(pin("aspect_ratio", "宽高比"), pin("megapixels", "百万像素"))
    );
    expect(group).not.toBeNull();
    expect(group?.aspect?.ioKey).toBe("7::widget::aspect_ratio");
    expect(group?.megapixels?.ioKey).toBe("7::widget::megapixels");
    expect(group?.width).toBeUndefined();
    expect(group?.height).toBeUndefined();
  });

  it("W/H 齐备时优先于 宽高比/百万像素 形态", () => {
    const group = inferDimensionGroup(
      widgetsOf(
        pin("width", "宽度"),
        pin("height", "高度"),
        pin("aspect_ratio", "宽高比"),
        pin("megapixels", "百万像素")
      )
    );
    expect(group?.width?.name).toBe("width");
  });

  it("只有 width 缺 height 时不成立", () => {
    expect(inferDimensionGroup(widgetsOf(pin("width", "宽度")))).toBeNull();
  });

  it("只有 宽高比 缺 百万像素 时不成立", () => {
    expect(inferDimensionGroup(widgetsOf(pin("aspect_ratio", "宽高比")))).toBeNull();
  });
});

describe("inferGroups — groupedKeys 覆盖两种形态", () => {
  it("W/H 形态两个 pin 都进入 groupedKeys，不会在表单里重复渲染", () => {
    const { groupedKeys } = inferGroups(widgetsOf(pin("width", "宽度"), pin("height", "高度")));
    expect([...groupedKeys].sort()).toEqual(["7::widget::height", "7::widget::width"]);
  });

  it("宽高比 + 百万像素形态同样进入 groupedKeys", () => {
    const { groupedKeys } = inferGroups(
      widgetsOf(pin("aspect_ratio", "宽高比"), pin("megapixels", "百万像素"))
    );
    expect([...groupedKeys].sort()).toEqual([
      "7::widget::aspect_ratio",
      "7::widget::megapixels",
    ]);
  });

  it("无组合时不产出 groupedKeys", () => {
    const { dimension, video, groupedKeys } = inferGroups(widgetsOf(pin("text", "提示词")));
    expect(dimension).toBeNull();
    expect(video).toBeNull();
    expect(groupedKeys.size).toBe(0);
  });
});

describe("parseRatioFromLabel", () => {
  it("解析带英文后缀的 COMBO 标签", () => {
    expect(parseRatioFromLabel("16:9 (Widescreen)")).toBeCloseTo(16 / 9);
    expect(parseRatioFromLabel("1:1 (Square)")).toBeCloseTo(1);
  });

  it("解析裸比例与乘号写法", () => {
    expect(parseRatioFromLabel("9:16")).toBeCloseTo(9 / 16);
    expect(parseRatioFromLabel("1920x1080")).toBeCloseTo(16 / 9);
  });

  it("无法识别时返回 null", () => {
    expect(parseRatioFromLabel("自动")).toBeNull();
    expect(parseRatioFromLabel("")).toBeNull();
  });
});

describe("splitWorkflowIO — kind 决定分组，客户端无 legacy 特判", () => {
  /* 服务端 enrichment（workflow-detail-io.ts）自动把带可编辑控件的旧
   * kind:"param" 迁移为 "widget"，客户端 splitWorkflowIO 只按 kind 分组，
   * 不再需要 promoteLegacyParams 之类的兼容逻辑。 */
  const entry = (kind: string, name: string, type?: string): WorkflowIOEntry => ({
    direction: "input",
    kind,
    nodeId: "7",
    name,
    ...(type ? { type } : {}),
  });

  it("kind=param 一律归 wireInputs（连线端口行）", () => {
    const map: WorkflowIOMap = {
      "7::param::seed": entry("param", "seed", "INT"),
      "7::param::model": entry("param", "model", "MODEL"),
    };
    const { wireInputs, widgetInputs } = splitWorkflowIO(map);
    expect(wireInputs).toHaveLength(2);
    expect(widgetInputs).toHaveLength(0);
  });

  it("kind=widget 一律归 widgetInputs", () => {
    const map: WorkflowIOMap = {
      "7::widget::seed": entry("widget", "seed", "INT"),
      "7::widget::prompt": entry("widget", "prompt", "STRING"),
    };
    const { wireInputs, widgetInputs } = splitWorkflowIO(map);
    expect(widgetInputs).toHaveLength(2);
    expect(widgetInputs[0]?.control).toBe("int");
    expect(wireInputs).toHaveLength(0);
  });
});

describe("mergeRefreshedDefaults — IO 默认值刷新（保覆盖，ISSUE #288）", () => {
  /* 返回 null 表示「一个键都不用改，沿用当前值」——调用方据此跳过 setState。
   * 测试统一过一遍 resolve，断言的是最终落在表单里的值。 */
  const resolve = (
    current: Record<string, unknown>,
    baseline: Record<string, unknown>,
    fresh: Record<string, unknown>,
  ) => mergeRefreshedDefaults(current, baseline, fresh) ?? current;

  it("未覆盖的参数跟着新默认值刷新", () => {
    expect(resolve({ steps: 20 }, { steps: 20 }, { steps: 30 })).toEqual({
      steps: 30,
    });
  });

  it("用户已覆盖的参数保持用户的值", () => {
    expect(mergeRefreshedDefaults({ steps: 8 }, { steps: 20 }, { steps: 30 })).toBeNull();
    expect(resolve({ steps: 8 }, { steps: 20 }, { steps: 30 })).toEqual({ steps: 8 });
  });

  it("同一张表里混合覆盖与未覆盖 —— 各自按自己的语义处理", () => {
    const current = { steps: 8, cfg: 7, prompt: "旧提示词" };
    const baseline = { steps: 20, cfg: 7, prompt: "旧提示词" };
    const fresh = { steps: 30, cfg: 9, prompt: "新提示词" };
    expect(resolve(current, baseline, fresh)).toEqual({
      steps: 8, // 用户改成 8，保持
      cfg: 9, // 未覆盖，刷新
      prompt: "新提示词", // 未覆盖，刷新
    });
  });

  it("用户把值改回默认值时仍判定为未覆盖（按值比较的固有取舍）", () => {
    expect(
      mergeRefreshedDefaults({ steps: 20 }, { steps: 20 }, { steps: 30 }),
    ).toEqual({ steps: 30 });
  });

  it("新暴露的 pin（基线里没有）直接采用默认值", () => {
    expect(resolve({}, {}, { seed: 42 })).toEqual({ seed: 42 });
  });

  it("被取消勾选的 pin 从值表里摘掉", () => {
    expect(
      resolve({ steps: 8, gone: 1 }, { steps: 20, gone: 1 }, { steps: 20 }),
    ).toEqual({ steps: 8 });
  });

  it("没有任何键需要变更时返回 null（调用方跳过 setState）", () => {
    expect(
      mergeRefreshedDefaults({ steps: 8 }, { steps: 20 }, { steps: 20 }),
    ).toBeNull();
  });

  it("值未被改动时不触发无谓更新", () => {
    const shared = { url: "a.png" };
    expect(
      mergeRefreshedDefaults({ img: shared }, { img: shared }, { img: shared }),
    ).toBeNull();
  });
});

describe("controlForEntry — 图片上传位（IMAGEUPLOAD / IMAGE / MASK）", () => {
  it("IMAGEUPLOAD 就是上传控件，不再退化成纯文本", () => {
    expect(controlForEntry(pin("upload", "选择文件上传", "IMAGEUPLOAD"))).toBe("image");
  });

  it("IMAGE / MASK 仍渲染上传控件", () => {
    expect(controlForEntry(pin("image", "图像", "IMAGE"))).toBe("image");
    expect(controlForEntry(pin("mask", "遮罩", "MASK"))).toBe("image");
  });

  it("上传位声明成 STRING 时按 pin 名兜底为上传控件", () => {
    expect(controlForEntry(pin("upload", "选择文件上传", "STRING"))).toBe("image");
  });

  it("结果槽 pin 名 `image` 不会因兜底变成上传按钮", () => {
    /* LoadImage 的 `image` 是上传结果（COMBO 文件名），上传按钮属于 `upload`。 */
    expect(controlForEntry(pin("image", "图像", "COMBO"))).toBe("text");
  });

  it("厂商自定义类型带标量时仍可编辑，不退化成只接受连线", () => {
    expect(
      controlForEntry({ ...pin("audio_file", "音频文件", "AUDIOFILE"), defaultValue: "" })
    ).toBe("text");
  });
});

describe("isUploadPinName", () => {
  it("命中 upload / filePicker 命名", () => {
    expect(isUploadPinName({ name: "upload" })).toBe(true);
    expect(isUploadPinName({ name: "first_frame_upload" })).toBe(true);
    expect(isUploadPinName({ name: "filePicker" })).toBe(true);
  });

  it("普通参数名不命中", () => {
    expect(isUploadPinName({ name: "image" })).toBe(false);
    expect(isUploadPinName({ name: "text" })).toBe(false);
  });
});

describe("typeDisplay — type 是什么就显示什么", () => {
  it("声明的类型原样大写展示（含 IMAGEUPLOAD 这类自定义类型）", () => {
    expect(typeDisplay("IMAGEUPLOAD")).toBe("IMAGEUPLOAD");
    expect(typeDisplay("combo")).toBe("COMBO");
    expect(typeDisplay("MASK")).toBe("MASK");
  });

  it("没有类型时才回退", () => {
    expect(typeDisplay(undefined, "STRING")).toBe("STRING");
    expect(typeDisplay("", "INT")).toBe("INT");
    expect(typeDisplay(undefined)).toBe("*");
  });
});
