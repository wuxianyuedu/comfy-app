import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import {
  DATA_LOCATION_CATEGORIES,
  DATA_LOCATIONS,
  isDataLocationCategory,
  isDataLocationId,
  type DataLocationCategory,
  type DataLocationId,
} from "~/lib/data-location/data-locations";

import { TooltipProvider } from "../ui/tooltip";
import { DataLocationBadge } from "./DataLocationBadge";
import { DataLocationOverview } from "./DataLocationOverview";

afterEach(cleanup);

/** `Hint` 的浮层要 `TooltipProvider`（应用里挂在根布局 `app/layout` 上）。 */
const wrap = (ui: ReactNode) => <TooltipProvider delay={0}>{ui}</TooltipProvider>;

/**
 * 「数据存放位置」徽标与总表（ISSUE #3625）。
 *
 * 这里钉的是**会静默失效**的那条：图标键取不到时 `~/components/ui/icon` 返回
 * `null` —— 徽标照样渲染，只是**没有图标**。没有用例时这一格永远绿，用户看到的
 * 却是「该有图标的地方空着」。所以逐个类别都断言「真的画出了 svg」。
 *
 * 悬停说明那两条（ISSUE #3672）钉的是另一件事：**说明走 Tooltip 而不是原生
 * `title=`** —— 原生 tooltip 由浏览器画，样式与主题都不归设计 token 管
 * （暗色下是一块白底气泡、长文案单行铺开）。判据是「`title` 属性没有了 +
 * 悬停后文案真的落在 `[data-slot=tooltip-content]` 里」。
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

  it("悬浮说明里带上落点与迁移办法（迁移时照着这两句做）", async () => {
    const user = userEvent.setup();
    render(wrap(<DataLocationBadge id="model-adapter" />));
    const badge = screen.getByText("数据库");
    /* 原生 `title=` 撤干净：它不由主题控制（ISSUE #3672 的现场就是暗色下一块白底气泡）。 */
    expect(badge).not.toHaveAttribute("title");
    await user.hover(badge);
    /* 浮层走 portal 挂在 body 上；等的是「浮层出现」这个 DOM 状态，
     * 按 §11.14.3 的口径用 jest-dom 匹配器认等待条件（本例只许 waitFor，
     * 不可换成 expect.poll —— poll 的 matcher 与 jest-dom 类型不兼容）。 */
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-content"]')).toBeInTheDocument();
    });
    const popup = document.querySelector('[data-slot="tooltip-content"]');
    expect(popup?.textContent).toContain("remoteModel");
    expect(popup?.textContent).toContain("迁移");
  });

  it("徽标不再带「存放位置」引导字（ISSUE #3625 reopen：说明走悬浮气泡，界面不留额外描述）", () => {
    const { container } = render(wrap(<DataLocationBadge id="model-adapter" />));
    expect(container.textContent).not.toContain("存放位置");
    /* 类别名（「数据库」）仍在：它是徽标自己的语义，不是引导语。 */
    expect(container.textContent).toContain("数据库");
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
    const { container } = render(wrap(<DataLocationOverview />));
    /* 徽标 = `Hint` 接管后的 trigger（`data-slot="tooltip-trigger"`；`Hint` 的
     * 副作用之一就是把子元素的 `data-slot` 改成它，见 `ui/hint` 头注）。 */
    expect(container.querySelectorAll('[data-slot="tooltip-trigger"]').length).toBe(
      Object.keys(DATA_LOCATIONS).length,
    );
  });
});
