/**
 * 「草稿里读不懂的元素」那条横幅（台账 F13″的界面出口那一半）。
 *
 * 判据本体已有 27 条用例（`draft-integrity.test.ts`），这里只判**它有没有真的到用户眼前**：
 *   · 有问题必须看得见「是哪几条、坏在哪」——只报「有脏数据」等于没报（用户面对 20 张
 *     卡片猜不出是哪一张，最后当成界面在瞎忙）；
 *   · 没问题必须一个字都不渲染（常驻噪音会让真提示失去可信度）；
 *   · 「去看看」要跳到**那一类**元素真正在的那一屏（跳错了等于给了个假出口）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { auditDraftElements } from "~/lib/workshop/draft-integrity";

import { DraftIntegrityHint } from "./DraftIntegrityHint";

const CLEAN_CHARACTER = {
  id: "c1",
  name: "小美",
  styleTags: ["皮克斯"],
  params: {},
};
const CLEAN_SHOT = {
  id: "sh1",
  index: 1,
  sceneId: "s1",
  characterIds: ["c1"],
  prompt: "p",
  status: "idle",
};

function issuesOf(
  over: Partial<Parameters<typeof auditDraftElements>[0]> = {},
) {
  return auditDraftElements({
    scenes: [],
    characters: [],
    shots: [],
    ...over,
  });
}

afterEach(() => {
  cleanup();
});

describe("DraftIntegrityHint", () => {
  it("干净的草稿：一个字都不渲染", () => {
    const { container } = render(
      <DraftIntegrityHint
        issues={issuesOf({
          characters: [CLEAN_CHARACTER],
          shots: [CLEAN_SHOT],
        })}
        onGoTo={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("脏元素：汇总句 + 「是哪一条」+「坏在哪」三件都在", () => {
    render(
      <DraftIntegrityHint
        issues={issuesOf({
          characters: [{ id: "c2", name: "老张", styleTags: "厚涂" }],
        })}
        onGoTo={vi.fn()}
      />,
    );
    expect(screen.getByText(/已原样保留但需要修复/)).toBeTruthy();
    // 元素定位：`角色 #1「c2」`
    expect(screen.getByText("角色 #1「c2」")).toBeTruthy();
    // 要紧之处：不是只说「形状不对」，而是说清会不会炸
    expect(screen.getByText(/\.join/)).toBeTruthy();
  });

  it("同一条元素坏两个字段 → 只占一行，原因并列（两个字段是两条就长得像两条数据）", () => {
    render(
      <DraftIntegrityHint
        issues={issuesOf({
          shots: [{ ...CLEAN_SHOT, id: "", prompt: null }],
        })}
        onGoTo={vi.fn()}
      />,
    );
    const lines = screen.getAllByText("镜头 #1");
    expect(lines).toHaveLength(1);
    // 两个原因并排在同一行里（label 与原因分属两个 span，所以只匹配原因那一段）
    expect(screen.getByText(/缺 id：.*；.*提示词不是文本/)).toBeTruthy();
  });

  it("「去看看」跳到那一类元素在的那一屏", () => {
    const onGoTo = vi.fn();
    render(
      <DraftIntegrityHint
        issues={issuesOf({
          characters: [{ id: "c3", name: "小雅", styleTags: 1 }],
        })}
        onGoTo={onGoTo}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /去看看/ }));
    expect(onGoTo).toHaveBeenCalledTimes(1);
    expect(onGoTo.mock.calls[0]?.[0]).toBe("character");
  });

  it("场景那一类落到「剧本」屏，镜头那一类落到「场景分镜」屏", () => {
    const onGoTo = vi.fn();
    render(
      <DraftIntegrityHint
        issues={issuesOf({
          scenes: [{ heading: "x", shotCount: 1 }],
          shots: [{ ...CLEAN_SHOT, id: "" }],
        })}
        onGoTo={onGoTo}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /去看看/ }));
    // 清单第一条是场景 → 跳剧本屏（不是按种类固定跳某一屏）
    expect(onGoTo.mock.calls[0]?.[0]).toBe("script");
  });

  it("超过上限就折行：只列前 5 条，剩下的报数量而不是继续堆", () => {
    const dirtyCharacters = Array.from({ length: 8 }, (_unused, i) => ({
      id: `c${String(i)}`,
      name: `角色${String(i)}`,
      styleTags: 1,
    }));
    render(
      <DraftIntegrityHint
        issues={issuesOf({ characters: dirtyCharacters })}
        onGoTo={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText(/另有 3 条同类问题/)).toBeTruthy();
    expect(screen.queryByText("角色 #8「c7」")).toBeNull();
  });

  it("整条不是对象时也报得出（它连 id 都没有，更要被点名）", () => {
    render(
      <DraftIntegrityHint
        issues={issuesOf({ shots: ["不是对象"] })}
        onGoTo={vi.fn()}
      />,
    );
    expect(screen.getByText("镜头 #1")).toBeTruthy();
    expect(screen.getByText(/整条不是对象/)).toBeTruthy();
  });
});
