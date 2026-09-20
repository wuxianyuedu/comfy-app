// @vitest-environment jsdom
// 模型标签库逻辑层单测：整体替换 vanillaApi（请求），断言的是
// props 合并规则与三个写动作的成功/失败路径。

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { vanillaApi } from "~/trpc/vanilla";

import {
  type TagItem,
  mergeTagSnapshots,
  useModelTags,
} from "./use-model-tags";

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    workflowModel: {
      list: { query: vi.fn() },
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      rename: { mutate: vi.fn() },
    },
  },
}));

/** tRPC resolver 的类型是 Resolver<...>，测试里按 vi.Mock 取用。 */
const mockOf = (fn: unknown) => fn as Mock;

const vanilla = {
  workflowModel: {
    list: { query: mockOf(vanillaApi.workflowModel.list.query) },
    create: { mutate: mockOf(vanillaApi.workflowModel.create.mutate) },
    delete: { mutate: mockOf(vanillaApi.workflowModel.delete.mutate) },
    rename: { mutate: mockOf(vanillaApi.workflowModel.rename.mutate) },
  },
};

function tag(name: string, count = 0): TagItem {
  return { id: `id-${name}`, name, count };
}

const SERVER_TAGS = [tag("z-image", 2), tag("wan2.2", 1)];

beforeEach(() => {
  vi.clearAllMocks();
  vanilla.workflowModel.list.query.mockResolvedValue({ tags: SERVER_TAGS });
  vanilla.workflowModel.create.mutate.mockResolvedValue({ tag: tag("new") });
  vanilla.workflowModel.delete.mutate.mockResolvedValue({
    ok: true,
    deleted: true,
  });
  vanilla.workflowModel.rename.mutate.mockResolvedValue({
    tag: tag("renamed"),
  });
});

afterEach(cleanup);

describe("mergeTagSnapshots（纯函数：props 合并规则）", () => {
  it("只补本地没有的标签，不覆盖本地已有的", () => {
    const local = [tag("z-image", 9)];
    expect(
      mergeTagSnapshots(local, [tag("z-image", 2), tag("wan2.2", 1)]),
    ).toEqual([tag("wan2.2", 1), tag("z-image", 9)]);
  });

  it("快照没带来新东西时原样返回（引用不变，避免无谓 re-render）", () => {
    const local = [tag("z-image")];
    expect(mergeTagSnapshots(local, [tag("z-image")])).toBe(local);
  });
});

describe("useModelTags", () => {
  it("首次渲染以父组件快照为种子", () => {
    const { result } = renderHook(() =>
      useModelTags({ initialTags: [tag("z-image", 3)] }),
    );
    expect(result.current.tags).toEqual([tag("z-image", 3)]);
  });

  it("父组件递来含新标签的快照时并入，但不覆盖本地更新的计数", () => {
    const initial = [tag("z-image", 1)];
    const { result, rerender } = renderHook(
      ({ tags }) => useModelTags({ initialTags: tags }),
      { initialProps: { tags: initial } },
    );
    rerender({ tags: [tag("z-image", 99), tag("wan2.2", 1)] });
    // 本地已有 z-image：计数保持 1（不让旧/新快照改掉本地状态）
    expect(result.current.tags.find((t) => t.name === "z-image")?.count).toBe(
      1,
    );
    expect(result.current.tags.some((t) => t.name === "wan2.2")).toBe(true);
  });

  it("父组件每次渲染都递新数组（内容相同）不会死循环", () => {
    // 回归：`initialTags={tags?.data ?? []}` 这种写法每次渲染都是新数组，
    // 按引用比较会每次 setState → React「Too many re-renders」。改为按内容判重。
    const { rerender } = renderHook(
      ({ tags }: { tags: TagItem[] }) => useModelTags({ initialTags: tags }),
      { initialProps: { tags: [tag("z-image")] } },
    );
    for (let i = 0; i < 5; i++) rerender({ tags: [tag("z-image")] });
    expect(vanilla.workflowModel.list.query).not.toHaveBeenCalled();
  });

  it("addTag：成功后清空草稿、刷新列表并回调父组件", async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() =>
      useModelTags({ initialTags: [], onChanged }),
    );
    act(() => result.current.setDraft("  z-image  "));
    await act(async () => {
      await result.current.addTag();
    });
    expect(vanilla.workflowModel.create.mutate).toHaveBeenCalledWith({
      name: "z-image",
    });
    expect(result.current.draft).toBe("");
    await waitFor(() =>
      expect(result.current.tags.map((t) => t.name)).toEqual([
        "z-image",
        "wan2.2",
      ]),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("addTag：草稿为空时是空操作（不发请求）", async () => {
    const { result } = renderHook(() => useModelTags({ initialTags: [] }));
    act(() => result.current.setDraft("   "));
    await act(async () => {
      await result.current.addTag();
    });
    expect(vanilla.workflowModel.create.mutate).not.toHaveBeenCalled();
  });

  it("addTag：后端返回无 tag 时给出可见错误，且不清草稿（用户可改）", async () => {
    vanilla.workflowModel.create.mutate.mockResolvedValue({ tag: null });
    const { result } = renderHook(() => useModelTags({ initialTags: [] }));
    act(() => result.current.setDraft("x"));
    await act(async () => {
      await result.current.addTag();
    });
    expect(result.current.errors.get(null)).toBe("添加失败");
    expect(result.current.draft).toBe("x");
  });

  it("addTag 抛错：错误文案可读（失败路径必须有出口）", async () => {
    vanilla.workflowModel.create.mutate.mockRejectedValue(
      new Error("标签名过长"),
    );
    const { result } = renderHook(() => useModelTags({ initialTags: [] }));
    act(() => result.current.setDraft("x"));
    await act(async () => {
      await result.current.addTag();
    });
    expect(result.current.errors.get(null)).toBe("标签名过长");
    expect(result.current.busy).toBe(false);
  });

  it("deleteTag：未绑定的标签直接删，不弹二次确认", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const { result } = renderHook(() => useModelTags({ initialTags: [] }));
    await act(async () => {
      await result.current.deleteTag("z-image", 0);
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(vanilla.workflowModel.delete.mutate).toHaveBeenCalledWith({
      name: "z-image",
    });
    confirmSpy.mockRestore();
  });

  it("deleteTag：仍绑定工作流时先二次确认，取消即不发请求", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() => useModelTags({ initialTags: [] }));
    await act(async () => {
      await result.current.deleteTag("z-image", 3);
    });
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("已绑定 3 个工作流"),
    );
    expect(vanilla.workflowModel.delete.mutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("renameTag：成功返回 true，并本地立即改名（不等父组件刷新）", async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() =>
      useModelTags({ initialTags: [tag("z-image", 2)], onChanged }),
    );
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.renameTag("z-image", "z-image-turbo");
    });
    expect(ok).toBe(true);
    expect(vanilla.workflowModel.rename.mutate).toHaveBeenCalledWith({
      oldName: "z-image",
      newName: "z-image-turbo",
    });
    expect(onChanged).toHaveBeenCalled();
    // 刷新回包把列表覆盖成服务端形态，断言的是「请求已发出 + 无错误」
    expect(result.current.errors.hasAny).toBe(false);
  });

  it("renameTag：同名/空名视为 no-op 成功，不发请求（避免 404 竞态）", async () => {
    const { result } = renderHook(() => useModelTags({ initialTags: [] }));
    let same: boolean | undefined;
    let empty: boolean | undefined;
    await act(async () => {
      same = await result.current.renameTag("z-image", "  z-image  ");
      empty = await result.current.renameTag("z-image", "   ");
    });
    expect([same, empty]).toEqual([true, true]);
    expect(vanilla.workflowModel.rename.mutate).not.toHaveBeenCalled();
  });

  it("renameTag：后端返回无 tag 时返回 false 并给出错误（调用方据此不关闭编辑器）", async () => {
    vanilla.workflowModel.rename.mutate.mockResolvedValue({ tag: null });
    /* 那条标签必须在列表里 —— 错误挂在**它**身上（规范 16 §16.2.4.33），
     * 条目集合收敛时不在屏幕上的条目不会留住错误。 */
    const { result } = renderHook(() =>
      useModelTags({ initialTags: [tag("a", 1)] }),
    );
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.renameTag("a", "b");
    });
    expect(ok).toBe(false);
    expect(result.current.errors.get("a")).toBe("重命名失败");
  });

  it("refresh 失败保留旧列表（弹窗仍可用，不让用户看到空白）", async () => {
    vanilla.workflowModel.create.mutate.mockResolvedValue({ tag: tag("new") });
    const { result } = renderHook(() =>
      useModelTags({ initialTags: [tag("keep", 1)] }),
    );
    vanilla.workflowModel.list.query.mockRejectedValue(new Error("500"));
    act(() => result.current.setDraft("x"));
    await act(async () => {
      await result.current.addTag();
    });
    expect(result.current.tags).toEqual([tag("keep", 1)]);
  });
});
