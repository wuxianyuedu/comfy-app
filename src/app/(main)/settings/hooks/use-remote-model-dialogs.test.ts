// @vitest-environment jsdom
/**
 * 「添加 / 编辑模型」弹窗的**字段级校验出口**（规范 16 §16.2.4.8）。
 *
 * 只钉一件事：字段级规则不过时，视图能从 controller 拿到**逐字段**的错误，
 * 而不是一条无差别的横幅 —— 这正是接 `ui/form` 那次设计决定落地后
 * 「校验规则归谁持有」那个问题的可观测后果。
 * 网络侧动作（addRemoteModel / updateRemoteModel）由假 controller 顶替。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ReadySettingsPageController } from "./use-settings-page";
import { useRemoteModelDialogs } from "./use-remote-model-dialogs";

/** 只补本文件用得到的那几个字段，其余以类型断言绕过（接口很大，且与本案无关）。 */
function makeController(over: Record<string, unknown> = {}) {
  return {
    saving: false,
    addRemoteModel: vi.fn(async () => ({ ok: true })),
    updateRemoteModel: vi.fn(async () => ({ ok: true })),
    ...over,
  } as unknown as ReadySettingsPageController;
}

function setup(over: Record<string, unknown> = {}) {
  return renderHook(() => useRemoteModelDialogs(makeController(over)));
}

const formDefaults = {
  baseUrl: "",
  apiKey: "",
  model: "",
  kind: "chat",
} as const;

describe("useRemoteModelDialogs —— 字段级校验出口", () => {
  it("名称为空时提交：不出网络请求，错误挂在 model 字段上", async () => {
    const addRemoteModel = vi.fn(async () => ({ ok: true }));
    const { result } = setup({ addRemoteModel });

    act(() => result.current.openAddDialog());
    await act(async () => {
      await result.current.submitDialog();
    });

    expect(addRemoteModel).not.toHaveBeenCalled();
    expect(result.current.fieldErrors.model).toBe("请填写模型名称");
    expect(result.current.addError).toBeNull();
  });

  it("名称只填空格同样拦下（trim 后判定）", async () => {
    const addRemoteModel = vi.fn(async () => ({ ok: true }));
    const { result } = setup({ addRemoteModel });

    act(() => result.current.openAddDialog());
    act(() => result.current.setAddForm({ ...formDefaults, model: "   " }));
    await act(async () => {
      await result.current.submitDialog();
    });

    expect(addRemoteModel).not.toHaveBeenCalled();
    expect(result.current.fieldErrors.model).toBeTruthy();
  });

  it("填了名称即放行到网络层，且字段错误被清空", async () => {
    const addRemoteModel = vi.fn(async () => ({ ok: true }));
    const { result } = setup({ addRemoteModel });

    act(() => result.current.openAddDialog());
    act(() => result.current.setAddForm({ ...formDefaults, model: "gpt-4o" }));
    await act(async () => {
      await result.current.submitDialog();
    });

    expect(addRemoteModel).toHaveBeenCalledTimes(1);
    expect(result.current.fieldErrors).toEqual({});
  });

  it("集合级「重名」错位到 model 字段，而不是只给横幅", async () => {
    const addRemoteModel = vi.fn(async () => ({
      ok: false,
      error: "模型「gpt-4o」已在列表中",
    }));
    const { result } = setup({ addRemoteModel });

    act(() => result.current.openAddDialog());
    act(() => result.current.setAddForm({ ...formDefaults, model: "gpt-4o" }));
    await act(async () => {
      await result.current.submitDialog();
    });

    expect(result.current.fieldErrors.model).toContain("已在列表中");
    expect(result.current.addError).toBeNull();
  });

  it("没有对应字段的集合级失败仍走横幅（不硬塞给某个输入框）", async () => {
    const addRemoteModel = vi.fn(async () => ({
      ok: false,
      error: "配置未就绪，请稍后重试",
    }));
    const { result } = setup({ addRemoteModel });

    act(() => result.current.openAddDialog());
    act(() => result.current.setAddForm({ ...formDefaults, model: "gpt-4o" }));
    await act(async () => {
      await result.current.submitDialog();
    });

    expect(result.current.addError).toBe("配置未就绪，请稍后重试");
    expect(result.current.fieldErrors).toEqual({});
  });

  it("重开弹窗会清掉上一次的字段错误（不跨次残留）", async () => {
    const { result } = setup();

    act(() => result.current.openAddDialog());
    await act(async () => {
      await result.current.submitDialog();
    });
    expect(result.current.fieldErrors.model).toBeTruthy();

    act(() => result.current.openAddDialog());
    expect(result.current.fieldErrors).toEqual({});
  });
});
