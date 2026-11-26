// @vitest-environment happy-dom
/**
 * 共享勾选态的行为契约（规范 11 §11.2）：toggle 可来回切、clear 清空、
 * selectAll 按当前可见列表收口、add 不重复——三个库都靠这一份出口。
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useLibrarySelection } from "./use-library-selection";

afterEach(cleanup);

describe("useLibrarySelection", () => {
  it("toggle 同一条两次回到未选，clear 清空全部", () => {
    const { result } = renderHook(() => useLibrarySelection<string>());
    expect(result.current.selected).toEqual([]);

    act(() => {
      result.current.toggle("a");
      result.current.toggle("b");
    });
    expect(result.current.selected).toEqual(["a", "b"]);
    expect(result.current.isSelected("a")).toBe(true);

    act(() => {
      result.current.toggle("a");
    });
    expect(result.current.selected).toEqual(["b"]);

    act(() => {
      result.current.clear();
    });
    expect(result.current.selected).toEqual([]);
  });

  it("selectAll 用传入的可见列表整体替换，add 幂等追加", () => {
    const { result } = renderHook(() => useLibrarySelection<string>(["old"]));
    expect(result.current.selected).toEqual(["old"]);

    act(() => {
      result.current.selectAll(["x", "y"]);
    });
    expect(result.current.selected).toEqual(["x", "y"]);

    act(() => {
      result.current.add("x");
      result.current.add("z");
    });
    expect(result.current.selected).toEqual(["x", "y", "z"]);
  });
});
