// @vitest-environment jsdom
/* 组合参数控件的映射锚点 —— ISSUE #355
 *
 * 「宽/高」「比例 + 像素」「时长 + 画质 + 比例」由**同一个控件**录入，没有独立的
 * 一行端口可以连。映射连线（工作流库画布）量的是行上的锚点属性，落到这类口子上
 * 必须量得到整块控件 —— 否则线整条不画，「尺寸」这张卡看起来就是没连上。
 *
 * 属性名收在 `workflow-io-types`（`WIRE_PINS_ATTR`），量测侧从同一处取，
 * 两边不是各写一份字符串。
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { EnrichedWidget } from "~/components/studio/shared/workflow-io";
import { WIRE_PINS_ATTR } from "~/lib/workflow-io-types";
import { DimensionControl } from "./DimensionControl";

afterEach(cleanup);

function widget(overrides: Partial<EnrichedWidget>): EnrichedWidget {
  return {
    ioKey: "5::widget::x",
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "x",
    type: "INT",
    control: "int",
    ...overrides,
  };
}

describe("组合参数控件的落点锚点", () => {
  it("比例 + 像素那一块带锚点，值覆盖它含的两个端口", () => {
    const { container } = render(
      <DimensionControl
        group={{
          kind: "dimension",
          groupId: "dim-1",
          aspect: widget({
            ioKey: "5::widget::aspect_ratio",
            name: "aspect_ratio",
            type: "COMBO",
            control: "select",
          }),
          megapixels: widget({
            ioKey: "5::widget::megapixels",
            name: "megapixels",
            type: "FLOAT",
            control: "float",
          }),
        }}
        values={{}}
        set={() => undefined}
        setMany={() => undefined}
      />,
    );
    const anchored = container.querySelector(`[${WIRE_PINS_ATTR}]`);
    expect(anchored).toBeTruthy();
    expect(anchored!.getAttribute(WIRE_PINS_ATTR)).toBe(
      "5::widget::aspect_ratio,5::widget::megapixels",
    );
  });
});
