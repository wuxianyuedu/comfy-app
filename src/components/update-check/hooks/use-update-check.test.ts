// @vitest-environment happy-dom
/** E8：`checkNow` 在「干净→脏」上升沿把同一份派生结果交给 applyResult 与 onDirty。
 * 钉的是行为：回调拿到的是过滤后的脏分组，且与 store 里落下的那份是同一份对象
 * （派生只做一次，而不是两遍 filter+map+展开）；干净时不触发回调。 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchUpdateCheck } from "~/lib/update-check-client";
import type { UpdateCheckHookOptions } from "./use-update-check";
import { useUpdateCheckStore } from "../update-check-store";
import { useUpdateCheck } from "./use-update-check";

vi.mock("~/lib/update-check-client", () => ({ fetchUpdateCheck: vi.fn() }));
vi.mock("~/components/ui/use-interval", () => ({ useInterval: () => undefined }));

const fetchMock = vi.mocked(fetchUpdateCheck);

function payload(dirty: boolean) {
  return {
    ok: true,
    armed: true,
    dirty,
    groups: [
      { dirty, files: ["a.ts"], hint: "h", key: "restart" as const, label: "重启" },
      { dirty: false, files: ["b.ts"], hint: "h2", key: "recompile" as const, label: "重编" },
    ],
  };
}

beforeEach(() => {
  useUpdateCheckStore.setState({ dirty: false, groups: [], enabled: true, checking: false });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("useUpdateCheck 的脏分组派生", () => {
  it("干净→脏：onDirty 拿到的分组与 store 落下的同源，且已滤掉干净组", async () => {
    fetchMock.mockResolvedValue(payload(true));
    const onDirty = vi.fn<NonNullable<UpdateCheckHookOptions["onDirty"]>>();
    const { result } = renderHook(() => useUpdateCheck({ onDirty }));

    await act(async () => {
      expect(await result.current.checkNow()).toBe(true);
    });

    expect(onDirty).toHaveBeenCalledTimes(1);
    const passed = onDirty.mock.calls[0]?.[0];
    expect(passed).toHaveLength(1);
    expect(passed?.[0]?.label).toBe("重启");
    expect(useUpdateCheckStore.getState().groups).toBe(passed);
  });

  it("干净时不触发回调；从脏回落干净再变脏会重新触发", async () => {
    fetchMock.mockResolvedValueOnce(payload(false)).mockResolvedValueOnce(payload(true));
    const onDirty = vi.fn<NonNullable<UpdateCheckHookOptions["onDirty"]>>();
    const { result } = renderHook(() => useUpdateCheck({ onDirty }));

    await act(async () => {
      await result.current.checkNow();
    });
    expect(onDirty).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.checkNow();
    });
    expect(onDirty).toHaveBeenCalledTimes(1);
  });
});
