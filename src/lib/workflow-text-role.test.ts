/* 正 / 负向提示词端口的分类池（ISSUE #620）。
 *
 * 这层要回答的是「工作流把负向提示词承接在哪一行」—— 判据只走「名字 → 图内
 * 文本编码节点顺序」两级，且**与工作流内部长什么样无关**：负向提示词是工坊的
 * 统一配置口，判不出图内角色时也要能落到那个承接它的节点上。
 */

import { describe, expect, it } from "vitest";

import {
  inferNegativeSlot,
  isTextEncoderClass,
  nameSaysNegative,
  roleKeyword,
  type TextSlotCandidate,
} from "~/lib/workflow-text-role";

function slot(
  ioKey: string,
  extra: Partial<TextSlotCandidate> = {},
): TextSlotCandidate {
  return { ioKey, name: "text", label: "文本", ...extra };
}

describe("isTextEncoderClass", () => {
  it("认 ComfyUI 家族里的文本编码节点，不认第三方润色 / 翻译节点", () => {
    expect(isTextEncoderClass("CLIPTextEncode")).toBe(true);
    expect(isTextEncoderClass("CLIPTextEncodeSDXL")).toBe(true);
    expect(isTextEncoderClass("TextEncodeQwenImageEdit")).toBe(true);
    expect(isTextEncoderClass("PromptEnhancer")).toBe(false);
    expect(isTextEncoderClass(undefined)).toBe(false);
  });
});

describe("roleKeyword", () => {
  it("角色折算成名字判据里的同义关键词（正 prompt / 负 negative）", () => {
    expect(roleKeyword("negative")).toBe("negative");
    expect(roleKeyword("positive")).toBe("prompt");
    expect(roleKeyword(undefined)).toBe("");
  });
});

describe("nameSaysNegative", () => {
  it("中英文的负向写法都认", () => {
    expect(nameSaysNegative("negative_prompt")).toBe(true);
    expect(nameSaysNegative("负向提示词")).toBe(true);
    expect(nameSaysNegative("反向")).toBe(true);
    expect(nameSaysNegative("text")).toBe(false);
  });
});

describe("inferNegativeSlot", () => {
  it("名字里写了负向的条目直接认（作者命名优先于图内顺序）", () => {
    const candidates = [
      slot("9::widget::text", { isTextNode: true }),
      slot("88::widget::text", { name: "value", isTextNode: true }),
      /* 中文标签 + 英文端口名：两处任一命中都要认（标签被翻译成「文本」时，
       * 端口名才是唯一线索）。 */
      slot("5::widget::negative_prompt", {
        name: "negative_prompt",
        label: "文本",
      }),
    ];
    expect(inferNegativeSlot(candidates)).toBe("5::widget::negative_prompt");
  });

  it("名字分不出正负时按图内文本编码节点顺序取第二个（与 detectParamMap 同一序）", () => {
    const candidates = [
      slot("9::widget::text", { isTextNode: true, role: "positive" }),
      slot("88::widget::text", { isTextNode: true }),
      slot("5::widget::width"),
    ];
    expect(inferNegativeSlot(candidates)).toBe("88::widget::text");
  });

  it("图内角色判出来时优先于序号兜底", () => {
    const candidates = [
      slot("9::widget::text", { isTextNode: true, role: "positive" }),
      slot("88::widget::text", { isTextNode: true }),
      slot("120::widget::text", { isTextNode: true, role: "negative" }),
    ];
    expect(inferNegativeSlot(candidates)).toBe("120::widget::text");
  });

  it("只有一个文本编码节点时判不出来（不把正向口编成负向）", () => {
    expect(
      inferNegativeSlot([
        slot("9::widget::text", { isTextNode: true, role: "positive" }),
        slot("5::widget::width"),
      ]),
    ).toBeNull();
    expect(inferNegativeSlot([])).toBeNull();
  });

  it("第三方节点（非文本编码节点）不参与序号兜底", () => {
    expect(
      inferNegativeSlot([
        slot("9::widget::text", { isTextNode: true }),
        slot("77::widget::value", { name: "value", label: "润色结果" }),
      ]),
    ).toBeNull();
  });
});
