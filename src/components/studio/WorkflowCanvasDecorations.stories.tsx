import type { Meta, StoryObj } from "@storybook/nextjs";

import {
  CanvasGrid,
  CanvasRulers,
  ZoomIndicator,
} from "~/components/studio/WorkflowCanvasDecorations";
import {
  StorybookFlowCanvas,
  canvasScene,
} from "../../../.storybook/flow-canvas";
import { DEFAULT_CANVAS_SETTINGS } from "~/components/studio/canvas/canvas-settings-types";

/**
 * 画布上的三块装饰层 —— 第二层注入（React Flow）里**视口**那一维的现场。
 *
 * 三个组件全从 `useStore` 读运行期事实（`transform` 的平移与缩放、画布宽高），
 * 所以真画布是前提（`.storybook/flow-canvas.tsx`）。它们**不是**纯装饰 ——
 * 每一块都对应一次真实事故：
 *
 *  · `CanvasGrid` 的 `GRID_FINE_FADE_ZOOM`：曾经是「整张网格一起关掉」，连带
 *    承载底色的 `bgColor` 一起消失，缩到极限时整屏是黑的（用户侧「缩小到能显示
 *    节点」那段）。现在淡出的是**细线**，底色必须还在；
 *  · `ZoomIndicator` 的限幅取自用户设置（`minZoom` / `maxZoom`），不是写死的；
 *  · `CanvasRulers` 的标签步长按「屏幕间距 ≥ 48px」现算 —— 不这么算，缩小后
 *    标签会重叠成一片糊字。
 *
 * 所以下面按**缩放档**摆，而不是按组件摆：三块要看的都是同一件事（缩放变了，
 * 它们跟着怎么变）。
 */
const meta = {
  title: "Studio/Canvas/Decorations",
  component: CanvasGrid,
} satisfies Meta<typeof CanvasGrid>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 三块装饰层一起挂在真画布上（`ZoomIndicator` / `CanvasRulers` 自带定位）。 */
function DecoratedCanvas({
  sceneName,
}: {
  sceneName: "twoNodes" | "zoomedIn" | "zoomedOut";
}) {
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
 * 缩到细网格淡出阈值之下（`GRID_FINE_FADE_ZOOM = 0.3`，这里 0.25）。
 *
 * 这一档是那份事故的现场：**细线淡出、底色留下**。底色没了 = 整屏黑，
 * 而那是「画布到底渲染出来没有」的唯一直观凭据。
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
        <CanvasGrid
          settings={{ ...DEFAULT_CANVAS_SETTINGS, showGrid: false }}
        />
        <CanvasRulers />
      </StorybookFlowCanvas>
    </div>
  ),
};
