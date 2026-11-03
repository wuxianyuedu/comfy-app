/**
 * 打开画布时的「聚焦」必须**按本画布实例**取容器尺寸（ISSUE #717）：原先`document.querySelector(".react-flow")` 会命中同页更早的库预览画布（843×458），拿
 * 它当自己的 1295×772 算居中，视口落在内容外（实测 translate(-751,-465.75) 而非
 * (-525,-308.75)）。判据收在 `useStoreApi()` 的 store：width/height 由 React Flow 按本实例容器测量；源码级守卫拦截再出现全文档查询。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EDITOR_DIR = path.resolve(__dirname);
const INNER = "WorkflowEditorInner.tsx";
const FIT_HOOK = path.join("hooks", "use-workflow-viewport-fit.ts");

/** 去掉块注释与行注释，避免文档里提到旧写法时误伤断言。 */
function stripComments(code: string): string {
  return code.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "");
}

function readSource(file: string): string {
  return stripComments(readFileSync(path.join(EDITOR_DIR, file), "utf8"));
}

describe("打开画布时的聚焦（容器尺寸口径）", () => {
  it("不按全文档查 `.react-flow` 取容器 —— 页面上还有工作流库的画布预览", () => {
    for (const file of [INNER, FIT_HOOK]) {
      const src = readSource(file);
      expect(src).not.toContain('querySelector(".react-flow")');
      expect(src).not.toContain("querySelector('.react-flow')");
    }
  });

  it("容器尺寸取自本实例的 React Flow store（useStoreApi 的 width / height）", () => {
    const src = readSource(FIT_HOOK);
    expect(src).toContain("useStoreApi()");
    /* 聚焦路径上两处下发视口都用 store 的宽高。 */
    const uses = src.match(/const \{ width, height \} = rfStore\.getState\(\);/g);
    expect(uses?.length).toBeGreaterThanOrEqual(2);
  });

  it("聚焦的缩放区间取自画布设置，而不是写死的下限", () => {
    const src = readSource(FIT_HOOK);
    /* 两处 applyFitViewport 调用都要带上画布自己的 minZoom / maxZoom ——
     * 写死下限会让宽图「聚焦后仍有大半在视口外」（ISSUE #717）。 */
    const calls = src.match(/applyFitViewport\(/g) ?? [];
    const withBounds =
      src.match(/minZoom: canvasSettings\.minZoom, maxZoom: canvasSettings\.maxZoom/g) ?? [];
    /* 1 处定义 + 1 处带换行的调用（逐字形态不同），另有 1 处单行形态。 */
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(withBounds.length).toBeGreaterThanOrEqual(1);
    expect(src).toContain("canvasSettings.minZoom");
  });

  it("编辑器本体接线视口贴合 hook，不把聚焦逻辑散回组件体", () => {
    const src = readSource(INNER);
    expect(src).toContain("useWorkflowViewportFit(");
    /* 画布设置整体交给 hook（缩放区间在 hook 内取自它，见上一条）。 */
    expect(src).toMatch(/useWorkflowViewportFit\(\{[^}]*canvasSettings/s);
  });
});
