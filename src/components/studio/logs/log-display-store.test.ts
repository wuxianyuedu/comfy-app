/**
 * 日志行显示偏好 store（ISSUE #4567）：默认档、写穿 localStorage、坏值回落。
 * store 是模块单例，读路径的「坏值回落」用 `vi.resetModules()` + 动态 import 重放模块初始化。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const DENSITY_KEY = "comfyapp.logDisplay.density";
const SHOW_META_KEY = "comfyapp.logDisplay.showMeta";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("log-display-store 显示偏好", () => {
  it("没设过：标准行距 + 显示元信息列", async () => {
    const { useLogDisplayStore } = await import("./log-display-store");
    expect(useLogDisplayStore.getState().density).toBe("default");
    expect(useLogDisplayStore.getState().showMeta).toBe(true);
  });

  it("setDensity / setShowMeta 即时生效并写穿 localStorage", async () => {
    const { useLogDisplayStore } = await import("./log-display-store");
    useLogDisplayStore.getState().setDensity("relaxed");
    useLogDisplayStore.getState().setShowMeta(false);
    expect(useLogDisplayStore.getState().density).toBe("relaxed");
    expect(useLogDisplayStore.getState().showMeta).toBe(false);
    expect(localStorage.getItem(DENSITY_KEY)).toBe(JSON.stringify("relaxed"));
    expect(localStorage.getItem(SHOW_META_KEY)).toBe(JSON.stringify(false));
  });

  it("localStorage 里的坏值回落默认（行距词表外 → default）", async () => {
    localStorage.setItem(DENSITY_KEY, JSON.stringify("super-loose"));
    localStorage.setItem(SHOW_META_KEY, JSON.stringify("no"));
    const { useLogDisplayStore } = await import("./log-display-store");
    expect(useLogDisplayStore.getState().density).toBe("default");
    /* showMeta 只认 `false` 为关；其它形状（含坏值）一律按显示处理。 */
    expect(useLogDisplayStore.getState().showMeta).toBe(true);
  });

  it("重新挂载（模块重放）读回上次保存的偏好", async () => {
    const first = await import("./log-display-store");
    first.useLogDisplayStore.getState().setDensity("compact");
    const second = await import("./log-display-store");
    expect(second.useLogDisplayStore.getState().density).toBe("compact");
  });
});
