/* 画布设置 —— 用户可调的「工作流编辑器画布」偏好，持久化到 localStorage
 *（读写/订阅见 hooks/use-canvas-settings.ts），刷新后仍在、打开新工作流立刻生效。
 * 含网格线透明度/线宽/间距、标尺与小地图显隐、最大缩放限幅。
 * 全部放在同一个扁平对象里，单个 `useCanvasSettings()` 一次往返即可改任意子集；
 * 渲染出口：<CanvasSettingsButton>（右上角齿轮）与 <CanvasSettingsPanel>（右侧抽屉）。 */

export type CanvasSettings = {
  /** 调试 —— 统一的「调试模式」开关。
   * 打开时，画布底部会多出一个独立的执行日志面板（GlobalStepLogPanel），
   * 且每条日志都带上调用方来源（"文件:行"）。
   * 这是用户要的**一个**总开关 —— 不做按节点的日志开关。 */
  debugMode: boolean;
  /** 相邻两条细线之间的世界坐标像素。主线恒落在`gridGap * 10` 处，
   * 保持用户预期的 1:10 比例。 */
  gridGap: number;
  /** 0..1，作用于主参考线（默认每 100px 一条）。 */
  gridMajorAlpha: number;
  gridMajorLineWidth: number;
  /** 网格 (Grid) */
  /** 0..1，作用于细网格线（默认 10px 那层）。
   * 会与 CanvasGrid 的缩放淡出曲线相乘，让线在所有缩放档下都可读。 */
  gridMinorAlpha: number;
  gridMinorLineWidth: number;

  /** 缩放 —— 这两项只在下次挂载编辑器时生效，
   * 因为底层的`<ReactFlow minZoom/maxZoom>` props 在实例化时只读一次；
   * 面板上的文案已写明这一点。 */
  maxZoom: number;
  minZoom: number;

  /** 为 false 时整层 <Background> 直接返回 null。
   * 适合需要干净画布的截图流程。 */
  showGrid: boolean;
  showMiniMap: boolean;

  /** 画布 (Canvas chrome) */
  showRulers: boolean;
};

export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  gridMinorAlpha: 0.22,
  gridMajorAlpha: 0.14,
  gridGap: 10,
  gridMinorLineWidth: 1,
  gridMajorLineWidth: 1.25,
  showGrid: true,
  showRulers: true,
  showMiniMap: true,
  maxZoom: 2,
  minZoom: 0.15,
  debugMode: false,
};
