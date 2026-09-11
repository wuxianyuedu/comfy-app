// @vitest-environment jsdom
// DynamicWorkflowForm 逻辑层行为测试（ISSUE #319 的「先补护栏」步骤）。
//
// 这个表单是工作流库运行与画布生成共用的入口，改坏了影响面大，但 261 行的
// hook 此前没有任何行为测试——「数值参数在运行态并入端口行 / 作者态独立成
// 参数行」「多模式下隐藏行只是不显示、值仍留在 payload 里」「拖拽状态是
// 组件本地的」这些规则全靠人读代码。
//
// 本文件只测逻辑层（renderHook），视图由 sections/*.test.tsx 承担。
// 用例名直接写出「什么场景 → 什么派生结果」。

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/project-canvas/canvas-api", () => ({
  uploadImageFile: vi.fn(),
}));

import { uploadImageFile } from "@/lib/project-canvas/canvas-api";
import type { WorkflowIOEntry, WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import type { DynamicWorkflowFormProps } from "../dynamic-workflow-form-config";

import { useDynamicWorkflowForm } from "./use-dynamic-workflow-form";

/** Widget pin（默认 kind=widget）。 */
function widget(
  name: string,
  over: Partial<WorkflowIOEntry> = {},
): WorkflowIOEntry {
  return {
    direction: "input",
    kind: "widget",
    nodeId: "1",
    name,
    label: name,
    ...over,
  };
}

/** 连线端口（kind=param）。 */
function wire(name: string, over: Partial<WorkflowIOEntry> = {}): WorkflowIOEntry {
  return {
    direction: "input",
    kind: "param",
    nodeId: "2",
    name,
    label: name,
    ...over,
  };
}

function output(name: string): WorkflowIOEntry {
  return { direction: "output", kind: "param", nodeId: "9", name, label: name };
}

function ioMap(...entries: WorkflowIOEntry[]): WorkflowIOMap {
  const map: WorkflowIOMap = {};
  for (const e of entries) {
    map[`${e.nodeId}::${e.kind}::${e.name}`] = e;
  }
  return map;
}

function baseProps(
  over: Partial<DynamicWorkflowFormProps> = {},
): DynamicWorkflowFormProps {
  return {
    io: null,
    values: {},
    onChange: vi.fn(),
    ...over,
  };
}

afterEach(cleanup);

describe("useDynamicWorkflowForm — IO 切分与空态", () => {
  it("没有 IO 时 isEmpty=true（视图据此渲染空态提示而不是空表单）", () => {
    const { result } = renderHook(() => useDynamicWorkflowForm(baseProps()));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.inputs).toEqual([]);
  });

  it("只有输出、没有输入时不算空（输出条仍有内容可显示）", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({ io: ioMap(output("image")), showOutputs: true }),
      ),
    );
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.outputs).toHaveLength(1);
  });

  it("连线端口进 wireInputs、widget 进 widgetInputs，互不混装", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({ io: ioMap(wire("image"), widget("prompt")) }),
      ),
    );
    expect(result.current.wireInputs.map((e) => e.name)).toEqual(["image"]);
    expect(result.current.widgetInputs.map((e) => e.name)).toEqual(["prompt"]);
  });

  it("每个条目都带上 ioKey（视图与 set 用它定位字段）", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ io: ioMap(widget("steps")) })),
    );
    const entry = result.current.inputs[0]!;
    expect(entry.ioKey).toBe("1::widget::steps");
  });
});

describe("useDynamicWorkflowForm — 数值参数的行归属（运行态 vs 作者态）", () => {
  const numeric = { type: "INT" as const };

  it("运行态：数值 widget（steps 等）并入端口行，继承可连线的单行版式", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({ io: ioMap(wire("image"), widget("steps", numeric)) }),
      ),
    );
    expect(result.current.portEntries.map((e) => e.name)).toEqual([
      "image",
      "steps",
    ]);
    expect(result.current.widgetSectionEntries).toEqual([]);
  });

  it("运行态：非数值 widget（prompt 等）进参数行，不进端口行", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({ io: ioMap(widget("prompt", { type: "STRING" }), widget("steps", numeric)) }),
      ),
    );
    expect(result.current.widgetSectionEntries.map((e) => e.name)).toEqual([
      "prompt",
    ]);
    expect(result.current.portEntries.map((e) => e.name)).toEqual(["steps"]);
  });

  it("作者态（给了编辑回调）：数值 widget 改由参数行渲染，否则必填/👁 无从编辑", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({
          io: ioMap(wire("image"), widget("steps", numeric)),
          onRequiredChange: vi.fn(),
        }),
      ),
    );
    // 这是后端对齐历史根因的回归用例：数值行若仍被压成端口行版式，
    // 那套版式从不渲染必填/👁，作者永远碰不到（seed 挤没的来源）。
    expect(result.current.portEntries.map((e) => e.name)).toEqual(["image"]);
    expect(result.current.widgetSectionEntries.map((e) => e.name)).toEqual([
      "steps",
    ]);
  });

  it("作者态由 onReorder 触发同样成立（不止必填回调）", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({
          io: ioMap(widget("seed", numeric)),
          onReorder: vi.fn(),
        }),
      ),
    );
    expect(result.current.widgetSectionEntries.map((e) => e.name)).toEqual([
      "seed",
    ]);
  });
});

describe("useDynamicWorkflowForm — 多模式可见性过滤", () => {
  const hiddenInTxt2img: WorkflowIOEntry = widget("denoise", {
    type: "FLOAT",
    modes: { txt2img: { visible: false } },
  });

  it("当前模式下 visible=false 的行不显示（展示层过滤）", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({ io: ioMap(hiddenInTxt2img), mode: "txt2img" }),
      ),
    );
    expect(result.current.inputs).toEqual([]);
  });

  it("隐藏行只是不显示 —— 调用方 values 里的值不受影响（不擅自删除）", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({
          io: ioMap(hiddenInTxt2img),
          mode: "txt2img",
          values: { "1::widget::denoise": 0.5 },
        }),
      ),
    );
    // controller 透传 values，不因过滤而摘键 —— 否则提交的 payload 会缺字段
    expect(result.current.values).toEqual({ "1::widget::denoise": 0.5 });
    expect(result.current.inputs).toEqual([]);
  });

  it("切到其它模式时该行重新可见", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({ io: ioMap(hiddenInTxt2img), mode: "img2img" }),
      ),
    );
    expect(result.current.inputs.map((e) => e.name)).toEqual(["denoise"]);
  });

  it("showHiddenInMode（IO 编辑预览）不过滤：隐藏行置灰呈现，作者才能用 👁 改回来", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({
          io: ioMap(hiddenInTxt2img),
          mode: "txt2img",
          showHiddenInMode: true,
        }),
      ),
    );
    expect(result.current.inputs.map((e) => e.name)).toEqual(["denoise"]);
  });

  it("无模式（mode 为空）时行不受可见性影响", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ io: ioMap(hiddenInTxt2img) })),
    );
    expect(result.current.inputs.map((e) => e.name)).toEqual(["denoise"]);
  });
});

describe("useDynamicWorkflowForm — set 与 values 的不可变更新", () => {
  it("set 产生新对象（不原地改 values），并只改目标键", () => {
    const values = { a: 1, b: 2 };
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ values, onChange })),
    );

    act(() => result.current.set("b", 99));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as Record<string, unknown>;
    expect(next).toEqual({ a: 1, b: 99 });
    expect(next).not.toBe(values); // 不可变：调用方靠引用变化触发重渲染
    expect(values).toEqual({ a: 1, b: 2 }); // 原对象未被改
  });

  it("onChange 是调用方持有的：controller 透传同一个引用", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onChange })),
    );
    expect(result.current.onChange).toBe(onChange);
  });
});

describe("useDynamicWorkflowForm — 拖拽重排", () => {
  it("未传 onReorder 时 dragHandlers 为 null（只读表单不可拖）", () => {
    const { result } = renderHook(() => useDynamicWorkflowForm(baseProps()));
    expect(result.current.dragHandlers).toBeNull();
  });

  it("传了 onReorder 才给出拖拽手势", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onReorder: vi.fn() })),
    );
    expect(result.current.dragHandlers).not.toBeNull();
  });

  it("拿起一行后 draggingKey/dragOverKey 同步置位，endDrag 清空", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onReorder: vi.fn() })),
    );

    act(() => result.current.beginPortDrag("k1"));
    expect(result.current.draggingKey).toBe("k1");
    expect(result.current.dragOverKey).toBe("k1");

    act(() => result.current.endDrag());
    expect(result.current.draggingKey).toBeNull();
    expect(result.current.dragOverKey).toBeNull();
  });

  it("drop 到另一行：回调onReorder(fromKey, beforeKey) 并清掉高亮", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onReorder })),
    );

    act(() => result.current.dragHandlers!.onDragStart("from")({
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    } as never));
    act(() =>
      result.current.dragHandlers!.onDrop("to")({
        preventDefault: vi.fn(),
        dataTransfer: {},
      } as never),
    );

    expect(onReorder).toHaveBeenCalledWith("from", "to");
    // 拖完必须清高亮，否则会留下一道假的插入线
    expect(result.current.draggingKey).toBeNull();
    expect(result.current.dragOverKey).toBeNull();
  });

  it("drop 到自己身上不触发重排（避免无意义的顺序写入）", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onReorder })),
    );

    act(() => result.current.beginPortDrag("same"));
    act(() =>
      result.current.dragHandlers!.onDrop("same")({
        preventDefault: vi.fn(),
        dataTransfer: {},
      } as never),
    );

    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.draggingKey).toBeNull();
  });

  it("拖拽高亮不覆盖同一行：拖到自己时 dragOverKey 不变", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onReorder: vi.fn() })),
    );

    act(() => result.current.beginPortDrag("k1"));
    act(() =>
      result.current.dragHandlers!.onDragOver("k1")({
        preventDefault: vi.fn(),
        dataTransfer: {},
      } as never),
    );
    expect(result.current.dragOverKey).toBe("k1");

    act(() =>
      result.current.dragHandlers!.onDragOver("k2")({
        preventDefault: vi.fn(),
        dataTransfer: { dropEffect: "" },
      } as never),
    );
    expect(result.current.dragOverKey).toBe("k2");
  });

  it("数据流里的 setData 被调用（Firefox 不调用就不启动拖拽）", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onReorder: vi.fn() })),
    );
    const setData = vi.fn();
    act(() =>
      result.current.dragHandlers!.onDragStart("k1")({
        dataTransfer: { setData, effectAllowed: "" },
      } as never),
    );
    expect(setData).toHaveBeenCalledWith("text/plain", "k1");
  });
});

describe("useDynamicWorkflowForm — 图片上传", () => {
  it("pickFile 记住上传目标并点开文件选择框", () => {
    const { result } = renderHook(() => useDynamicWorkflowForm(baseProps()));
    const click = vi.fn();
    // fileRef 指向真实 <input>，测试里直接打桩 click
    Object.defineProperty(result.current.fileRef, "current", {
      value: { click },
      writable: true,
    });

    act(() => result.current.pickFile("img-key"));

    expect(result.current.uploadTarget).toBe("img-key");
    expect(click).toHaveBeenCalled();
  });

  it("上传成功：把返回的文件名写进该字段的值表", async () => {
    const onChange = vi.fn();
    vi.mocked(uploadImageFile).mockResolvedValue("uploaded.png");
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onChange })),
    );

    act(() => result.current.pickFile("img-key"));
    await act(async () => {
      await result.current.onFile({
        target: { files: [new File(["x"], "a.png")], value: "" },
      } as never);
    });

    expect(onChange).toHaveBeenCalledWith({ "img-key": "uploaded.png" });
    expect(result.current.uploading).toBe(false);
    expect(result.current.uploadTarget).toBeNull();
  });

  it("上传失败：不写值、不抛异常，且 uploading 归位（不卡在上传中）", async () => {
    const onChange = vi.fn();
    vi.mocked(uploadImageFile).mockRejectedValue(new Error("boom"));
    // 上传失败路径会把错误打给 console（LogProvider 会收进日志面板），
    // 测试里静音避免污染输出。用返回 undefined 的箭头函数而非空函数体，
    // 保持与其余 mock 写法一致。
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onChange })),
    );

    act(() => result.current.pickFile("img-key"));
    await act(async () => {
      await result.current.onFile({
        target: { files: [new File(["x"], "a.png")], value: "" },
      } as never);
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.uploading).toBe(false);
    expect(result.current.uploadTarget).toBeNull();
    /* 失败必须留一个用户可见出口：controller 暴露 uploadError，视图据此
     * 渲染提示条（此前失败只进 console，上传位毫无反馈 — ISSUE #345）。 */
    expect(result.current.uploadError).toBe("boom");
    consoleErr.mockRestore();
  });

  it("上传失败：原因同时上抛给调用方（画布节点/库节点各自渲染提示条）", async () => {
    vi.mocked(uploadImageFile).mockRejectedValue(new Error("ComfyUI 启动超时"));
    const onUploadError = vi.fn();
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onUploadError })),
    );

    act(() => result.current.pickFile("img-key"));
    await act(async () => {
      await result.current.onFile({
        target: { files: [new File(["x"], "a.png")], value: "" },
      } as never);
    });

    expect(onUploadError).toHaveBeenCalledWith("ComfyUI 启动超时");
    consoleErr.mockRestore();
  });

  it("等待 ComfyUI 启动：进行态上抛给调用方，不静默等待", async () => {
    vi.mocked(uploadImageFile).mockImplementation(async (_file, opts) => {
      opts?.onProgress?.("正在启动 ComfyUI…");
      return "ok.png";
    });
    const onUploadProgress = vi.fn();
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onUploadProgress })),
    );

    act(() => result.current.pickFile("img-key"));
    await act(async () => {
      await result.current.onFile({
        target: { files: [new File(["x"], "a.png")], value: "" },
      } as never);
    });

    expect(onUploadProgress).toHaveBeenCalledWith("正在启动 ComfyUI…");
    expect(result.current.uploadError).toBeNull();
  });

  it("没有上传目标时 onFile 是 no-op（不会把文件写到错误的字段）", async () => {
    const onChange = vi.fn();
    vi.mocked(uploadImageFile).mockClear();
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(baseProps({ onChange })),
    );

    await act(async () => {
      await result.current.onFile({
        target: { files: [new File(["x"], "a.png")], value: "" },
      } as never);
    });

    // 先选文件才可能上传：没有 uploadTarget 时不该调上传接口、也不该写值
    expect(uploadImageFile).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("useDynamicWorkflowForm — 组合控件（dimension / video）不重复渲染", () => {
  it("成对的 width/height 进 groupedKeys，不在端口行里重复出现", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({
          io: ioMap(
            widget("width", { type: "INT", defaultValue: 1024 }),
            widget("height", { type: "INT", defaultValue: 1024 }),
          ),
        }),
      ),
    );
    expect(result.current.groups.groupedKeys.size).toBe(2);
    // 端口行里不应该再出现被组合消费的两个键
    const names = result.current.portEntries.map((e) => e.name);
    expect(names).not.toContain("width");
    expect(names).not.toContain("height");
  });
});

describe("IO 默认值刷新链路（ISSUE #288 的同源规则）", () => {
  /* #288 的规则是：编辑 IO 后默认值变化 → 未覆盖字段刷新、已覆盖字段保持。
   * 纯函数 mergeRefreshedDefaults 已由 workflow-io.test.ts 覆盖；这里补一层
   * 「与表单的值表对接」的契约——默认值是从 io 条目读出来的，改坏这条取值
   * 会让刷新永远拿到 undefined。 */

  it("默认值从 io 条目的 defaultValue 读出（表单播种与刷新的取值口径一致）", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({
          io: ioMap(
            widget("steps", { type: "INT", defaultValue: 25 }),
            widget("prompt", { type: "STRING", defaultValue: "一只猫" }),
          ),
        }),
      ),
    );

    const byName = new Map(result.current.inputs.map((e) => [e.name, e]));
    expect(byName.get("steps")?.defaultValue).toBe(25);
    expect(byName.get("prompt")?.defaultValue).toBe("一只猫");
  });

  it("未覆盖字段的值为空时，视图回落到 defaultValue 渲染（steps 不会显示成空白）", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({
          io: ioMap(widget("steps", { type: "INT", defaultValue: 25 })),
          values: {},
        }),
      ),
    );

    const steps = result.current.inputs[0]!;
    // values 里没有该键 → 调用方（视图）应取 defaultValue；controller 保证
    // defaultValue 在条目上可读
    expect(result.current.values["1::widget::steps"]).toBeUndefined();
    expect(steps.defaultValue).toBe(25);
  });

  it("已覆盖字段：values 里的用户值优先，不被 defaultValue 顶掉", () => {
    const { result } = renderHook(() =>
      useDynamicWorkflowForm(
        baseProps({
          io: ioMap(widget("steps", { type: "INT", defaultValue: 25 })),
          values: { "1::widget::steps": 8 },
        }),
      ),
    );
    expect(result.current.values["1::widget::steps"]).toBe(8);
    expect(result.current.inputs[0]?.defaultValue).toBe(25);
  });
});
