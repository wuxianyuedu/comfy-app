// 日志分类开关 store 的水合安全单测（ISSUE #5011）：store 创建期**不读**
// localStorage（SSR 与客户端首帧同值），自定义开关在挂载后 `hydrate()` 才生效。
// 模块级读 storage 是本仓已记录过的水合不匹配坑（message-center-store 同族）。
import { afterEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "comfyapp.logCategories.enabled";

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("log-category store 水合安全（ISSUE #5011）", () => {
  it("store 创建不读 localStorage：自定义开关在 hydrate() 前不生效", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ comfyui: false, workshop: false }));
    vi.resetModules();
    const { useLogCategoryStore } = await import("./log-category-store");
    expect(useLogCategoryStore.getState().hydrated).toBe(false);
    /* 默认全开：storage 里的自定义值没有参与首帧。 */
    expect(useLogCategoryStore.getState().enabled["app-runtime"]).toBe(true);
    expect(useLogCategoryStore.getState().enabled.console).toBe(true);
  });

  it("hydrate() 恢复持久化的自定义开关，缺的键回落默认开启", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ "app-runtime": false, launcher: false }));
    vi.resetModules();
    const { useLogCategoryStore } = await import("./log-category-store");
    useLogCategoryStore.getState().hydrate();
    const { enabled, hydrated } = useLogCategoryStore.getState();
    expect(hydrated).toBe(true);
    expect(enabled["app-runtime"]).toBe(false);
    expect(enabled.launcher).toBe(false);
    /* 没存过的键保持默认开启（合并语义，不是整体替换）。 */
    expect(enabled.console).toBe(true);
  });

  it("hydrate() 幂等：重复调用不会把用户当次的改动冲掉", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ "app-runtime": false }));
    vi.resetModules();
    const { useLogCategoryStore } = await import("./log-category-store");
    useLogCategoryStore.getState().hydrate();
    /* 用户在面板里又关了一个分类（写回 storage）。 */
    useLogCategoryStore.getState().setEnabled("console", false);
    useLogCategoryStore.getState().hydrate();
    const { enabled } = useLogCategoryStore.getState();
    expect(enabled["app-runtime"]).toBe(false);
    expect(enabled.console).toBe(false);
  });

  it("损坏的存储内容回落默认全开，不抛错", async () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    vi.resetModules();
    const { useLogCategoryStore } = await import("./log-category-store");
    useLogCategoryStore.getState().hydrate();
    expect(useLogCategoryStore.getState().enabled["app-runtime"]).toBe(true);
  });
});
