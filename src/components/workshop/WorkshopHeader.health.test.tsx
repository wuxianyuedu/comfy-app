// 顶栏进度这一块的唯一出处：一段胶囊 + 一根分段条。
//
// 这个胶囊过去自己数一遍 ratio，与总进度条各说一次同一件事；两处口径一旦不同，
// 用户先撞上的是自相矛盾而不是某个具体的错。后来总进度条换成了分段控件（一段一根
// 细条），同一条账还是只有一份数据源。用例锁四件事：段数来自 health 快照、可见段名
// 走两字缩略而可访问名走全名（两者来自不同字段，不是同一个值写两遍）、色档由 ratio
// 决定（数据里不带色值）、全完成时不留假缺口。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkshopHeader } from "./WorkshopHeader";
import { STAGE_DEFS, computeStageRatios, type HealthRow } from "./stage-config";

function healthOf(
  overrides: Partial<Record<string, boolean | number>> = {},
): HealthRow[] {
  const rows = computeStageRatios(
    {
      scriptReady: true,
      characterCount: 2,
      sceneCount: 3,
      shotCount: 6,
      shotTarget: 6,
      imageDoneCount: 6,
      clipDoneCount: 6,
    },
    true,
  );
  return (Object.keys(rows) as HealthRow["id"][]).map((id) => {
    const override = overrides[id];
    const ratio = typeof override === "number" ? override : override ? 1 : 0;
    /* 缩略与全名故意取不同值：写成一样就无法证明视图分别用了这两个字段。 */
    return {
      id,
      label: id,
      shortLabel: id.slice(0, 2),
      ratio,
      pending: ratio < 1,
    };
  });
}

function renderHeader(health: HealthRow[]) {
  return render(
    <WorkshopHeader title="雾中来信" progressPct={40} health={health} />,
  );
}

afterEach(cleanup);

describe("WorkshopHeader 的进度胶囊", () => {
  it("部分完成时说出还差几段、分别是哪几段", () => {
    renderHeader(healthOf({ script: true, character: true }));
    const chip = screen.getByText(/^还差 \d+ 段：/);
    expect(chip.textContent).toContain("还差 4 段：");
    expect(chip.textContent).toContain("render");
  });

  it("全完成时不假装还缺东西", () => {
    renderHeader(
      healthOf({
        script: true,
        character: true,
        storyboard: true,
        shots: true,
        video: true,
        render: true,
      }),
    );
    expect(screen.getByText("六段流程已完成")).toBeTruthy();
    expect(screen.queryByText(/^还差/)).toBeNull();
  });
});

describe("WorkshopHeader 的健康度分段条", () => {
  function tracksOf(container: HTMLElement): Element[] {
    return [...container.querySelectorAll('[data-slot="progress-bar-track"]')];
  }
  function fillsOf(container: HTMLElement): Element[] {
    return [...container.querySelectorAll('[data-slot="progress-bar-fill"]')];
  }

  it("一段一根条：可见段名走缩略、可访问名走全名；顶栏没有第二处进度视觉", () => {
    const rows = healthOf({ script: true, character: 0.5 });
    const { container } = renderHeader(rows);
    const tracks = tracksOf(container);
    /* 条数 == 段数 == 快照长度：这一条同时钉住「没有再挂一根总进度条」。
       分段条就是顶栏唯一那处进度视觉，总数字退成文字。 */
    expect(tracks).toHaveLength(STAGE_DEFS.length);
    tracks.forEach((track, i) => {
      expect(track.getAttribute("role")).toBe("progressbar");
      expect(track.getAttribute("aria-label")).toBe(rows[i]?.label);
    });
    /* 屏面上是缩略、ARIA 上是全名 —— 两个字段各走一处。写反了或都写全名，
       这两条断言会一条红在「找不到可见缩略」、一条红在「全名不该出现在屏面」。 */
    for (const row of rows) {
      expect(screen.getByText(row.shortLabel)).toBeTruthy();
      expect(screen.queryByText(row.label)).toBeNull();
    }
    expect(screen.getByText("总进度 40%")).toBeTruthy();
    expect(container.textContent).not.toContain("项目总进度");
  });

  it("色档只由 ratio 决定：完成段成功色、未完成段品牌色（数据里不带色值）", () => {
    const rows = healthOf({ script: 1, character: 0.5, storyboard: 0 });
    const { container } = renderHeader(rows);
    const fills = fillsOf(container);
    expect(fills).toHaveLength(STAGE_DEFS.length);
    rows.forEach((row, i) => {
      const cls = fills[i]?.className ?? "";
      if (row.ratio >= 1) {
        expect(cls).toContain("bg-success");
        expect(cls).not.toContain("bg-primary");
      } else {
        expect(cls).toContain("bg-primary");
        expect(cls).not.toContain("bg-success");
      }
    });
  });

  it("ratio 走数值出口变成百分比，不在调用点自己乘 100", () => {
    const rows = healthOf({ character: 0.5 });
    const { container } = renderHeader(rows);
    const index = rows.findIndex((row) => row.id === "character");
    expect(index).toBeGreaterThanOrEqual(0);
    const track = tracksOf(container)[index];
    expect(track?.getAttribute("aria-valuenow")).toBe("50");
  });

  it("这一组有名字，读屏时说得清它是什么", () => {
    const { container } = renderHeader(healthOf({}));
    const group = container.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("工坊流程健康度");
  });
});
