// @vitest-environment jsdom
/**
 * 「一棵树的展开 / 收起」状态出口的判据（规范 16 §16.2.4.17）。
 *
 * 这条账的形状是**状态管理没有出口**，不是「重复代码」：`NodesTab` 一棵树用了
 * 三份 `Record<string, boolean>`，三处 `!!map[key]` 读法、三处
 * `setX((prev) => ({ ...prev, [k]: !prev[k] }))` 写法，以及一段**逐字抄两遍**的
 * 「补默认展开」。所以用例重点是这套状态自己欠的语义，而不是「对象怎么合并」：
 *
 *   1. 缺键 = 未表态（`isExpanded` 假），且 **`hasKey` 必须能区分**
 *      「用户手动收起过」与「从没碰过」—— 这是 `in` 与取值两种判据；
 *   2. `seedDefaults` **不覆盖已有表态**（正是那段抄两遍的代码承载的语义）；
 *   3. `seedDefaults` 无变化时返回原引用（它在 effect 里被调，白渲染是可观测的）；
 *   4. 连点两次回到原态（函数式 updater，不吃闭包里的旧值）。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useExpansionSet } from "./expansion-set";

describe("useExpansionSet", () => {
  it("初值为空：任何键都未展开，且未表态", () => {
    const { result } = renderHook(() => useExpansionSet());
    expect(result.current.isExpanded("a")).toBe(false);
    expect(result.current.hasKey("a")).toBe(false);
  });

  it("toggle：未表态 → 展开 → 收起，且每一步都算「表过态」", () => {
    const { result } = renderHook(() => useExpansionSet());
    act(() => result.current.toggle("a"));
    expect(result.current.isExpanded("a")).toBe(true);
    expect(result.current.hasKey("a")).toBe(true);
    act(() => result.current.toggle("a"));
    expect(result.current.isExpanded("a")).toBe(false);
    /* 关键：收起之后「表过态」仍然成立 —— 这正是与缺键的区别。 */
    expect(result.current.hasKey("a")).toBe(true);
  });

  it("连点两次回到原态（不吃闭包里的旧 map）", () => {
    const { result } = renderHook(() => useExpansionSet());
    act(() => {
      result.current.toggle("a");
      result.current.toggle("a");
    });
    expect(result.current.isExpanded("a")).toBe(false);
  });

  it("set 显式设置，不翻转", () => {
    const { result } = renderHook(() => useExpansionSet());
    act(() => result.current.set("a", true));
    act(() => result.current.set("a", true));
    expect(result.current.isExpanded("a")).toBe(true);
  });

  describe("seedDefaults：补默认值，不覆盖已有表态", () => {
    it("未表态的键补成展开", () => {
      const { result } = renderHook(() => useExpansionSet());
      act(() => result.current.seedDefaults(["a", "b"]));
      expect(result.current.isExpanded("a")).toBe(true);
      expect(result.current.isExpanded("b")).toBe(true);
    });

    it("用户手动收起过的键，补默认时不被弹回来", () => {
      /* 这就是那条抄了两遍的代码承载的语义：刷新后用户收起的目录不该自己展开。 */
      const { result } = renderHook(() => useExpansionSet());
      act(() => result.current.set("a", false));
      act(() => result.current.seedDefaults(["a", "b"]));
      expect(result.current.isExpanded("a")).toBe(false);
      expect(result.current.isExpanded("b")).toBe(true);
    });

    it("用户可以要求默认折叠（open=false）", () => {
      const { result } = renderHook(() => useExpansionSet());
      act(() => result.current.seedDefaults(["a"], false));
      expect(result.current.isExpanded("a")).toBe(false);
      expect(result.current.hasKey("a")).toBe(true);
    });

    it("无变化时保持原引用（避免 effect 里的白渲染）", () => {
      const { result } = renderHook(() => useExpansionSet());
      act(() => result.current.seedDefaults(["a"]));
      const first = result.current.map;
      act(() => result.current.seedDefaults(["a"]));
      expect(result.current.map).toBe(first);
    });

    it("确有变化时换新引用（否则订阅者看不到更新）", () => {
      const { result } = renderHook(() => useExpansionSet());
      act(() => result.current.seedDefaults(["a"]));
      const first = result.current.map;
      act(() => result.current.seedDefaults(["a", "b"]));
      expect(result.current.map).not.toBe(first);
    });
  });

  it("replace 整体替换（全展开 / 从持久化恢复）", () => {
    const { result } = renderHook(() => useExpansionSet({ a: true, b: true }));
    act(() => result.current.replace({ c: true }));
    expect(result.current.isExpanded("a")).toBe(false);
    expect(result.current.isExpanded("c")).toBe(true);
    expect(result.current.hasKey("a")).toBe(false);
  });

  it("replace 不改传进来的对象（调用处的字面量不被写脏）", () => {
    const { result } = renderHook(() => useExpansionSet());
    const next = { a: true };
    act(() => result.current.replace(next));
    act(() => result.current.toggle("b"));
    expect(next).toEqual({ a: true });
  });

  it("collapseAll 清空集合（连「表过态」也一起清）", () => {
    const { result } = renderHook(() => useExpansionSet({ a: true, b: true }));
    act(() => result.current.collapseAll());
    expect(result.current.isExpanded("a")).toBe(false);
    expect(result.current.hasKey("a")).toBe(false);
  });

  it("toggle 不改原集合（调用处持有旧引用是安全的）", () => {
    const initial = { a: true };
    const { result } = renderHook(() => useExpansionSet(initial));
    act(() => result.current.toggle("b"));
    expect(initial).toEqual({ a: true });
  });
});
