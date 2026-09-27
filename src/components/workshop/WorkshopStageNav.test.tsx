// @vitest-environment jsdom
// 横向阶段导航的结构基线。
//
// 为什么要这份用例：下一步要把「一段阶段在导航里长什么样」抽成横向与竖向共用的
// 单件组件（避免同一套完成态判据写两遍）。那种搬迁最容易「悄无声息地少一个类」，
// 而观感差异只有肉眼能发现 —— 这里把肉眼看不见的部分（类名、aria、文字来源）先钉死，
// 抽件之后同一份断言必须仍然全绿，「视觉零变化」才算被证明而不是被声称。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkshopStageNav } from "./WorkshopStageNav";
import {
  computeStageRatios,
  stageSubtitle,
  STAGE_DEFS,
  type StageViewContext,
  type Tab,
} from "./stage-config";

/**
 * 夹具刻意取「只有剧本完成、其余全空」这一形态：三段判据（完成 / 进行中 / 未开始）
 * 都能在同一次渲染里出现，断言不需要猜数据，也不会因为 ratio 全 1 而退化成同值比较。
 */
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

/**
 * 取节点一律用 `querySelector<HTMLElement>(…)` 的泛型形参，不写 `as` 断言也不写 `!`：
 * 前者是「我要按这个类型读它」的声明，后者是「我保证它不是空」的断言 —— 而这两个
 * 都该由测试自己的判据来兜（下面每个断言前都有 expect(...).not.toBeNull() 或
 * 直接让断言读 undefined 时失败），不该靠断言绕过类型检查。
 */
function renderNav() {
  const { container } = render(
    <WorkshopStageNav
      tab={ACTIVE}
      stageRatios={ratios}
      viewContext={ctx}
      onTabChange={() => undefined}
    />,
  );
  const nav = container.querySelector<HTMLElement>("nav");
  // 显式收窄而不是 `nav!`：非空断言在 src/** 里有棘轮拦着，测试同样不该靠它
  if (nav === null) throw new Error("阶段导航没有渲染出 <nav> 元素");
  const buttons = screen.getAllByRole("button");
  const badge = (index: number) =>
    buttons[index]?.querySelector<HTMLElement>("span");
  const sub = (index: number) =>
    buttons[index]?.querySelector<HTMLElement>("div > div:nth-child(2)");
  return { nav, buttons, badge, sub };
}

afterEach(cleanup);

describe("WorkshopStageNav 的结构基线", () => {
  /* 夹具自证：三种阶段形态各就各位。少了这一条，上面所有按下标推导的断言都可能在
   * 夹具退化时（比如 ratio 全 1）静默变成同值比较，看着全绿其实什么都没测。 */
  it("夹具覆盖完成 / 当前 / 未开始三种形态", () => {
    expect(doneIndex).toBeGreaterThanOrEqual(0);
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    expect(pendingIndex).toBeGreaterThanOrEqual(0);
    expect(new Set([doneIndex, activeIndex, pendingIndex]).size).toBe(3);
  });

  it("六个阶段各一个可点项，文案是「阶段名 + 完成度小字」", () => {
    const { buttons, sub } = renderNav();
    expect(buttons).toHaveLength(STAGE_DEFS.length);
    buttons.forEach((button, index) => {
      const stage = STAGE_DEFS[index];
      expect(button.querySelector("div > div:nth-child(1)")?.textContent).toBe(
        stage?.label,
      );
      expect(sub(index)?.textContent).toBe(
        stageSubtitle(stage?.id ?? "script", ACTIVE, ratios, ctx),
      );
    });
  });

  it("导航本身是横向等分容器（flex + items-stretch + 逐项 flex-1）", () => {
    const { nav, buttons } = renderNav();
    expect(nav.className).toBe(
      "border-border flex items-stretch gap-3 border-b px-6 py-4",
    );
    for (const button of buttons) {
      expect(button.className).toContain("flex-1");
    }
  });

  it("当前段带 aria-current=step 与选中配色，其余段不带", () => {
    const { buttons } = renderNav();
    buttons.forEach((button, index) => {
      if (index === activeIndex) {
        expect(button.getAttribute("aria-current")).toBe("step");
        expect(button.className).toContain("bg-primary/12");
        expect(button.className).toContain("ring-1");
      } else {
        expect(button.getAttribute("aria-current")).toBeNull();
        expect(button.className).toContain("bg-surface");
      }
    });
  });

  it("徽章三态：完成段换勾图标、未开始段是序号、当前段是品牌色底", () => {
    const { buttons, badge } = renderNav();
    expect(badge(doneIndex)?.className).toContain("bg-success/80");
    expect(buttons[doneIndex]?.querySelector("svg")).toBeTruthy();
    expect(badge(pendingIndex)?.className).toContain("bg-elevated");
    expect(badge(pendingIndex)?.textContent).toBe(String(pendingIndex + 1));
    expect(badge(activeIndex)?.className).toContain("bg-primary");
  });

  it("小字说明按完成态分文字色档（完成绿、其余灰）", () => {
    const { sub } = renderNav();
    expect(sub(doneIndex)?.className).toContain("text-success-strong");
    expect(sub(pendingIndex)?.className).toContain("text-muted-foreground");
  });
});

/**
 * 单独一条，且**在改动之前它就是红的**：徽章盒同时写了 `h-9` 与 `w-9` 两个值，
 * 而等宽高只该有一个出处（`size-9`，P80 判据要求的形态）。把它和上面的基线断言
 * 分开，是为了让「其余结构不变」有一串绿的证据，而这一条红精确对应那一处有意改动。
 */
describe("WorkshopStageNav 的待修一处", () => {
  it("徽章盒用 size-9 表达等宽高，不写 h-9 + w-9 两个值", () => {
    const { badge } = renderNav();
    const cls = badge(doneIndex)?.className ?? "";
    expect(cls).toContain("size-9");
    expect(cls).not.toMatch(/\bh-9\b/);
    expect(cls).not.toMatch(/\bw-9\b/);
  });
});
