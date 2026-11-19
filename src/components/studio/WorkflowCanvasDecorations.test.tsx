// 画布装饰层的「底色恒在」契约 —— ISSUE #400。现象：缩放 / 进子工作流后整块画布变黑，根因是
// `<CanvasGrid>` 把细网格线的淡出阈值当成了整张网格层的关闭阈值（`zoom <= 0.3` 直接返回 null），
// 连承载底色的 `bgColor` 一起消失。「底色在不在」是用户判断画布有没有渲染出来的唯一直观凭据。
// 用例钉三件事：极限缩放下底色仍渲染；细线该淡出就淡出；主动关网格只关格子不关底色。

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";

import { CANVAS_BG, CanvasGrid, GRID_FINE_FADE_ZOOM } from "./WorkflowCanvasDecorations";
import { DEFAULT_CANVAS_SETTINGS, type CanvasSettings } from "./canvas/canvas-settings-types";
import {
  GRID_BASE_LAYER_ID,
  GRID_MAJOR_LAYER_ID,
  GRID_MINOR_LAYER_ID,
  gridLineColor,
} from "./canvas/workflow-canvas-grid";

afterEach(cleanup);

function renderGrid(settings?: Partial<CanvasSettings>) {
  return render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600, position: "relative" }}>
        <CanvasGrid settings={{ ...DEFAULT_CANVAS_SETTINGS, ...settings }} />
      </div>
    </ReactFlowProvider>,
  );
}

/** 某一层是否已渲染（React Flow 的 <Background> 把层 id 挂在 pattern 上）。 */
function layerIds(container: HTMLElement): Array<string> {
  return [...container.querySelectorAll("pattern")].map((el) => el.id);
}

function hasLayer(container: HTMLElement, layerId: string): boolean {
  return layerIds(container).some((id) => id.endsWith(layerId));
}

/** 底色层实际下发的画布背景色（React Flow 把它写成 CSS 变量）。 */
function baseColor(container: HTMLElement): string {
  const svg = [...container.querySelectorAll("svg.react-flow__background")].find((el) =>
    [...el.querySelectorAll("pattern")].some((p) => p.id.endsWith(GRID_BASE_LAYER_ID)),
  );
  return svg?.getAttribute("style") ?? "";
}

describe("CanvasGrid · 画布底色", () => {
  it("默认渲染底色层（画布已渲染的唯一直观凭据）", () => {
    const { container } = renderGrid();

    expect(hasLayer(container, GRID_BASE_LAYER_ID)).toBe(true);
  });

  it("底色层下发的是画布背景色，不是 transparent（否则等同于没画）", () => {
    const { container } = renderGrid();
    const style = baseColor(container);

    expect(style).toContain(CANVAS_BG);
    expect(style).not.toMatch(/background-color-props:\s*transparent/);
  });

  it("细线淡出阈值是一个远小于 1 的缩放值，好让极限缩放仍留画布与主参考线", () => {
    expect(GRID_FINE_FADE_ZOOM).toBeGreaterThan(0);
    expect(GRID_FINE_FADE_ZOOM).toBeLessThan(1);
  });

  it("用户关掉网格设置时仍保留底色（关的是格子，不是画布）", () => {
    const { container } = renderGrid({ showGrid: false });

    expect(hasLayer(container, GRID_BASE_LAYER_ID)).toBe(true);
    expect(hasLayer(container, GRID_MINOR_LAYER_ID)).toBe(false);
    expect(hasLayer(container, GRID_MAJOR_LAYER_ID)).toBe(false);
  });

  it("默认设置下三层都在：细线 / 底色 / 主参考线", () => {
    const { container } = renderGrid();

    expect(hasLayer(container, GRID_MINOR_LAYER_ID)).toBe(true);
    expect(hasLayer(container, GRID_BASE_LAYER_ID)).toBe(true);
    expect(hasLayer(container, GRID_MAJOR_LAYER_ID)).toBe(true);
  });
});

/**
 * 网格线的**颜色出口**契约（规范 03 §3.6.1.1）：色相只在 `globals.css` 定义一次、调用处只给 α
 * （此前三份写法：两处写死 rgba、一处引用从未定义的 token）。用例钉「送达」—— React Flow 把
 * `color` 写成 `--xy-background-pattern-color-props`，jsdom 读得到；`color-mix()` 解析归 e2e。
 */
describe("网格线颜色出口", () => {
  /** 某一层实际下发的颜色表达式（React Flow 写在 svg 的内联自定义属性上）。 */
  function patternColor(container: HTMLElement, layerId: string): string {
    const svgs = [...container.querySelectorAll("svg.react-flow__background")];
    for (const svg of svgs) {
      const mine = [...svg.querySelectorAll("pattern")].some((p) => p.id.endsWith(layerId));
      if (mine) {
        return (
          svg
            .getAttribute("style")
            ?.match(/--xy-background-pattern-color-props:\s*(?<color>[^;]+);/)?.groups?.color ?? ""
        );
      }
    }
    return "";
  }

  it("出口只给 α：色相一律走 token，不再在任何调用处写死", () => {
    const { container } = renderGrid();
    for (const layer of [GRID_MINOR_LAYER_ID, GRID_MAJOR_LAYER_ID]) {
      const color = patternColor(container, layer);
      expect(color, `${layer} 的颜色表达式没走 token`).toContain("var(--color-canvas-grid-line)");
      expect(color, `${layer} 又写回了死色相`).not.toMatch(/148/);
    }
  });

  /* 主参考线的 α 直接来自用户设置（不乘缩放系数），所以能钉到具体百分比 ——
   * 这一条同时验「α 真的乘上去了」和「百分数写法不丢精度」。 */
  it("主参考线按用户设置的 α 现取（默认 0.14 → 14%）", () => {
    const { container } = renderGrid();
    expect(patternColor(container, GRID_MAJOR_LAYER_ID)).toBe(
      gridLineColor(DEFAULT_CANVAS_SETTINGS.gridMajorAlpha),
    );
    expect(gridLineColor(0.14)).toContain(") 14%,");
    expect(gridLineColor(0.132)).toContain(") 13.2%,");
    expect(gridLineColor(1)).toContain(") 100%,");
  });
});
