// @vitest-environment jsdom
/**
 * 「实际使用」弹窗的字段行编辑器（规范 16 §16.2.4.47）。
 *
 * 这里的用例只钉一件事：**每一行的 `id` 在增删之间保持不变**。
 *
 * 背景：视图此前拿 `usageTest.fields.indexOf(f)` 算出来的下标当 React 的
 * `key`。删中间一行会让后面所有行的下标整体左移，React 于是复用错误的 DOM
 * 节点 —— 用户在某行刚输入的内容会「闪到隔壁字段」。这类缺陷**只在删中间行
 * 时显形**，而输入框的值受控（`value={f.value}`），所以单看渲染结果看不出来。
 *
 * 因此判据落在**数据**上：删一行之后，其余行的 `id` 必须与删除前**逐个相等**。
 */
import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createUsageFieldEditor } from "./usage-field-editor";
import { makeUsageField, type UsageField } from "~/lib/llm/usage-test-config";

interface State {
  kind: "chat" | "image" | "video";
  fields: UsageField[];
}

function useEditor(initial: State) {
  const [state, setState] = useState<State | null>(initial);
  const editor = createUsageFieldEditor<State>(setState);
  return { state: state!, editor };
}

describe("字段行的稳定 id", () => {
  it("新增的每一行都带 id（缺了它视图就退回「下标当 key」）", () => {
    const { result } = renderHook(() =>
      useEditor({ kind: "chat", fields: [] }),
    );
    act(() => result.current.editor.addField("seed"));
    act(() => result.current.editor.addPresetField("duration"));
    const ids = result.current.state.fields.map((f) => f.id);
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => Boolean(id))).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it("删中间一行后，其余行的 id 逐个不变（下标会左移，id 不会）", () => {
    const { result } = renderHook(() =>
      useEditor({
        kind: "chat",
        fields: [
          makeUsageField("a", "1"),
          makeUsageField("b", "2"),
          makeUsageField("c", "3"),
        ],
      }),
    );
    const before = result.current.state.fields.map((f) => f.id);
    act(() => result.current.editor.removeField(1));
    const after = result.current.state.fields;
    expect(after.map((f) => f.key)).toEqual(["a", "c"]);
    /* 关键断言：a 与 c 仍是**原来那两条**（id 逐字相同）。 */
    expect(after[0]!.id).toBe(before[0]);
    expect(after[1]!.id).toBe(before[2]);
  });

  it("改某一行的值时 id 不变（patch 是就地改，不是重建一行）", () => {
    const { result } = renderHook(() =>
      useEditor({ kind: "chat", fields: [makeUsageField("seed", "1")] }),
    );
    const before = result.current.state.fields[0]!.id;
    act(() => result.current.editor.patchField(0, { value: "42" }));
    expect(result.current.state.fields[0]!.id).toBe(before);
    expect(result.current.state.fields[0]!.value).toBe("42");
  });

  it("视频预填的 mode 行也带 id", () => {
    const { result } = renderHook(() =>
      useEditor({ kind: "video", fields: [] }),
    );
    act(() => result.current.editor.setVideoMode("keyframe"));
    const [row] = result.current.state.fields;
    expect(row).toMatchObject({ key: "mode", value: "keyframe" });
    expect(row!.id).toBeTruthy();
  });

  it("mode 行的图片自愈搬移后同样是带 id 的新行", () => {
    const { result } = renderHook(() =>
      useEditor({
        kind: "video",
        fields: [makeUsageField("mode", "https://a.example/x.png")],
      }),
    );
    const modeId = result.current.state.fields[0]!.id;
    act(() =>
      result.current.editor.rescueMediaFromMode(0, "https://a.example/x.png"),
    );
    const fields = result.current.state.fields;
    const images = fields.find((f) => f.key === "images");
    expect(images?.value).toBe("https://a.example/x.png");
    expect(images?.id).toBeTruthy();
    expect(images?.id).not.toBe(modeId);
  });
});
