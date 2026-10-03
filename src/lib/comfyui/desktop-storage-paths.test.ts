// 纯解析层的判据（extra_model_paths.yaml / 目录分类 / 启动参数覆盖）。
// 这些是「读错就会让界面报出另一个目录」的判据，逐分支钉住。
import { describe, expect, it } from "vitest";
import {
  classifyStorageSlot,
  normalizeDirKey,
  parseExtraModelPathsYaml,
  parseStorageDirArgs,
} from "./desktop-storage-paths";

/** Comfy Desktop 实际写出的形状。 */
const SHARED_YAML = [
  "comfyui_shared:",
  "  base_path: D:/Comfy-Desktop/ComfyUI-Shared",
  "  paths:",
  "    - models/",
  "    - input/",
  "    - output/",
  "",
].join("\n");

describe("parseExtraModelPathsYaml", () => {
  it("解析出条目与路径列表", () => {
    const parsed = parseExtraModelPathsYaml(SHARED_YAML);
    expect(parsed.basePath).toBeNull();
    expect(parsed.entries).toEqual([
      {
        key: "comfyui_shared",
        basePath: "D:/Comfy-Desktop/ComfyUI-Shared",
        paths: ["models/", "input/", "output/"],
      },
    ]);
  });

  it("顶层 base_path 是覆盖主base 目录的标量，不算条目", () => {
    const parsed = parseExtraModelPathsYaml(
      [
        "base_path: D:/somewhere",
        "",
        "extra:",
        "  base_path: D:/e",
        "  paths:",
        "    - models",
        "",
      ].join("\n"),
    );
    expect(parsed.basePath).toBe("D:/somewhere");
    expect(parsed.entries).toEqual([
      { key: "extra", basePath: "D:/e", paths: ["models"] },
    ]);
  });

  it("多个条目各自成块（收尾的是最后一个块，不是只有它）", () => {
    const parsed = parseExtraModelPathsYaml(
      [
        "first:",
        "  base_path: D:/one",
        "  paths:",
        "    - models",
        "second:",
        "  base_path: D:/two",
        "  paths:",
        "    - models/loras",
        "",
      ].join("\n"),
    );
    expect(parsed.entries.map((entry) => entry.key)).toEqual([
      "first",
      "second",
    ]);
  });

  it("行内数组与引号值都认，值里的裸 # 不当注释", () => {
    const parsed = parseExtraModelPathsYaml(
      [
        "# 顶部注释",
        "quoted:",
        '  base_path: "D:/a#b"   # 行尾注释',
        "  paths: [models, input]",
        "",
      ].join("\n"),
    );
    expect(parsed.entries).toEqual([
      { key: "quoted", basePath: "D:/a#b", paths: ["models", "input"] },
    ]);
  });

  it("缺 base_path 或缺 paths 的条目按 ComfyUI 行为跳过", () => {
    const parsed = parseExtraModelPathsYaml(
      [
        "no_base:",
        "  paths:",
        "    - models",
        "no_paths:",
        "  base_path: D:/x",
        "is_default: false",
        "",
      ].join("\n"),
    );
    expect(parsed.entries).toEqual([]);
  });

  it("坏行与 CRLF 不炸：无法归属的写法跳过", () => {
    const parsed = parseExtraModelPathsYaml(
      [
        "随便一行没有冒号",
        "good:",
        "  base_path: D:/x",
        "  paths:",
        "\t- models",
        "",
      ].join("\r\n"),
    );
    expect(parsed.entries).toEqual([
      { key: "good", basePath: "D:/x", paths: ["models"] },
    ]);
  });

  it("空文本 → 无条目", () => {
    expect(parseExtraModelPathsYaml("")).toEqual({
      basePath: null,
      entries: [],
    });
  });
});

describe("classifyStorageSlot", () => {
  it("首段是 input / output 归对应侧，其余（含 models 与裸类型名）都归模型侧", () => {
    expect(classifyStorageSlot("models/")).toBe("models");
    expect(classifyStorageSlot("models/checkpoints")).toBe("models");
    expect(classifyStorageSlot("checkpoints")).toBe("models");
    expect(classifyStorageSlot("input")).toBe("input");
    expect(classifyStorageSlot("output/")).toBe("output");
    expect(classifyStorageSlot("OUTPUT")).toBe("output");
  });

  it("绝对路径按末段判input / output，其余仍归模型侧", () => {
    expect(classifyStorageSlot("D:/shared/input")).toBe("input");
    expect(classifyStorageSlot("D:/shared/output")).toBe("output");
    expect(classifyStorageSlot("D:/shared/models/vae")).toBe("models");
  });

  it("空项不会落到 input / output（不可达兜底）", () => {
    expect(classifyStorageSlot("")).toBe("models");
  });
});

describe("parseStorageDirArgs", () => {
  it("认两种写法：--x <值> 与 --x=<值>", () => {
    expect(
      parseStorageDirArgs([
        "--enable-manager",
        "--input-directory",
        "D:/shared/input",
        "--output-directory=D:/shared/output",
        "--base-directory",
        "D:/somewhere",
      ]),
    ).toEqual({
      baseDir: "D:/somewhere",
      inputDir: "D:/shared/input",
      outputDir: "D:/shared/output",
    });
  });

  it("未给值的flag 与无关参数一律当作没给", () => {
    expect(
      parseStorageDirArgs(["--input-directory", "--listen", "0.0.0.0"]),
    ).toEqual({ baseDir: null, inputDir: null, outputDir: null });
  });

  it("只认这三个目录参数（--temp-directory 不进来）", () => {
    const overrides = parseStorageDirArgs([
      "--temp-directory",
      "D:/tmp",
      "--user-directory",
      "D:/user",
    ]);
    expect(overrides.baseDir).toBeNull();
    expect(overrides.inputDir).toBeNull();
    expect(overrides.outputDir).toBeNull();
  });

  it("同名参数后者覆盖前者", () => {
    expect(
      parseStorageDirArgs([
        "--input-directory",
        "D:/a",
        "--input-directory=D:/b",
      ]),
    ).toMatchObject({ inputDir: "D:/b" });
  });
});

describe("normalizeDirKey", () => {
  it("分隔符统一、尾斜杠去掉、大小写折叠", () => {
    expect(normalizeDirKey("D:\\Models\\")).toBe("d:/models");
    expect(normalizeDirKey("D:/models")).toBe("d:/models");
    expect(normalizeDirKey("D:/MODELS")).toBe(normalizeDirKey("d:/models"));
  });
});
