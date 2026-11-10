/**
 * `scripts/launcher-core/app-data-dir.mjs` 的 `resolveAppDataDir`：standalone 运行期数据根
 * （日志 / 导出）的跨平台解析（ISSUE #3498）。依赖（env / homedir / platform）全部可注入，
 * 所以在 Linux 的 CI 上也能把 win32 / darwin 的形状跑出来——这正是它被拆成纯函数、不读
 * 真实 `process` 的原因。判据只钉「根指向哪一类 OS 目录」与「`COMFY_APP_DATA_DIR` 覆盖最高优先」。
 */
import { describe, expect, it } from "vitest";

// 静态相对路径 import 未带类型的 .mjs 模块（与仓库 app-port-cross-language.test.ts 同款写法）：
// 用静态字符串路径 TS 才能从 JSDoc 推出 resolveAppDataDir 的类型，避免解构出 any 触发
// oxlint 的 no-unsafe-assignment / no-unsafe-call（动态计算路径会让 import() 落到 any）。
const { resolveAppDataDir } = await import("../scripts/launcher-core/app-data-dir.mjs");

/** 跨平台分隔符统一成 `/`，再判「指向哪一类目录」。 */
const norm = (p: string) => p.replaceAll("\\", "/");

describe("resolveAppDataDir：OS 默认形态（按 platform 分支）", () => {
  it("win32 优先 %LOCALAPPDATA%", () => {
    const got = resolveAppDataDir({
      env: { LOCALAPPDATA: String.raw`C:\Users\x\AppData\Local` },
      homedir: String.raw`C:\Users\x`,
      platform: "win32",
    });
    expect(norm(got)).toBe("C:/Users/x/AppData/Local/comfy-app-t3");
  });

  it("win32 无 LOCALAPPDATA 时退 %APPDATA%", () => {
    const got = resolveAppDataDir({
      env: { APPDATA: String.raw`C:\Users\x\AppData\Roaming` },
      homedir: String.raw`C:\Users\x`,
      platform: "win32",
    });
    expect(norm(got)).toBe("C:/Users/x/AppData/Roaming/comfy-app-t3");
  });

  it("win32 两者皆无时回退 homedir 下的 AppData/Local", () => {
    const got = resolveAppDataDir({
      env: {},
      homedir: String.raw`C:\Users\x`,
      platform: "win32",
    });
    expect(norm(got)).toBe("C:/Users/x/AppData/Local/comfy-app-t3");
  });

  it("darwin 指向 Library/Application Support", () => {
    const got = resolveAppDataDir({
      env: {},
      homedir: "/Users/x",
      platform: "darwin",
    });
    expect(norm(got)).toBe("/Users/x/Library/Application Support/comfy-app-t3");
  });

  it("linux 优先 $XDG_DATA_HOME", () => {
    const got = resolveAppDataDir({
      env: { XDG_DATA_HOME: "/home/x/.xdg" },
      homedir: "/home/x",
      platform: "linux",
    });
    expect(norm(got)).toBe("/home/x/.xdg/comfy-app-t3");
  });

  it("linux 无 XDG_DATA_HOME 时回退 ~/.local/share", () => {
    const got = resolveAppDataDir({
      env: {},
      homedir: "/home/x",
      platform: "linux",
    });
    expect(norm(got)).toBe("/home/x/.local/share/comfy-app-t3");
  });
});

describe("resolveAppDataDir：显式覆盖最高优先", () => {
  it("COMFY_APP_DATA_DIR 一旦设了，platform / homedir 都不看", () => {
    const got = resolveAppDataDir({
      env: {
        COMFY_APP_DATA_DIR: "/custom/data/root",
        LOCALAPPDATA: String.raw`C:\Users\x\AppData\Local`,
      },
      homedir: String.raw`C:\Users\x`,
      platform: "win32",
    });
    expect(got).toBe("/custom/data/root");
  });
});
