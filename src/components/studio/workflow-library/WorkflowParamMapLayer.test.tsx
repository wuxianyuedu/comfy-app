// @vitest-environment jsdom
/* 工作流库画布的对外参数映射层 —— ISSUE #355
 *
 * 库详情必须能看到「对外参数是一张张卡片、和宿主卡片端口用连线连着」：
 *   · 每个对外参数一张卡片（与编辑器同款视觉）；
 *   · 已映射的条目画一条线（自动线虚线、作者线实线），显式断开的条目不画线；
 *   · 目标端口行按 `data-io-key` 量位置（jsdom 无布局，这里只断言卡片与连线的
 *     「有无」与线型，不断言像素）。 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { buildParamEntries, autoMapEntries } from "~/lib/workflow-param-mapping";
import { WorkflowParamMapLayer } from "./WorkflowParamMapLayer";

afterEach(cleanup);

const io: WorkflowIOMap = {
  "9::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    nodeTitle: "Text to Image",
    name: "positive_prompt",
    type: "STRING",
    defaultValue: "3只小猫在喝山泉",
  },
  "5::widget::height": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "height",
    type: "INT",
    defaultValue: 1024,
  },
};

/* 宿主卡片容器：带一个 data-io-key 行，模拟表单里被映射到的端口。 */
function renderLayer(args: {
  resolvedOverride?: Record<string, string | null>;
  manual?: Set<string>;
}) {
  const entries = buildParamEntries(io);
  const auto = autoMapEntries(entries, io);
  const resolved = args.resolvedOverride ?? auto;
  const hostRef = createRef<HTMLDivElement>();
  const utils = render(
    <div>
      <div ref={hostRef} data-testid="host">
        <div data-io-key="9::widget::text" />
        <div data-io-key="5::widget::height" />
      </div>
      <WorkflowParamMapLayer
        entries={entries}
        resolved={resolved}
        isManual={(id) => args.manual?.has(id) ?? false}
        hostRef={hostRef}
      />
    </div>
  );
  return { ...utils, entries };
}

describe("WorkflowParamMapLayer", () => {
  it("每个对外参数一张卡片", () => {
    const { entries, container } = renderLayer({});
    for (const entry of entries) {
      expect(
        container.querySelector(`[data-testid="library-param-card-${entry.id}"]`)
      ).toBeTruthy();
    }
  });

  it("已映射的条目画线，自动线是虚线", () => {
    const { entries, container } = renderLayer({});
    const first = entries[0]!;
    const wire = container.querySelector(
      `[data-testid="library-param-wire-${first.id}"]`
    );
    expect(wire).toBeTruthy();
    expect(wire?.getAttribute("stroke-dasharray")).toBe("6 4");
  });

  it("作者改过的线是实线（无虚线样式）", () => {
    const { entries, container } = renderLayer({ manual: new Set([buildParamEntries(io)[0]!.id]) });
    const wire = container.querySelector(
      `[data-testid="library-param-wire-${entries[0]!.id}"]`
    );
    expect(wire).toBeTruthy();
    expect(wire?.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("显式断开的条目不画线（目标为 null）", () => {
    const entries = buildParamEntries(io);
    const first = entries[0]!;
    const { container } = renderLayer({
      resolvedOverride: { [first.id]: null, [entries[1]!.id]: "5::widget::height" },
    });
    expect(
      container.querySelector(`[data-testid="library-param-wire-${first.id}"]`)
    ).toBeNull();
  });

  it("组合参数（宽/高）没有独立行时，连线锚到 data-dimension-pins 上", () => {
    const entries = buildParamEntries(io);
    const heightEntry = entries.find((e) => e.id.endsWith("size-height"))!;
    const hostRef = createRef<HTMLDivElement>();
    const { container } = render(
      <div>
        <div ref={hostRef}>
          {/* 宽/高由同一个控件录入 → 没有 data-io-key，只有整块的 pins 列表。 */}
          <div data-dimension-pins={`${heightEntry.pins[0]!.ioKey},x::width`} />
        </div>
        <WorkflowParamMapLayer
          entries={entries}
          resolved={{ [heightEntry.id]: heightEntry.pins[0]!.ioKey }}
          isManual={() => false}
          hostRef={hostRef}
        />
      </div>
    );
    expect(
      container.querySelector(`[data-testid="library-param-wire-${heightEntry.id}"]`)
    ).toBeTruthy();
  });

  it("没有对外参数时不渲染映射层", () => {
    const hostRef = createRef<HTMLDivElement>();
    const { container } = render(
      <div>
        <div ref={hostRef} data-testid="host" />
        <WorkflowParamMapLayer entries={[]} resolved={{}} isManual={() => false} hostRef={hostRef} />
      </div>
    );
    expect(container.querySelector('[data-testid="workflow-param-map-layer"]')).toBeNull();
  });
});
