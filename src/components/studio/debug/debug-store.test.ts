import { describe, it, expect, beforeEach } from "vitest";
import { useDebugStore } from "./debug-store";

beforeEach(() => {
  // 每个用例前重置为初始关闭状态,避免用例间污染
  useDebugStore.setState({ debugMode: false });
});

describe("debug-store 调试模式状态迁移", () => {
  it("重置后初始状态为关闭", () => {
    expect(useDebugStore.getState().debugMode).toBe(false);
  });

  it("toggleDebugMode 在关闭时打开", () => {
    useDebugStore.getState().toggleDebugMode();
    expect(useDebugStore.getState().debugMode).toBe(true);
  });

  it("toggleDebugMode 连续调用两次回到关闭", () => {
    useDebugStore.getState().toggleDebugMode();
    useDebugStore.getState().toggleDebugMode();
    expect(useDebugStore.getState().debugMode).toBe(false);
  });

  it("setDebugMode(true) 显式打开", () => {
    useDebugStore.getState().setDebugMode(true);
    expect(useDebugStore.getState().debugMode).toBe(true);
  });

  it("setDebugMode(false) 显式关闭已开启的调试模式", () => {
    useDebugStore.getState().setDebugMode(true);
    useDebugStore.getState().setDebugMode(false);
    expect(useDebugStore.getState().debugMode).toBe(false);
  });

  it("setDebugMode 重复传入相同值保持幂等", () => {
    useDebugStore.getState().setDebugMode(true);
    useDebugStore.getState().setDebugMode(true);
    expect(useDebugStore.getState().debugMode).toBe(true);
  });

  it("setDebugMode 与 toggleDebugMode 组合行为正确", () => {
    const s = useDebugStore.getState();
    s.setDebugMode(true);
    useDebugStore.getState().toggleDebugMode();
    expect(useDebugStore.getState().debugMode).toBe(false);
    useDebugStore.getState().toggleDebugMode();
    expect(useDebugStore.getState().debugMode).toBe(true);
  });
});
