// @vitest-environment jsdom
/* 尺寸控件里的两类尺寸表达（用户口径）：
 *
 *   · 「像素」大类下分「分辨率」（1k/2k/4k，按场景尺寸表取宽高）与
 *     「百万像素」（1M/2M/4M，总像素预算）两个子类；
 *   · 选中百万像素档时，「倍数」（8/16/32/64）必须出现 —— 百万像素只有配上
 *     对齐倍数才定得下具体宽高，藏起来用户就不知道宽高从哪来。
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import type { EnrichedWidget } from "../workflow-io";
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

function renderSize(width: number, height: number) {
  const { container } = render(
    <DimensionControl
      group={{
        kind: "dimension",
        groupId: "dim-1",
        width: widget({
          ioKey: "5::widget::width",
          name: "width",
          label: "宽度",
          defaultValue: width,
        }),
        height: widget({
          ioKey: "5::widget::height",
          name: "height",
          label: "高度",
          defaultValue: height,
        }),
      }}
      values={{}}
      set={() => undefined}
      setMany={() => undefined}
    />,
  );
  fireEvent.click(container.querySelector('[aria-label="选择比例与像素"]')!);
  /* 段内选项从手拼 `<Button role="option">` 迁到 base-ui ToggleGroup 之后,
   * 每行是 `<ToggleGroupItem>`(base-ui Toggle 只写 `aria-pressed`、默认
   * role=button,不再挂 role=option)。shadcn 的 `ui/toggle-group.tsx` 给
   * 每个 item 显式挂 `data-slot="toggle-group-item"`,拿它做 selector 比
   * role 更稳、也不被未来 base-ui 语义微调打断。
   * 注意:PopoverContent 走 Portal 挂到 `document.body`、不在 `container`
   * 里 —— 必须从 document 或 `screen` 拿,与旧 `screen.queryAllByRole` 等价。 */
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-slot=toggle-group-item]"),
  ).map((el) => el.textContent ?? "");
}

describe("尺寸控件的两类表达", () => {
  it("「像素」里同时给出「分辨率」与「百万像素」两个子类", () => {
    const labels = renderSize(1024, 576);
    for (const tier of ["1k", "2k", "4k"]) expect(labels).toContain(tier);
    for (const tier of ["1M", "2M", "4M"]) expect(labels).toContain(tier);
    expect(screen.getByText("分辨率")).toBeTruthy();
    expect(screen.getByText("百万像素")).toBeTruthy();
  });

  it("分辨率档不出现「倍数」（宽高由尺寸表给定）", () => {
    const labels = renderSize(1024, 576);
    expect(labels).not.toContain("64");
  });

  it("百万像素档出现「倍数」，候选为 8/16/32/64", () => {
    /* 1856×1088 = 16:9 下 2M 档经 64 对齐后的宽高 → 回读落在百万像素 2M。 */
    const labels = renderSize(1856, 1088);
    for (const multiple of ["8", "16", "32", "64"])
      expect(labels).toContain(multiple);
    expect(screen.getByText("倍数")).toBeTruthy();
  });

  it("「百万像素」那一组挂着自定义步进器（档位之外能填任意值）", () => {
    /* 百万像素在端口上是 FLOAT，1M/2M/4M 只是常用档位 —— 少了这条步进器，
     *  要 2.5 这个值就只能去改工作流 JSON。 */
    renderSize(1856, 1088);
    expect(screen.getByText("自定义")).toBeTruthy();
    /* 限定在步进器里查（同一块控件还有宽/高两个 NumberField，它们的步进按钮
     *  title 长得一样），且不锁死步进量 —— 那是 `MegapixelStepper` 自己的决定。 */
    const stepper = within(screen.getByTestId("megapixel-stepper"));
    expect(stepper.getByTitle(/^增加 /)).toBeTruthy();
    expect(stepper.getByTitle(/^减少 /)).toBeTruthy();
  });
});
