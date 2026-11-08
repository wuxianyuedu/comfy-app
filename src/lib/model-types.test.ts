// 「什么东西算模型」的两个判据（ISSUE #3368）：ComfyUI 对目录列的是**全部**文件、
// 目录清单里混着 custom_nodes —— 这两个闸是「模型库里只有模型」的唯一防线。
// 现场回归：Custom Nodes 一栏 220 个条目全是 x-flux-comfyui 的源码
// （.py/.pyc/.json/.gitignore/LICENSE/README.md）。

import { describe, expect, it } from "vitest";

import { isModelFileName, isModelFolder } from "./model-types";

describe("isModelFileName 按扩展名判模型文件", () => {
  it("权重/模型扩展名全收（大小写不敏感）", () => {
    for (const name of [
      "waiIllustriousSDXL_v170.safetensors",
      "model.SAFETENSORS",
      "v1-5-pruned-emaonly.ckpt",
      "clip_vision_h.pt",
      "diffusion_pytorch_model.pth",
      "ultralytics+face_yolov8m.bin",
      "qwen2.5-vl.gguf",
      "Huanyuan.sft",
      "clip_l.onnx",
      "sd_xl_tensorrt.engine",
      "flux1.trt",
    ]) {
      expect(isModelFileName(name)).toBe(true);
    }
  });

  it("源码 / 文档 / 字体 / 无后缀文件一律不收", () => {
    for (const name of [
      "autoencoder.py",
      "layers.cpython-313.pyc",
      "ip_adapter_workflow.json",
      ".gitignore",
      "LICENSE",
      "README.md",
      "readme",
      "font.ttf",
      "notes.txt",
      "schema.yaml",
    ]) {
      expect(isModelFileName(name)).toBe(false);
    }
  });

  it("取的是最后一段后缀：插件仓库的深层路径也判得对", () => {
    expect(isModelFileName(String.raw`x-flux-comfyui\xflux\src\flux\modules\layers.py`)).toBe(
      false,
    );
    expect(
      isModelFileName(
        String.raw`x-flux-comfyui\xflux\src\flux\modules\__pycache__\layers.cpython-313.pyc`,
      ),
    ).toBe(false);
    expect(isModelFileName("SomeNode/models/real_lora.safetensors")).toBe(true);
  });
});

describe("isModelFolder 按用途判目录", () => {
  it("custom_nodes 各形态（下划线 / 空格 / 大小写）都排除", () => {
    for (const folder of [
      "custom_nodes",
      "Custom Nodes",
      "CustomNodes",
      "custom-nodes",
      "CUSTOM_NODES",
    ]) {
      expect(isModelFolder(folder)).toBe(false);
    }
  });

  it("模型目录（含插件注册的）不误伤", () => {
    for (const folder of [
      "checkpoints",
      "loras",
      "kjnodes_fonts",
      "LLM",
      "background_removal",
      "unet",
      "diffusion_models",
    ]) {
      expect(isModelFolder(folder)).toBe(true);
    }
  });
});
