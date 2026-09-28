// @vitest-environment jsdom
// 顶栏「还差几段」的唯一出处。
//
// 这个胶囊过去自己数一遍 ratio，与总进度条各说一次同一件事；两处口径一旦不同，
// 用户先撞上的是自相矛盾而不是某个具体的错。用例锁三件事：段数与段名都来自
// health 快照、全完成时不留假缺口、部分完成时把差的是哪几段说得出名字。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkshopHeader } from "./WorkshopHeader";
import { computeStageRatios, type HealthRow } from "./stage-config";

function healthOf(
  overrides: Partial<Record<string, boolean>> = {},
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
  return (Object.keys(rows) as HealthRow["id"][]).map((id) => ({
    id,
    label: id,
    ratio: overrides[id] ? 1 : 0,
    pending: !overrides[id],
  }));
}

function renderHeader(health: HealthRow[]) {
  return render(
    <WorkshopHeader
      title="雾中来信"
      progressPct={40}
      health={health}
      apiChannels={null}
      onOpenApiSettings={() => undefined}
      onOpenModeContract={() => undefined}
    />,
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
