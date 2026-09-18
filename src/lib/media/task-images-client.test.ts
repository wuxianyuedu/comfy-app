// 任务产物图片列表的收窄规则单测。Prisma Json 列形状不可信，这里的
// 「缺 id 的图仍要能翻页」「localPath 非字符串的行整条丢弃」是硬规则。

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTaskImages } from "./task-images-client";

const taskDetailQuery = vi.fn();

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    task: {
      detail: {
        query: (...args: unknown[]) => taskDetailQuery(...args) as never,
      },
    },
  },
}));

afterEach(() => {
  taskDetailQuery.mockReset();
});

describe("fetchTaskImages", () => {
  it("按 id / localPath / isCover 收窄", async () => {
    taskDetailQuery.mockResolvedValue({
      images: [{ id: "i-1", localPath: "/outputs/a.png", isCover: true }],
    });
    expect(await fetchTaskImages("t-1")).toEqual([
      { id: "i-1", localPath: "/outputs/a.png", isCover: true },
    ]);
  });

  it("缺 id / isCover 时兜底为空串与 false，而不是整条丢弃", async () => {
    taskDetailQuery.mockResolvedValue({
      images: [{ localPath: "/outputs/b.png" }],
    });
    expect(await fetchTaskImages("t-1")).toEqual([
      { id: "", localPath: "/outputs/b.png", isCover: false },
    ]);
  });

  it("localPath 非字符串的行整条丢弃（渲染不出来也没法回滚）", async () => {
    taskDetailQuery.mockResolvedValue({
      images: [
        { id: "i-1", localPath: "/ok.png" },
        { id: "i-2", localPath: 42 },
        { id: "i-3" },
        null,
      ],
    });
    const out = await fetchTaskImages("t-1");
    expect(out).toHaveLength(1);
    expect(out[0]?.localPath).toBe("/ok.png");
  });

  it("images 缺失 / 为 null → 空数组（调用方按「非多图」处理）", async () => {
    taskDetailQuery.mockResolvedValue({});
    expect(await fetchTaskImages("t-1")).toEqual([]);
    taskDetailQuery.mockResolvedValue({ images: null });
    expect(await fetchTaskImages("t-1")).toEqual([]);
  });

  it("查询失败向外抛（由调用方决定静默还是提示）", async () => {
    taskDetailQuery.mockRejectedValue(new Error("任务不存在"));
    await expect(fetchTaskImages("t-1")).rejects.toThrow("任务不存在");
  });
});
