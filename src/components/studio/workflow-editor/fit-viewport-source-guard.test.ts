/**
 * 打开画布时的「聚焦」必须**按本画布实例**取容器尺寸（ISSUE #717）。
 *
 * 用户报的现场：打开工作流编辑画布后**没有聚焦**，视口停在内容之外的某一角，
 * 每次打开都要自己滚轮缩放才能看到工作流。
 *
 * 根因是容器尺寸的来源：`applyFitViewport` 用
 * `document.querySelector(".react-flow")` 量容器，而**页面上不止一个 React Flow**
 * —— 工作流库详情面板的画布预览就在同一个 DOM 里（`WorkflowLibraryCanvas`），
 * 且文档顺序在编辑器之前。于是编辑器拿**库预览的 843×458** 当作自己的
 * 1295×772 去算居中，算出来的视口自然落不到内容上（实测
 * `translate(-751, -465.75) scale(0.35)`，正确值 `translate(-525, -308.75)`）。
 *
 * 这条守卫是源码级的：聚焦路径里再出现「全文档查 `.react-flow`」即被拦下。
 * 判据收在 `useStoreApi()` 的 store —— `width` / `height` 是 React Flow 按
 * **本实例容器**测出来的，天然实例私有。
 *
 * 聚焦路径（调度 + 收敛 + 下发）现在住在 `hooks/use-workflow-viewport-fit.ts`
 * —— 机制断据跟着搬到那里；本组件侧只断言「编辑器接的是这个 hook」，
 * 不允许聚焦逻辑散回组件体。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EDITOR_DIR = path.resolve(__dirname);
const INNER = "WorkflowEditorInner.tsx";
const FIT_HOOK = path.join("hooks", "use-workflow-viewport-fit.ts");

/** 去掉块注释与行注释，避免文档里提到旧写法时误伤断言。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
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
    const uses = src.match(
      /const \{ width, height \} = rfStore\.getState\(\);/g,
    );
    expect(uses?.length).toBeGreaterThanOrEqual(2);
  });

  it("聚焦的缩放区间取自画布设置，而不是写死的下限", () => {
    const src = readSource(FIT_HOOK);
    /* 两处 applyFitViewport 调用都要带上画布自己的 minZoom / maxZoom ——
     * 写死下限会让宽图「聚焦后仍有大半在视口外」（ISSUE #717）。 */
    const calls = src.match(/applyFitViewport\(/g) ?? [];
    const withBounds =
      src.match(
        /minZoom: canvasSettings\.minZoom, maxZoom: canvasSettings\.maxZoom/g,
      ) ?? [];
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
