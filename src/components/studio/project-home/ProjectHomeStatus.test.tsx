// 项目状态卡渲染测试：阶段行状态/计数、加载态给占位符（不是假的 0）、入口回抛。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_PRODUCTION_PROGRESS } from "~/lib/production/progress";
import { deriveProjectOverview } from "~/lib/production/project-home";
import type { ProductionRunView } from "~/lib/production/run-types";
import { ProjectHomeStatus } from "./ProjectHomeStatus";

afterEach(cleanup);

function view(over: Partial<ProductionRunView> = {}): ProductionRunView {
  return {
    hasScript: false,
    characterCount: 0,
    shots: [],
    filmRendered: false,
    ...over,
  };
}

function overview(over: Partial<ProductionRunView> = {}) {
  return deriveProjectOverview(view(over), DEFAULT_PRODUCTION_PROGRESS);
}

describe("ProjectHomeStatus", () => {
  it("六个阶段逐行按流水线顺序渲染，未开始的都标「未开始」", () => {
    render(
      <ProjectHomeStatus
        overview={overview()}
        loading={false}
        onNavigate={vi.fn()}
      />,
    );
    /* 按阶段列表（`<ul>`）逐行取，而不是全文档 `getByText` —— 「剧本」「成片」
     * 在旁边的「素材进度」里也有同名行，全文档查询会撞到两个节点。 */
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows[0]).toContain("剧本");
    expect(rows[1]).toContain("角色卡");
    expect(rows[2]).toContain("场景分镜");
    expect(rows[3]).toContain("镜头生图");
    expect(rows[4]).toContain("视频生成");
    expect(rows[5]).toContain("成片合成");
    /* 默认游标停在剧本（`DEFAULT_PRODUCTION_PROGRESS.stage`），所以第一行报
     * 「进行中」，其余五行才是「未开始」—— 这正是「停在哪个阶段」与「做到哪」
     * 两个判据分开记账的结果。 */
    expect(rows[0]).toContain("进行中");
    for (const row of rows.slice(1)) expect(row).toContain("未开始");
  });

  it("已完成阶段标「已完成」，计数与镜头数一致", () => {
    render(
      <ProjectHomeStatus
        overview={overview({
          hasScript: true,
          characterCount: 2,
          shots: Array.from({ length: 3 }, (_, index) => ({
            id: `s${index}`,
            rev: 0,
            hasImage: index < 2,
            hasClip: false,
          })),
        })}
        loading={false}
        onNavigate={vi.fn()}
      />,
    );
    // 剧本 / 角色卡 / 场景分镜 三段完成（有剧本 + 有角色 + 有镜头即算拆出了分镜）。
    expect(screen.getAllByText("已完成").length).toBe(3);
    expect(screen.getByText("2/3 镜")).toBeTruthy();
    expect(screen.getByText("3 / 6 完成")).toBeTruthy();
  });

  it("加载中不报假的 0，一律给占位符", () => {
    render(
      <ProjectHomeStatus overview={overview()} loading onNavigate={vi.fn()} />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("0 / 6 完成")).toBeNull();
  });

  it("「去工坊继续」回抛 workshop", () => {
    const onNavigate = vi.fn();
    render(
      <ProjectHomeStatus
        overview={overview()}
        loading={false}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /去工坊继续/ }));
    expect(onNavigate).toHaveBeenCalledWith("workshop");
  });
});
