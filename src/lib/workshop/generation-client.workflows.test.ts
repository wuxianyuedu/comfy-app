/**
 * `fetchWorkshopWorkflows()` 用例 —— 工坊「生成资源」下拉的取数口（ISSUE #4119）。
 *
 * 立案现场：`workflow.list` 的返回形状从裸数组演进为
 * `{ workflows, localPending, localRoots }`（带本地工作流根目录跟踪字段）后，
 * 这里的解析没跟上 ⇒ `Array.isArray(对象)` 恒假 ⇒ 下拉恒空、#4080 的测试模型页
 * 工作流候选同源恒空。这组用例钉：两种形状都认、取 `workflows`；畸形行丢掉；
 * 两者都不是 ⇒ 空列表（与调用点「空态」同一口径，不抛）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: { workflow: { list: { query } } },
}));

import { fetchWorkshopWorkflows } from "./generation-client";

const row = (over: Record<string, unknown> = {}) => ({
  id: "wf-1",
  name: "生图工作流",
  typeCategory: "image",
  ...over,
});

beforeEach(() => {
  query.mockReset();
});

describe("fetchWorkshopWorkflows —— 两种返回形状都认（ISSUE #4119）", () => {
  it("现行对象形状 { workflows, localPending, localRoots } ⇒ 取 workflows 数组", async () => {
    query.mockResolvedValue({ workflows: [row()], localPending: [], localRoots: null });
    const out = await fetchWorkshopWorkflows();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "wf-1", name: "生图工作流", category: "image" });
  });

  it("早期裸数组形状 ⇒ 照常解析（兼容不回退）", async () => {
    query.mockResolvedValue([row({ id: "wf-2", typeCategory: "video" })]);
    const out = await fetchWorkshopWorkflows();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "wf-2", category: "video" });
  });

  it("两者都不是（null / 空对象）⇒ 空列表，不抛", async () => {
    query.mockResolvedValue(null);
    await expect(fetchWorkshopWorkflows()).resolves.toEqual([]);
    query.mockResolvedValue({});
    await expect(fetchWorkshopWorkflows()).resolves.toEqual([]);
  });

  it("畸形行丢掉：缺 id / 缺 name / 非对象行不进候选", async () => {
    query.mockResolvedValue({
      workflows: [
        row(),
        { id: "no-name" },
        { name: "no-id" },
        "不是对象",
        row({ id: "wf-3", name: "视频工作流", typeCategory: "video" }),
      ],
      localPending: [],
      localRoots: null,
    });
    const out = await fetchWorkshopWorkflows();
    expect(out.map((o) => o.id)).toEqual(["wf-1", "wf-3"]);
  });
});
