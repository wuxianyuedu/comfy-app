// 节点类目录归一的行为契约（#4376 建，#4404 扩）：
//  1) V3 形状照实归一 —— COMBO 候选在 options 键、动态 COMBO（COMFY_DYNAMICCOMBO_V3）
//     的候选 = options[].key 且带每项子输入、MATCHTYPE（COMFY_MATCHTYPE_V3）是连线口；
//  2) 旧形状回归 —— 首项数组候选、对象数组候选、IMAGE 连线口、IMAGEUPLOAD 部件口、
//     forceInput 降级口；
//  3) 缺省值优先 object_info 声明的 default（如 scale_method 的 "area"），声明缺席
//     才回落首候选；
//  4) chainWidgetsValues 按 comfy-cli 转换器的配对口径摆 widgets_values（连线口不占
//     位、动态 COMBO 展开选中项子输入），选中项带连线型子输入 → null（整链回落）。
// 夹具形状取自本机 ComfyUI `/api/object_info/ResizeImageMaskNode` 实测载荷（#4404 现场）。
import { describe, expect, it } from "vitest";

import {
  buildReferenceChainCatalog,
  chainWidgetsValues,
  selectedComboOption,
  type ReferenceChainClassDef,
} from "./reference-loader-catalog";

/** 本机 ComfyUI 实测的 ResizeImageMaskNode 载荷（删减 tooltip 文案，结构逐字保留）。 */
const RESIZE_V3 = {
  input: {
    required: {
      input: [
        "COMFY_MATCHTYPE_V3",
        { template: { template_id: "input_type", allowed_types: "IMAGE,MASK" } },
      ],
      resize_type: [
        "COMFY_DYNAMICCOMBO_V3",
        {
          options: [
            {
              key: "scale dimensions",
              inputs: {
                required: {
                  width: ["INT", { default: 512, min: 0, max: 16_384, step: 1 }],
                  height: ["INT", { default: 512, min: 0, max: 16_384, step: 1 }],
                  crop: [
                    "COMBO",
                    { default: "center", multiselect: false, options: ["disabled", "center"] },
                  ],
                },
              },
            },
            {
              key: "scale by multiplier",
              inputs: {
                required: {
                  multiplier: ["FLOAT", { default: 1.0, min: 0.01, max: 8, step: 0.01 }],
                },
              },
            },
            {
              key: "match size",
              inputs: {
                required: {
                  match: ["IMAGE,MASK", {}],
                  crop: [
                    "COMBO",
                    { default: "center", multiselect: false, options: ["disabled", "center"] },
                  ],
                },
              },
            },
            {
              key: "scale to multiple",
              inputs: {
                required: { multiple: ["INT", { default: 8, min: 1, max: 16_384, step: 1 }] },
              },
            },
          ],
        },
      ],
      scale_method: [
        "COMBO",
        {
          default: "area",
          multiselect: false,
          options: ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"],
        },
      ],
    },
  },
  input_order: { required: ["input", "resize_type", "scale_method"] },
  output: ["COMFY_MATCHTYPE_V3"],
  output_name: ["resized"],
};

/** 旧形状的对照类：数组候选 COMBO / IMAGE 连线口 / IMAGEUPLOAD 部件 / forceInput 降级。 */
const LEGACY = {
  input: {
    required: {
      image: ["IMAGE", {}],
      combo: [["alpha", "beta"], { default: "beta" }],
      upload: ["IMAGEUPLOAD", {}],
      demoted: ["INT", { forceInput: true }],
    },
  },
  input_order: { required: ["image", "combo", "upload", "demoted"] },
  output: ["IMAGE"],
};

function resizeDef(): ReferenceChainClassDef {
  const catalog = buildReferenceChainCatalog({ ResizeImageMaskNode: RESIZE_V3 });
  expect(catalog).not.toBeNull();
  return catalog!.ResizeImageMaskNode!;
}

describe("buildReferenceChainCatalog：V3 形状（#4404）", () => {
  it("MATCHTYPE 是连线口（此前被当部件 → 链判不可实例化 → 整链静默回落）", () => {
    const def = resizeDef();
    const input = def.inputs.find((port) => port.name === "input");
    expect(input?.wire).toBe(true);
    /* 输出口同族：MATCHTYPE 原样带出（链尾挑出口用它判「能跟随 MASK」）。 */
    expect(def.outputs[0]?.type).toBe("COMFY_MATCHTYPE_V3");
  });

  it("动态 COMBO：候选 = options[].key，缺省取第一项；每项带子输入定义", () => {
    const def = resizeDef();
    expect(def.choices.resize_type).toEqual([
      "scale dimensions",
      "scale by multiplier",
      "match size",
      "scale to multiple",
    ]);
    expect(def.defaults.resize_type).toBe("scale dimensions");
    const port = def.inputs.find((item) => item.name === "resize_type");
    expect(port?.wire).toBe(false);
    const multiple = port?.comboOptions?.find((option) => option.key === "scale to multiple");
    expect(multiple?.subs).toEqual([
      { name: "multiple", type: "INT", wire: false, choices: [], default: 8 },
    ]);
    /* 子输入里的 COMBO 同样拿到候选（嵌套形状与顶层同读法）。 */
    const dims = port?.comboOptions?.find((option) => option.key === "scale dimensions");
    expect(dims?.subs.find((sub) => sub.name === "crop")?.choices).toEqual(["disabled", "center"]);
  });

  it("连线型子输入（match size 的 IMAGE,MASK 参考口）带 wire 标记", () => {
    const def = resizeDef();
    const port = def.inputs.find((item) => item.name === "resize_type");
    const match = port?.comboOptions?.find((option) => option.key === "match size");
    expect(match?.subs.find((sub) => sub.name === "match")?.wire).toBe(true);
    expect(match?.subs.find((sub) => sub.name === "crop")?.wire).toBe(false);
  });

  it("V3 COMBO：候选在 options 键；缺省优先声明的 default（不是首候选）", () => {
    const def = resizeDef();
    expect(def.choices.scale_method).toEqual([
      "nearest-exact",
      "bilinear",
      "area",
      "bicubic",
      "lanczos",
    ]);
    expect(def.defaults.scale_method).toBe("area");
    expect(def.widgetOrder).toEqual(["resize_type", "scale_method"]);
  });
});

describe("buildReferenceChainCatalog：旧形状回归", () => {
  it("数组候选 COMBO / IMAGE 连线口 / IMAGEUPLOAD 部件 / forceInput 降级", () => {
    const catalog = buildReferenceChainCatalog({ Legacy: LEGACY });
    const def = catalog!.Legacy!;
    expect(def.inputs.find((port) => port.name === "image")?.wire).toBe(true);
    expect(def.inputs.find((port) => port.name === "upload")?.wire).toBe(false);
    expect(def.choices.combo).toEqual(["alpha", "beta"]);
    /* 声明 default 在场优先；不在场回落首候选（既有口径）。 */
    expect(def.defaults.combo).toBe("beta");
    expect(def.inputs.find((port) => port.name === "demoted")?.wire).toBe(true);
    expect(def.widgetOrder).toEqual(["combo", "upload"]);
  });

  it("对象数组候选（{type: [...]}）与载荷非对象（→ null）", () => {
    const catalog = buildReferenceChainCatalog({
      Obj: { input: { required: { pick: { type: ["x", "y"] } } }, output: ["IMAGE"] },
    });
    expect(catalog!.Obj!.choices.pick).toEqual(["x", "y"]);
    expect(buildReferenceChainCatalog(null)).toBeNull();
    expect(buildReferenceChainCatalog("nope")).toBeNull();
  });
});

describe("selectedComboOption", () => {
  it("按选中 key 取选项定义；非动态 COMBO / 未选中 → null", () => {
    const def = resizeDef();
    expect(selectedComboOption(def, "resize_type", "scale to multiple")?.subs).toHaveLength(1);
    expect(selectedComboOption(def, "resize_type", "nope")).toBeNull();
    expect(selectedComboOption(def, "scale_method", "area")).toBeNull();
  });
});

describe("chainWidgetsValues（comfy-cli 配对口径）", () => {
  it("连线口不占位；动态 COMBO 占选择器 + 选中项子输入；缺值回落子输入缺省", () => {
    const def = resizeDef();
    const values = chainWidgetsValues(def, {
      resize_type: "scale to multiple",
      "resize_type.multiple": 32,
      scale_method: "lanczos",
    });
    expect(values).toEqual(["scale to multiple", 32, "lanczos"]);
  });

  it("预设没配的子输入回落 object_info 缺省（对齐「控件值缺省回落节点类默认值」）", () => {
    const def = resizeDef();
    const values = chainWidgetsValues(def, undefined);
    expect(values).toEqual(["scale dimensions", 512, 512, "center", "area"]);
  });

  it("选中项带连线型子输入 → null（建链方整链回落裸装载）", () => {
    const def = resizeDef();
    expect(chainWidgetsValues(def, { resize_type: "match size" })).toBeNull();
  });

  it("未知选中值 → null（存进预设的手改值不在选项里，宁可回落不可错位）", () => {
    const def = resizeDef();
    expect(chainWidgetsValues(def, { resize_type: "nope" })).toBeNull();
  });

  it("无动态 COMBO 的类照旧按部件顺序摆位", () => {
    const catalog = buildReferenceChainCatalog({
      Legacy: {
        ...LEGACY,
        input_order: { required: ["combo", "upload"] },
      },
    });
    const def = catalog!.Legacy!;
    expect(chainWidgetsValues(def, { combo: "alpha", upload: "image" })).toEqual([
      "alpha",
      "image",
    ]);
  });
});
