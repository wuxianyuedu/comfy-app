/**
 * 日志显示偏好（ISSUE #4567）：默认档、写穿 localStorage、坏值回落。
 * 模块在初始化时读一次存储，读路径的回落用 `vi.resetModules()` + 动态 import 重放。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "comfyapp:log-display-prefs";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("log-display-prefs 显示偏好", () => {
  it("没设过：标准行距 + 标准字号 + 完整列", async () => {
    const { getLogDisplayPrefs } = await import("./log-display-prefs");
    expect(getLogDisplayPrefs()).toEqual({
      columns: "full",
      density: "standard",
      fontSize: "standard",
    });
  });

  it("setLogDensity / setLogColumns / setLogFontSize 即时生效并写穿 localStorage", async () => {
    const { getLogDisplayPrefs, setLogColumns, setLogDensity, setLogFontSize } =
      await import("./log-display-prefs");
    setLogDensity("relaxed");
    setLogColumns("message-only");
    setLogFontSize("large");
    expect(getLogDisplayPrefs()).toEqual({
      columns: "message-only",
      density: "relaxed",
      fontSize: "large",
    });
    /* 键序由写入方的展开顺序决定，按解析后的对象比、不比原始串。 */
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
      columns: "message-only",
      density: "relaxed",
      fontSize: "large",
    });
  });

  it("localStorage 里的坏值按缺省处理（不至于把面板渲染搞挂）", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const first = await import("./log-display-prefs");
    expect(first.getLogDisplayPrefs()).toEqual({
      columns: "full",
      density: "standard",
      fontSize: "standard",
    });
    /* 单档坏值：好的那格保留、坏的那格回落。 */
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ density: "super-loose", columns: "message-only", fontSize: "huge" }),
    );
    vi.resetModules();
    const second = await import("./log-display-prefs");
    expect(second.getLogDisplayPrefs()).toEqual({
      columns: "message-only",
      density: "standard",
      fontSize: "standard",
    });
  });

  it("重新挂载（模块重放）读回上次保存的偏好", async () => {
    const first = await import("./log-display-prefs");
    first.setLogDensity("compact");
    first.setLogFontSize("small");
    const second = await import("./log-display-prefs");
    expect(second.getLogDisplayPrefs().density).toBe("compact");
    expect(second.getLogDisplayPrefs().fontSize).toBe("small");
  });
});
