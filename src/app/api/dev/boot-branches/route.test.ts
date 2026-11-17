// `/api/dev/boot-branches` 的契约（ISSUE #4257）：回本进程**仍失败**的功能分支；
// 观测类分支与成功的分支不出现；没有失败 = 空数组。

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/shell/boot-branches.server", () => ({
  failedFunctionalBootBranches: vi.fn(),
}));

import { failedFunctionalBootBranches } from "~/lib/shell/boot-branches.server";
import { isRecord } from "~/lib/is-record";
import { GET } from "./route";

const failedMock = vi.mocked(failedFunctionalBootBranches);

afterEach(() => {
  failedMock.mockReset();
});

async function namesOf(res: Response): Promise<unknown[]> {
  const raw: unknown = await res.json();
  if (!isRecord(raw) || !Array.isArray(raw.branches)) {
    throw new Error("响应形状不合法");
  }
  return raw.branches.filter((b): b is Record<string, unknown> => isRecord(b)).map((b) => b.name);
}

describe("GET /api/dev/boot-branches（ISSUE #4257）", () => {
  it("回仍失败的功能分支", async () => {
    failedMock.mockReturnValue([
      { name: "dispatch", ok: false, detail: "派发循环没能启动", at: "2026-11-17T10:00:00.000Z" },
    ]);
    const res = GET();
    expect(res.status).toBe(200);
    expect(await namesOf(res)).toEqual(["dispatch"]);
  });

  it("没有失败 = 空数组（前端据此不发提示）", async () => {
    failedMock.mockReturnValue([]);
    const res = GET();
    expect(await namesOf(res)).toEqual([]);
  });
});
