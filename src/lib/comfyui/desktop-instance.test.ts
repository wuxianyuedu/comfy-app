// desktop-instance 纯函数单测：实例 ID 解析、installations.json 定位、
// launchArgs→headless 映射。

import { describe, expect, it } from "vitest";
import {
  appendSharedDirFlags,
  parseInstanceId,
  findInstallationById,
  launchArgsToHeadless,
  parseDesktopLaunchArgs,
  parseSharedDirsFromSettings,
  splitArgTokens,
  resolveEffectiveLaunch,
  type DesktopSharedDirFlags,
} from "./desktop-instance";

/** 测试用的「什么都没登记」共享目录位。 */
const NO_SHARED: DesktopSharedDirFlags = {
  extraModelPathsConfig: null,
  inputDir: null,
  outputDir: null,
};

describe("parseInstanceId", () => {
  it("读取单行实例 ID，去空白", () => {
    expect(parseInstanceId("  inst-1782874099613\n")).toBe("inst-1782874099613");
  });
  it("空内容返回 null", () => {
    expect(parseInstanceId("  \n")).toBeNull();
  });
});

describe("findInstallationById", () => {
  const installs = [
    { id: "inst-aaa", launchArgs: "--port 8190" },
    { id: "inst-1782874099613", launchArgs: "--enable-manager --port 8188" },
  ];
  it("顶层数组按 id 命中", () => {
    const hit = findInstallationById(installs, "inst-1782874099613");
    expect(hit).not.toBeNull();
    expect(hit?.launchArgs).toContain("--enable-manager");
  });
  it("顶层对象直接键值命中", () => {
    const data = { "inst-xyz": { id: "inst-xyz", launchArgs: "--port 1" } };
    const hit = findInstallationById(data, "inst-xyz");
    expect(hit).not.toBeNull();
  });
  it("嵌套对象深搜命中", () => {
    const data = {
      installations: { list: [{ id: "inst-zzz", launchArgs: "" }] },
    };
    const hit = findInstallationById(data, "inst-zzz");
    expect(hit).not.toBeNull();
  });
  it("找不到返回 null", () => {
    expect(findInstallationById(installs, "inst-nope")).toBeNull();
  });
});

describe("launchArgsToHeadless", () => {
  it("抽取 --port（空格写法）并保留其余参数", () => {
    const r = launchArgsToHeadless("--enable-manager --port 8191 --listen 0.0.0.0");
    expect(r.port).toBe(8191);
    expect(r.args).toContain("--enable-manager");
    expect(r.args).toContain("--listen");
  });
  it("抽取 --port= 写法", () => {
    const r = launchArgsToHeadless(["--port=8192", "--enable-manager"]);
    expect(r.port).toBe(8192);
    expect(r.args).toEqual(["--enable-manager"]);
  });
  it("无 --port → null", () => {
    const r = launchArgsToHeadless("--enable-manager");
    expect(r.port).toBeNull();
  });
  it("丢弃命令头与 GUI 专属 token", () => {
    const r = launchArgsToHeadless("python main.py --show --enable-manager");
    expect(r.args).not.toContain("python");
    expect(r.args).not.toContain("main.py");
    expect(r.args).not.toContain("--show");
    expect(r.args).toContain("--enable-manager");
  });
  it("字符串含双引号路径 → 保留含空格路径为整体", () => {
    const r = launchArgsToHeadless(String.raw`--input-directory "D:\My Comfy\input"`);
    expect(r.args).toEqual(["--input-directory", String.raw`D:\My Comfy\input`]);
  });
  it("数组入参", () => {
    const r = launchArgsToHeadless(["--port", "8200", "--enable-manager"]);
    expect(r.port).toBe(8200);
  });
});

describe("parseDesktopLaunchArgs", () => {
  it("从文件内容按 id 定位并映射，带 envVars", () => {
    const raw = JSON.stringify({
      installations: [
        {
          id: "inst-1",
          launchArgs: "--port 8233",
          envVars: { PYTHONUTF8: "1" },
        },
      ],
    });
    const r = parseDesktopLaunchArgs(raw, "inst-1");
    expect(r).not.toBeNull();
    expect(r?.port).toBe(8233);
    expect(r?.envVars).toEqual({ PYTHONUTF8: "1" });
  });
  it("JSON 非法 → null", () => {
    expect(parseDesktopLaunchArgs("not json", "inst-1")).toBeNull();
  });
  it("id 不在文件 → null", () => {
    expect(parseDesktopLaunchArgs("[]", "inst-1")).toBeNull();
  });
});

describe("splitArgTokens", () => {
  it("切分带引号路径的字符串", () => {
    expect(splitArgTokens(String.raw`--input-directory "D:\A B" --x`)).toEqual([
      "--input-directory",
      String.raw`D:\A B`,
      "--x",
    ]);
  });
  it("空串 → []", () => {
    expect(splitArgTokens("")).toEqual([]);
  });
});

describe("parseSharedDirsFromSettings", () => {
  it("解出 inputDir / outputDir", () => {
    const inputDir = String.raw`D:\ComfyUI-Shared\input`;
    const outputDir = String.raw`D:\Shared\out`;
    expect(parseSharedDirsFromSettings(JSON.stringify({ inputDir, outputDir }))).toEqual({
      inputDir,
      outputDir,
    });
  });
  it("键缺失 / 空串 / 非字符串值都按没登记（null）", () => {
    expect(parseSharedDirsFromSettings("{}")).toEqual({ inputDir: null, outputDir: null });
    expect(parseSharedDirsFromSettings(JSON.stringify({ inputDir: "  ", outputDir: 42 }))).toEqual({
      inputDir: null,
      outputDir: null,
    });
  });
  it("JSON 坏 / 顶层不是对象 → null", () => {
    expect(parseSharedDirsFromSettings("not json")).toEqual({ inputDir: null, outputDir: null });
    expect(parseSharedDirsFromSettings("[1,2]")).toEqual({ inputDir: null, outputDir: null });
  });
});

describe("appendSharedDirFlags", () => {
  const SHARED: DesktopSharedDirFlags = {
    extraModelPathsConfig: "C:/appdata/inst-1.yaml",
    inputDir: "D:/Shared/input",
    outputDir: "D:/Shared/output",
  };
  it("空 argv 三个都追加，顺序固定", () => {
    expect(appendSharedDirFlags([], SHARED)).toEqual([
      "--extra-model-paths-config",
      "C:/appdata/inst-1.yaml",
      "--input-directory",
      "D:/Shared/input",
      "--output-directory",
      "D:/Shared/output",
    ]);
  });
  it("已带的 flag 不重复（--x 值 与 --x=值 两种写法都算已带）", () => {
    expect(
      appendSharedDirFlags(
        ["--input-directory", "D:/mine", "--extra-model-paths-config=D:/my.yaml"],
        SHARED,
      ),
    ).toEqual([
      "--input-directory",
      "D:/mine",
      "--extra-model-paths-config=D:/my.yaml",
      "--output-directory",
      "D:/Shared/output",
    ]);
  });
  it("没登记的位（null）不产生参数", () => {
    expect(
      appendSharedDirFlags(["--enable-manager"], { ...SHARED, inputDir: null, outputDir: null }),
    ).toEqual(["--enable-manager", "--extra-model-paths-config", "C:/appdata/inst-1.yaml"]);
  });
});

describe("resolveEffectiveLaunch", () => {
  it("便携版沿用设置端口与 extraArgs", async () => {
    const r = await resolveEffectiveLaunch({
      comfyuiPath: "C:/portable",
      comfyuiPort: 8300,
      comfyuiExtraArgs: "--enable-manager --x",
      classify: () => ({ kind: "portable", instanceIdFile: null }),
    });
    expect(r.port).toBe(8300);
    expect(r.extraArgs).toEqual(["--enable-manager", "--x"]);
    expect(r.envVars).toEqual({});
  });

  it("桌面实例读元数据映射端口与参数", async () => {
    const r = await resolveEffectiveLaunch({
      comfyuiPath: "C:/desktop",
      comfyuiPort: 9999, // 桌面忽略手填端口
      comfyuiExtraArgs: "--ignored",
      classify: () => ({
        kind: "desktop",
        instanceIdFile: "C:/desktop/.comfyui-desktop-2",
      }),
      resolveDesktop: () =>
        Promise.resolve({
          port: 8311,
          args: ["--enable-manager"],
          envVars: { PYTHONUTF8: "1" },
        }),
      resolveShared: () => Promise.resolve(NO_SHARED),
    });
    expect(r.port).toBe(8311);
    expect(r.extraArgs).toEqual(["--enable-manager"]);
    expect(r.envVars).toEqual({ PYTHONUTF8: "1" });
  });

  it("桌面实例元数据缺失 → 回落默认端口、忽略手填", async () => {
    const r = await resolveEffectiveLaunch({
      comfyuiPath: "C:/desktop",
      comfyuiPort: 9999,
      comfyuiExtraArgs: "--ignored",
      classify: () => ({
        kind: "desktop",
        instanceIdFile: "C:/desktop/.comfyui-desktop-2",
      }),
      resolveDesktop: () => Promise.resolve(null),
      resolveShared: () => Promise.resolve(NO_SHARED),
    });
    expect(r.port).toBe(0); // 0 → 调用方按默认 8188
    expect(r.extraArgs).toEqual([]);
  });

  it("桌面实例追加共享目录参数（模型声明 + 输入 / 输出）", async () => {
    const r = await resolveEffectiveLaunch({
      comfyuiPath: "C:/desktop",
      comfyuiPort: 0,
      comfyuiExtraArgs: "",
      classify: () => ({
        kind: "desktop",
        instanceIdFile: "C:/desktop/.comfyui-desktop-2",
      }),
      resolveDesktop: () =>
        Promise.resolve({ port: null, args: ["--enable-manager"], envVars: {} }),
      resolveShared: (file) => {
        expect(file).toBe("C:/desktop/.comfyui-desktop-2");
        return Promise.resolve({
          extraModelPathsConfig: "C:/appdata/instance-model-paths/inst-1.yaml",
          inputDir: "D:/ComfyUI-Shared/input",
          outputDir: "D:/ComfyUI-Shared/output",
        });
      },
    });
    expect(r.extraArgs).toEqual([
      "--enable-manager",
      "--extra-model-paths-config",
      "C:/appdata/instance-model-paths/inst-1.yaml",
      "--input-directory",
      "D:/ComfyUI-Shared/input",
      "--output-directory",
      "D:/ComfyUI-Shared/output",
    ]);
  });

  it("元数据读不到时共享目录参数照常追加（两者互不依赖）", async () => {
    const r = await resolveEffectiveLaunch({
      comfyuiPath: "C:/desktop",
      comfyuiPort: 0,
      comfyuiExtraArgs: "",
      classify: () => ({
        kind: "desktop",
        instanceIdFile: "C:/desktop/.comfyui-desktop-2",
      }),
      resolveDesktop: () => Promise.resolve(null),
      resolveShared: () =>
        Promise.resolve({
          extraModelPathsConfig: "C:/appdata/inst-1.yaml",
          inputDir: null,
          outputDir: "D:/ComfyUI-Shared/output",
        }),
    });
    expect(r.port).toBe(0);
    expect(r.extraArgs).toEqual([
      "--extra-model-paths-config",
      "C:/appdata/inst-1.yaml",
      "--output-directory",
      "D:/ComfyUI-Shared/output",
    ]);
  });

  it("launchArgs 已带同名 flag 时不重复追加（手填优先）", async () => {
    const r = await resolveEffectiveLaunch({
      comfyuiPath: "C:/desktop",
      comfyuiPort: 0,
      comfyuiExtraArgs: "",
      classify: () => ({
        kind: "desktop",
        instanceIdFile: "C:/desktop/.comfyui-desktop-2",
      }),
      resolveDesktop: () =>
        Promise.resolve({
          port: null,
          args: ["--input-directory", "D:/my-own/input", "--extra-model-paths-config=D:/my.yaml"],
          envVars: {},
        }),
      resolveShared: () =>
        Promise.resolve({
          extraModelPathsConfig: "C:/appdata/inst-1.yaml",
          inputDir: "D:/ComfyUI-Shared/input",
          outputDir: "D:/ComfyUI-Shared/output",
        }),
    });
    expect(r.extraArgs).toEqual([
      "--input-directory",
      "D:/my-own/input",
      "--extra-model-paths-config=D:/my.yaml",
      "--output-directory",
      "D:/ComfyUI-Shared/output",
    ]);
  });

  it("便携版不追加共享目录参数（那是 Comfy Desktop 登记的概念）", async () => {
    const r = await resolveEffectiveLaunch({
      comfyuiPath: "C:/portable",
      comfyuiPort: 8300,
      comfyuiExtraArgs: "--x",
      classify: () => ({ kind: "portable", instanceIdFile: null }),
      resolveShared: () => {
        throw new Error("便携路径不应读共享目录");
      },
    });
    expect(r.extraArgs).toEqual(["--x"]);
  });

  it("桌面实例无 ID 文件（仅布局）→ 视为便携逻辑走设置项", async () => {
    const r = await resolveEffectiveLaunch({
      comfyuiPath: "C:/desktop-layout",
      comfyuiPort: 8400,
      comfyuiExtraArgs: "--keep",
      classify: () => ({ kind: "desktop", instanceIdFile: null }),
    });
    expect(r.port).toBe(8400);
    expect(r.extraArgs).toEqual(["--keep"]);
  });
});
