// 竖向阶段轨道的结构基线：六段、逐项占位、当前段的 aria 与配色、徽章三态、
// 小字来源。横向换竖向最容易悄悄少一个类或丢一个 aria，肉眼又只在看的时候发现。
//
// 另一半（懒加载边界与「不出现第二个阶段切换入口」）在
// `workshop-stage-rail-boundary.test.ts` —— 那边按源码读，不需要 DOM，也就必须
// 留在 node 环境：jsdom 下 `import.meta.url` 不是 file: 协议，读文件会直接抛错。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkshopStageRail } from "./WorkshopStageRail";
import {
  computeStageRatios,
  stageSubtitle,
  STAGE_DEFS,
  type StageViewContext,
  type Tab,
} from "./stage-config";

const ctx: StageViewContext = {
  scriptReady: true,
  characterCount: 0,
  sceneCount: 0,
  shotCount: 0,
  shotTarget: 0,
  imageDoneCount: 0,
  clipDoneCount: 0,
};
const ratios = computeStageRatios(ctx, false);
const ACTIVE: Tab = "storyboard";
const activeIndex = STAGE_DEFS.findIndex((stage) => stage.id === ACTIVE);
const doneIndex = STAGE_DEFS.findIndex((stage) => ratios[stage.id] >= 1);
const pendingIndex = STAGE_DEFS.findIndex(
  (stage) => ratios[stage.id] < 1 && stage.id !== ACTIVE,
);

function renderRail() {
  const { container } = render(
    <WorkshopStageRail
      tab={ACTIVE}
      stageRatios={ratios}
      viewContext={ctx}
      onTabChange={() => undefined}
    />,
  );
  const nav = container.querySelector<HTMLElement>("nav");
  if (nav === null) throw new Error("阶段轨道没有渲染出 <nav> 元素");
  const buttons = screen.getAllByRole("button");
  const badge = (index: number) =>
    buttons[index]?.querySelector<HTMLElement>("span");
  const sub = (index: number) =>
    buttons[index]?.querySelector<HTMLElement>("div > div:nth-child(2)");
  return { nav, buttons, badge, sub };
}

afterEach(cleanup);

describe("WorkshopStageRail 的结构", () => {
  it("夹具覆盖完成 / 当前 / 未开始三种形态", () => {
    // 夹具退化（比如 ratio 全 1）会让下面的三态断言变成同值比较，先自证
    expect(doneIndex).toBeGreaterThanOrEqual(0);
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    expect(pendingIndex).toBeGreaterThanOrEqual(0);
    expect(new Set([doneIndex, activeIndex, pendingIndex]).size).toBe(3);
  });

  it("是一个带名字的导航区，六段各一项、逐项占满列宽", () => {
    const { nav, buttons } = renderRail();
    expect(nav.getAttribute("aria-label")).toBe("工坊阶段");
    expect(buttons).toHaveLength(STAGE_DEFS.length);
    for (const button of buttons) {
      expect(button.className).toContain("w-full");
    }
  });

  it("文案与判据同横条一致：阶段名 + stageSubtitle，当前段才有 aria-current", () => {
    const { buttons, sub, badge } = renderRail();
    buttons.forEach((button, index) => {
      const stage = STAGE_DEFS[index];
      expect(button.querySelector("div > div:nth-child(1)")?.textContent).toBe(
        stage?.label,
      );
      expect(sub(index)?.textContent).toBe(
        stageSubtitle(stage?.id ?? "script", ACTIVE, ratios, ctx),
      );
    });
    expect(buttons[activeIndex]?.getAttribute("aria-current")).toBe("step");
    expect(buttons[activeIndex]?.className).toContain("bg-primary/12");
    expect(buttons[pendingIndex]?.getAttribute("aria-current")).toBeNull();
    expect(buttons[pendingIndex]?.className).toContain("bg-surface");
    // 徽章三态：完成段勾图标、未开始段序号、当前段品牌色底；等宽高只有一个出处
    expect(badge(doneIndex)?.className).toContain("bg-success/80");
    expect(badge(pendingIndex)?.textContent).toBe(String(pendingIndex + 1));
    expect(badge(activeIndex)?.className).toContain("bg-primary");
    for (const cls of [
      badge(doneIndex)?.className ?? "",
      badge(pendingIndex)?.className ?? "",
    ]) {
      expect(cls).toContain("size-9");
      expect(cls).not.toMatch(/\bh-9\b|\bw-9\b/);
    }
  });
});
