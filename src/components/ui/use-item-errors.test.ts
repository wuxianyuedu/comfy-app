// @vitest-environment jsdom
/**
 * 「每一条各自挂错误」（规范 16 §16.2.4.33）。
 *
 * 钉住三件事：
 * 1. 错误**属于某一条**，改别处不把它盖掉（这正是收口前那两处的缺陷）；
 * 2. 成功清该条、删掉条目后它的错误随之消失（生命周期收敛）；
 * 3. 「无 key」那档承载整表错误，且不被条目收敛影响。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useItemErrors } from "./use-item-errors";

describe("useItemErrors", () => {
  it("错误挂在各自的那一条上，互不覆盖", () => {
    const { result } = renderHook(() => useItemErrors());
    act(() => result.current.report("a")("err", "「a」添加失败"));
    act(() => result.current.report("b")("err", "「b」删除失败"));
    expect(result.current.get("a")).toBe("「a」添加失败");
    expect(result.current.get("b")).toBe("「b」删除失败");
  });

  it("成功清掉该条，不改动别条", () => {
    const { result } = renderHook(() => useItemErrors());
    act(() => result.current.report("a")("err", "添加失败"));
    act(() => result.current.report("b")("err", "删除失败"));
    act(() => result.current.report("a")("ok", "已添加"));
    expect(result.current.get("a")).toBeNull();
    expect(result.current.get("b")).toBe("删除失败");
  });

  it("成功也清掉整表那档（重试成功后不该留着旧文案）", () => {
    const { result } = renderHook(() => useItemErrors());
    act(() => result.current.report(null)("err", "列表刷新失败"));
    act(() => result.current.report("a")("ok", "已添加"));
    expect(result.current.get(null)).toBeNull();
  });

  it("没有错误的条目返回 null（不是空串）", () => {
    const { result } = renderHook(() => useItemErrors());
    expect(result.current.get("nope")).toBeNull();
    expect(result.current.hasAny).toBe(false);
  });

  it("条目被删掉后，它挂着的错误随之消失", () => {
    const { result, rerender } = renderHook(({ keys }) => useItemErrors(keys), {
      initialProps: { keys: ["a", "b"] as readonly string[] | undefined },
    });
    act(() => result.current.report("a")("err", "「a」失败了"));
    expect(result.current.get("a")).toBe("「a」失败了");
    rerender({ keys: ["b"] });
    expect(result.current.get("a")).toBeNull();
  });

  it("key 集合按内容收敛，引用变化不触发多余的 setState", () => {
    /* 调用处几乎都是 `tags.map(t => t.id)` —— 每次渲染都是新数组。
     * 按引用比较会每次都重建错误表，从而让「上一次的错误闪一下」。 */
    const { result, rerender } = renderHook(({ keys }) => useItemErrors(keys), {
      initialProps: { keys: ["a"] as readonly string[] | undefined },
    });
    act(() => result.current.report("a")("err", "失败了"));
    const before = result.current;
    rerender({ keys: ["a"] });
    expect(result.current.get("a")).toBe("失败了");
    expect(result.current).toBe(before);
  });

  it("无 key 那档不受条目收敛影响（它管的是整块）", () => {
    const { result, rerender } = renderHook(({ keys }) => useItemErrors(keys), {
      initialProps: { keys: ["a"] as readonly string[] | undefined },
    });
    act(() => result.current.report(null)("err", "读取列表失败"));
    rerender({ keys: [] });
    expect(result.current.get(null)).toBe("读取列表失败");
  });

  it("不传 keys 时（条目集合不固定）不做收敛", () => {
    const { result } = renderHook(() => useItemErrors(undefined));
    act(() => result.current.report("draft")("err", "新增失败"));
    expect(result.current.get("draft")).toBe("新增失败");
  });

  it("clear / clearAll 各自只清该清的", () => {
    const { result } = renderHook(() => useItemErrors());
    act(() => result.current.report("a")("err", "A"));
    act(() => result.current.report("b")("err", "B"));
    act(() => result.current.clear("a"));
    expect(result.current.get("a")).toBeNull();
    expect(result.current.get("b")).toBe("B");
    act(() => result.current.clearAll());
    expect(result.current.hasAny).toBe(false);
  });

  it("清一条本来就没错误的条目不改变引用（避免级联渲染）", () => {
    const { result } = renderHook(() => useItemErrors());
    const before = result.current;
    act(() => result.current.clear("nope"));
    expect(result.current).toBe(before);
  });
});
