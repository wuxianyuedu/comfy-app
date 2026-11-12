import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  DATA_LOCATION_CATEGORIES,
  DATA_LOCATIONS,
  isDataLocationCategory,
  isDataLocationId,
  type DataLocationCategory,
  type DataLocationId,
} from "~/lib/data-location/data-locations";

import { DataLocationBadge } from "./DataLocationBadge";
import { DataLocationOverview } from "./DataLocationOverview";

afterEach(cleanup);

/**
 * 「数据存放位置」徽标与总表（ISSUE #3625）。
 *
 * 这里钉的是**会静默失效**的那条：图标键取不到时 `~/components/ui/icon` 返回
 * `null` —— 徽标照样渲染，只是**没有图标**。没有用例时这一格永远绿，用户看到的
 * 却是「该有图标的地方空着」。所以逐个类别都断言「真的画出了 svg」。
 */

/** 每一类存放位置各取一份登记项（同一类别可能有多份，取第一份即可）。 */
function sampleIdOf(category: DataLocationCategory): DataLocationId {
  const found = Object.keys(DATA_LOCATIONS)
    .filter(isDataLocationId)
    .find((id) => DATA_LOCATIONS[id].category === category);
  expect(found, `${category} 没有登记项`).toBeDefined();
  return found ?? "app-database";
}

describe("DataLocationBadge", () => {
  it("每一类存放位置都画得出图标（图标键取不到时 Icon 会静默返回 null）", () => {
    for (const category of Object.keys(DATA_LOCATION_CATEGORIES).filter(isDataLocationCategory)) {
      const { container, unmount } = render(<DataLocationBadge id={sampleIdOf(category)} />);
      expect(container.querySelector("svg"), `${category} 这一类没画出图标`).not.toBeNull();
      unmount();
    }
  });

  it("徽标上写的是**存放位置类别**，不是数据种类名", () => {
    render(<DataLocationBadge id="model-adapter" />);
    expect(screen.getByText("数据库")).toBeTruthy();
  });

  it("悬浮说明里带上落点与迁移办法（迁移时照着这两句做）", () => {
    const { container } = render(<DataLocationBadge id="model-adapter" />);
    const badge = container.querySelector("[title]");
    expect(badge?.getAttribute("title")).toContain("remoteModel");
    expect(badge?.getAttribute("title")).toContain("迁移");
  });

  it("引导语可给可不给（给了就显示，不给就不多一个字）", () => {
    const { container, rerender } = render(
      <DataLocationBadge id="model-adapter" label="存放位置" />,
    );
    expect(container.textContent).toContain("存放位置");
    rerender(<DataLocationBadge id="model-adapter" />);
    expect(container.textContent).not.toContain("存放位置");
  });
});

describe("DataLocationOverview", () => {
  it("每一类数据都有一节，节里列着它的落点与迁移办法", () => {
    render(<DataLocationOverview />);
    for (const entry of Object.values(DATA_LOCATIONS)) {
      expect(
        screen.getAllByText(entry.kindLabel).length,
        `${entry.kindLabel} 这一节没渲染`,
      ).toBeGreaterThan(0);
      expect(screen.getAllByText(entry.target).length, `${entry.target} 没渲染`).toBeGreaterThan(0);
    }
  });

  it("每一行都带着那枚「存放位置」徽标", () => {
    const { container } = render(<DataLocationOverview />);
    expect(container.querySelectorAll("[title]").length).toBe(Object.keys(DATA_LOCATIONS).length);
  });
});
