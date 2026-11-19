import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  CanvasGrid,
  CanvasRulers,
  ZoomIndicator,
} from "~/components/studio/WorkflowCanvasDecorations";
import {
  StorybookFlowCanvas,
  canvasScene,
  type CanvasSceneName,
} from "../../../.storybook/flow-canvas";
import { DEFAULT_CANVAS_SETTINGS } from "~/components/studio/canvas/canvas-settings-types";

/**
 * 画布上的三块装饰层 —— 第二层注入（React Flow）里**视口**那一维的现场。三者全从 `useStore` 读运行期事实，故真画布是前提
 * （`.storybook/flow-canvas.tsx`）；且**不是**纯装饰 —— 每块对应一次真实事故：`CanvasGrid` 的淡出阈值曾误作整张网格关闭
 *（连底色一起消失 → 整屏黑）、`ZoomIndicator` 限幅取自用户设置、`CanvasRulers` 步长按「屏幕间距 ≥ 48px」现算。故按**缩放档**摆。
 */
const meta = {
  title: "Studio/Canvas/Decorations",
  component: CanvasGrid,
} satisfies Meta<typeof CanvasGrid>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 三块装饰层一起挂在真画布上（`ZoomIndicator` / `CanvasRulers` 自带定位）。 */
function DecoratedCanvas({ sceneName }: { sceneName: CanvasSceneName }) {
  return (
    <StorybookFlowCanvas scene={canvasScene(sceneName)}>
      <CanvasGrid />
      <CanvasRulers />
      <div className="pointer-events-none absolute bottom-4 left-4">
        <ZoomIndicator />
      </div>
    </StorybookFlowCanvas>
  );
}

/** 常规缩放（zoom = 1）：细网格 + 主参考线 + 标尺与缩放条同档。 */
export const AtDefaultZoom: Story = {
  render: () => (
    <div className="p-4">
      <DecoratedCanvas sceneName="twoNodes" />
    </div>
  ),
};

/** 放大（zoom = 1.4）：网格间距按缩放放大，标尺步长跟着换档。 */
export const ZoomedIn: Story = {
  render: () => (
    <div className="p-4">
      <DecoratedCanvas sceneName="zoomedIn" />
    </div>
  ),
};

/**
 * 缩到细网格淡出阈值之下（`GRID_FINE_FADE_ZOOM = 0.3`，这里 0.25）：那份事故的现场 —— **细线淡出、底色留下**。
 * 底色没了 = 整屏黑，而它是「画布到底渲染出来没有」的唯一直观凭据。
 */
export const ZoomedOutFineGridFaded: Story = {
  render: () => (
    <div className="p-4">
      <DecoratedCanvas sceneName="zoomedOut" />
    </div>
  ),
};

/** 关掉网格（用户设置）：格子没了，**底色与标尺仍在** —— 关的是格子不是画布。 */
export const GridOff: Story = {
  render: () => (
    <div className="p-4">
      <StorybookFlowCanvas scene={canvasScene("twoNodes")}>
        <CanvasGrid settings={{ ...DEFAULT_CANVAS_SETTINGS, showGrid: false }} />
        <CanvasRulers />
      </StorybookFlowCanvas>
    </div>
  ),
};

/**
 * 密集画布（36 张节点）：标尺标签步长按「屏幕间距 ≥ 48px」现算 ——
 * 空画布看不出这件事，这一档才有得比（缩小后标签会不会糊成一片）。
 */
export const DenseGrid: Story = {
  render: () => (
    <div className="p-4">
      <DecoratedCanvas sceneName="dense" />
    </div>
  ),
};
