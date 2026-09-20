/**
 * `primaryModelName` —— 从本次实际提交的图里认主模型。
 *
 * 为什么值得钉住：这是状态栏「现在跑的是哪个模型」**唯一**的数据来源
 * （`/system_stats` 不含模型名，`/queue` 的条目此前没有任何代码解析）。而它要认
 * 两种形态 —— 执行载荷有两条路：API 格式（`inputs.ckpt_name`）与 RAW 路径存的
 * UI 格式（`widgets_values[0]`，取值口径完全不同）。少认一种，那条路上的用户就
 * 永远看不到模型名。
 */
import { describe, expect, it } from "vitest";

import { primaryModelName } from "./executed-model";

describe("primaryModelName —— API 格式（字段名）", () => {
  it("认 CheckpointLoaderSimple 的 ckpt_name", () => {
    const graph = {
      "4": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "flux1-dev.safetensors" },
      },
      "3": { class_type: "KSampler", inputs: { seed: 1 } },
    };
    expect(primaryModelName(graph)).toBe("flux1-dev.safetensors");
  });

  it("没有 ckpt 时退到 unet_name（UNETLoader 那条路）", () => {
    const graph = {
      "1": {
        class_type: "UNETLoader",
        inputs: { unet_name: "sdxl.safetensors" },
      },
    };
    expect(primaryModelName(graph)).toBe("sdxl.safetensors");
  });

  it("ckpt 优先于 unet（两个都在时取更能代表这次生成的那个）", () => {
    const graph = {
      a: { class_type: "UNETLoader", inputs: { unet_name: "u.safetensors" } },
      b: {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "c.safetensors" },
      },
    };
    expect(primaryModelName(graph)).toBe("c.safetensors");
  });
});

describe("primaryModelName —— UI 格式（节点类型 + 下标）", () => {
  it("认 widgets_values[0]（RAW 路径存的就是这个形态）", () => {
    const graph = {
      nodes: [
        { id: 1, type: "KSampler", widgets_values: [20, 7.5] },
        {
          id: 4,
          type: "CheckpointLoaderSimple",
          widgets_values: ["sd15.safetensors"],
        },
      ],
    };
    expect(primaryModelName(graph)).toBe("sd15.safetensors");
  });

  it("子图里嵌套的节点也找得到", () => {
    const graph = {
      nodes: [
        {
          id: 9,
          type: "Subgraph",
          subgraph: {
            nodes: [
              {
                id: 1,
                type: "UNETLoader",
                widgets_values: ["inner.safetensors", "fp8"],
              },
            ],
          },
        },
      ],
    };
    expect(primaryModelName(graph)).toBe("inner.safetensors");
  });
});

describe("primaryModelName —— 认不出时如实返回 null", () => {
  it("不是图 / 空值", () => {
    expect(primaryModelName(null)).toBeNull();
    expect(primaryModelName(undefined)).toBeNull();
    expect(primaryModelName("flux.safetensors")).toBeNull();
    expect(primaryModelName({})).toBeNull();
  });

  it("带目录的名字不算（状态栏那一行看不出是哪个模型）", () => {
    const graph = {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "models/checkpoints/flux.safetensors" },
      },
    };
    expect(primaryModelName(graph)).toBeNull();
  });

  it("空串不算", () => {
    const graph = {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "  " },
      },
    };
    expect(primaryModelName(graph)).toBeNull();
  });
});
