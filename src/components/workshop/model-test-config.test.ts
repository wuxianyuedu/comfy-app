// ── model-test-config 纯函数单测（#3590）─────────────────────────────────
// 覆盖三件事：候选过滤、请求组装（数字解析与空键省略）、控件分派。

import { describe, expect, it } from "vitest";

import type { RemoteModeAdapter } from "~/lib/workshop/remote-model-adapter";

import {
  assembleImageRequest,
  assembleVideoRequest,
  controlForInputType,
  relayInputCount,
  testCandidatesForKind,
} from "./model-test-config";

describe("testCandidatesForKind", () => {
  const entries = [
    { baseUrl: "https://a/v1", kind: "image", name: "agnes-image" },
    { baseUrl: "https://a/v1", kind: "video", name: "agnes-video" },
    { baseUrl: "https://a/v1", kind: "chat", name: "agnes-3.0" },
    { baseUrl: null, kind: "image", name: "无址条目" },
  ];

  it("按 kind 过滤；chat 不参与；无名条目丢弃", () => {
    expect(testCandidatesForKind("image", entries).map((c) => c.name)).toEqual(["agnes-image"]);
    expect(testCandidatesForKind("video", entries).map((c) => c.name)).toEqual(["agnes-video"]);
  });
});

describe("assembleImageRequest / assembleVideoRequest", () => {
  it("填了的键带上、没填的键省略；multiple / duration 转数字", () => {
    expect(
      assembleImageRequest({
        model: "agnes-image",
        mode: "T2I",
        values: { prompt: " 一只柴犬 ", negative: " 模糊 ", "aspect-ratio": "16:9" },
      }),
    ).toEqual({
      model: "agnes-image",
      mode: "T2I",
      prompt: "一只柴犬",
      negative: "模糊",
      aspectRatio: "16:9",
    });
    expect(
      assembleVideoRequest({
        model: "agnes-video",
        mode: "T2V",
        values: { prompt: "p", duration: "5", "first-frame": "data:image/png;base64,AAA" },
      }),
    ).toEqual({
      model: "agnes-video",
      mode: "T2V",
      prompt: "p",
      duration: 5,
      image: "data:image/png;base64,AAA",
    });
  });

  it("非法数字（空白 / 非数 / 非正）不带键", () => {
    const req = assembleImageRequest({
      model: "m",
      mode: "T2I",
      values: { prompt: "p", multiple: " abc " },
    });
    expect("multiple" in req).toBe(false);
    const req2 = assembleVideoRequest({
      model: "m",
      mode: "T2V",
      values: { prompt: "p", duration: "-3" },
    });
    expect("duration" in req2).toBe(false);
  });
});

describe("controlForInputType / relayInputCount", () => {
  it("17 种输入类型都有控件；图片族归 image、尺寸三件套各归各位", () => {
    expect(controlForInputType("prompt")).toBe("prompt");
    expect(controlForInputType("negative")).toBe("negative");
    expect(controlForInputType("aspect-ratio")).toBe("ratio");
    expect(controlForInputType("megapixels")).toBe("megapixels");
    expect(controlForInputType("multiple")).toBe("multiple");
    expect(controlForInputType("duration")).toBe("duration");
    expect(controlForInputType("seed")).toBe("number");
    for (const t of [
      "image",
      "first-frame",
      "last-frame",
      "mask",
      "depth",
      "pose",
      "lineart",
      "edge",
    ] as const) {
      expect(controlForInputType(t)).toBe("image");
    }
  });

  it("relayInputCount 只数通道承接得住的行（其余是工坊完整链路的输入）", () => {
    const adapter: RemoteModeAdapter = {
      mode: "T2I",
      inputs: [
        { type: "prompt", field: "prompt" },
        { type: "seed", field: "seed" },
      ],
      outputField: "url",
    };
    expect(relayInputCount(adapter, "image")).toBe(1);
    /* prompt 也在视频承接集里，seed 不在 */
    expect(relayInputCount(adapter, "video")).toBe(1);
  });
});
