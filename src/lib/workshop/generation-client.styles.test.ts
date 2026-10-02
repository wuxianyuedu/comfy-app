/**
 * `fetchWorkshopStyles()` 用例 —— 工坊风格卡的取数口。
 *
 * 为什么单独一份：这条口此前发的是 `fetch("/api/skills")`，而仓库里**没有**这个
 * handler（基线迁移时只把 tRPC 那侧带了过来）。后果不是报错而是**常年空态**：
 * 404 → 404 的 HTML → `res.json()` 抛 → 调用点 `catch {}` 吞成「没有技能」，
 * `pnpm test` 与 `pnpm check:all` 一路全绿。所以这几条断言钉的不是「映射对不对」，
 * 而是三件此前没人判的事：
 *   1. 取数走 `skill.list`（与成片工作室同一扇门 ⇒ 内置技能种子只有一份）；
 *   2. 畸形行**丢掉**而不是抛错 —— 抛出去会被调用点吞成空列表，等于把「少一张卡」
 *      升级成「整块面板空白」，而这正是旧代码的失败形态；
 *   3. `null` 与「没有这个字段」在 StyleRef 上都归成 `undefined`（视图按可选字段渲染）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: { skill: { list: { query } } },
}));

import { fetchWorkshopStyles } from "./generation-client";

const row = (over: Record<string, unknown> = {}) => ({
  slug: "pixar-animation",
  name: "皮克斯动画风格",
  icon: "film",
  promptTemplate: "Pixar-style 3D animation",
  negativePrompt: "ugly, blurry",
  defaultParams: { steps: 30, cfg: 7 },
  tags: ["style"],
  ...over,
});

beforeEach(() => {
  query.mockReset();
});

describe("fetchWorkshopStyles —— 取数口与形状收窄", () => {
  it("走 skill.list，并把风格卡要的字段收窄出来", async () => {
    query.mockResolvedValue({ skills: [row()], categories: [] });
    await expect(fetchWorkshopStyles()).resolves.toEqual([
      {
        slug: "pixar-animation",
        name: "皮克斯动画风格",
        icon: "film",
        promptTemplate: "Pixar-style 3D animation",
        negativePrompt: "ugly, blurry",
        defaultParams: { steps: 30, cfg: 7 },
      },
    ]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("库里那行的 null 与缺字段都归成 undefined，图标缺省给 ✨", async () => {
    query.mockResolvedValue({
      skills: [
        row({ negativePrompt: null, defaultParams: null, icon: null }),
        row({ slug: "no-icon", name: "没图标", icon: undefined }),
      ],
    });
    const list = await fetchWorkshopStyles();
    // 逐字比对：`null` 留在形状里也算错（视图按可选字段渲染，`null` 会画出「null」）
    expect(list).toEqual([
      {
        slug: "pixar-animation",
        name: "皮克斯动画风格",
        icon: "✨",
        promptTemplate: "Pixar-style 3D animation",
        negativePrompt: undefined,
        defaultParams: undefined,
      },
      expect.objectContaining({ slug: "no-icon", icon: "✨" }),
    ]);
  });

  it("缺 slug / name / promptTemplate 的行丢掉，剩下的照常出（不是整批抛错）", async () => {
    query.mockResolvedValue({
      skills: [
        row(),
        row({ slug: undefined }),
        row({ name: 42 }),
        row({ promptTemplate: null }),
        row({ slug: "ok-2" }),
      ],
    });
    const list = await fetchWorkshopStyles();
    expect(list.map((s) => s.slug)).toEqual(["pixar-animation", "ok-2"]);
  });

  it("负载形状不对时按「没有技能」处理：非数组、非对象行都不抛错", async () => {
    query.mockResolvedValue({ skills: undefined });
    await expect(fetchWorkshopStyles()).resolves.toEqual([]);
    query.mockResolvedValue({ skills: "不是数组" });
    await expect(fetchWorkshopStyles()).resolves.toEqual([]);
    query.mockResolvedValue({ skills: [null, "字符串行", row({ slug: "x" })] });
    await expect(fetchWorkshopStyles()).resolves.toEqual([
      expect.objectContaining({ slug: "x" }),
    ]);
  });

  it("口坏掉时把错误留给调用点（这里不自己吞成空列表）", async () => {
    query.mockRejectedValue(new Error("未登录"));
    await expect(fetchWorkshopStyles()).rejects.toThrow("未登录");
  });
});
