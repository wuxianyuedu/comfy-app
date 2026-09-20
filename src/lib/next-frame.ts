// ── 「等一帧再做事」的唯一出口（规范 16 §16.2.4.42）────────────────────────
//
// 按**形态**扫描时撞出来的账：全库有八处写「先让 React 提交 / 浏览器布局，
// 下一帧再读 DOM 或算视口」——而它们对同一件事各判各的：
//
//   · `WorkflowEditorInner` 的「重新居中」按钮：`requestAnimationFrame(() =>
//       fitToContent())` —— 裸的一帧，**没有**可取消的句柄（它挂在
//       `useCallback` 里，本就接不下清理）；
//   · `CustomNodesSettings` 的三处滚动定位（错误行、解析开始、单包完成）：
//       同样是裸的一帧，且都写在 `useEffect` 里 —— effect 重跑时上一帧
//       仍会落地（往已经翻走的面板上滚一次）；
//   · `ui/json-viewer` 的高亮重注入：裸的一帧（同 effect 重跑问题）；
//     `ui/json-viewer` 的命中居中、`ui/select-menu` 的高亮项入视口、
//     `ui/confirm-dialog` 的确认按钮聚焦：**都带** `cancelAnimationFrame`；
//   · `canvas-helpers` 的 fitView 调度器、`use-workflow-persistence` 的
//       `afterNextPaint`：**两帧**（一帧给 React 提交、一帧给布局），
//       注释各写一遍「为什么是两帧」。
//
// 也就是说 —— **「等多久」与「要不要能取消」取决于它是哪一处写的**：
// 一帧还是两帧、effect 重跑时旧帧落不落地，在同一份代码里同时存在两种答案。
// 这类差异没有报错、没有告警，tsc / eslint 也都不看（都是合法的 API 调用）。
//
// ## 两档，按「等谁」分
//
//   · {@link onNextFrame} —— **等 React 提交 / 浏览器布局完成**。读 DOM 尺寸、
//     聚焦刚挂上的节点、滚到刚渲染出来的那一行，都用它。一帧就够。
//   · {@link afterNextPaint} —— **等浏览器真的画完**。React Flow 这类「先提交
//     数据、再按测量结果摆位」的三方库要两帧：一帧给它收到新数据并提交，
//     一帧给它按新尺寸重排。此前 `makeFitViewScheduler` 与 `afterNextPaint`
//     各写一份，理由各写一遍注释。
//
// ## 两个都**返回取消函数**，这不是可选的讲究
//
// 落点几乎全在 effect / 事件回调里，而 effect 会因依赖抖动重跑 —— 不取消就是
// 「上一轮的延迟动作落在这一轮的界面上」（往翻走的面板滚、给已经换了内容的
// 列表注入高亮）。取消函数要挂到 effect 的返回值上，或在卸载时调用一次。
//
// ## 收什么、不收什么
//
// **收**：一帧 / 两帧两档的调度，与它们各自的取消。
// **不收**：帧循环（`use-fps` 的 `requestAnimationFrame` 自递归是**采样**，
// 不是「等落定」，形态不同）；「延后多久」的域判据（如「等 400ms 再说」是
// 去抖，归各自的域；`~/components/ui/use-interval` 管定时器轮询）。

/** 「等一帧再做事」的两档调度（规范 16 §16.2.4.42）。 */

/** 取消一次已排期的下一帧动作。 */
export type CancelNextFrame = () => void;

/**
 * 等 React 提交 / 浏览器布局完成，再执行 `cb`。
 *
 * 用于「读刚渲染出来的 DOM」这一整类动作：量尺寸、聚焦、滚进视口。
 * 在渲染期或 effect 体里**直接**读 `ref.current` 拿到的是上一轮的布局，
 * 而同步 `setState` 会触发级联渲染（ESLint 的 `react-hooks/set-state-in-effect`
 * 明确禁止）—— 排到下一帧是唯一不需要猜时长的做法。
 *
 * ```ts
 * // effect 里用：返回值就是它的清理函数
 * useEffect(() => {
 *   return onNextFrame(() => elRef.current?.scrollIntoView({ block: "nearest" })); // 滚到最近的边
 * }, [index]);
 * ```
 */
export function onNextFrame(cb: () => void): CancelNextFrame {
  const id = requestAnimationFrame(cb);
  return () => cancelAnimationFrame(id);
}

/**
 * 等浏览器**画完这一帧**（两帧），再执行 `cb`。
 *
 * 比 {@link onNextFrame} 多一帧：第三方布局库（React Flow 的 `fitView` 是
 * 样本）经常是「收到新节点 → 提交 → 按新尺寸重排」两拍，只等一帧会用到
 * 上一份测量结果 —— 表现是「刚展开/折叠过节点时贴合不到位」，而它只在
 * 慢机器上稳定复现。此前这里用 `setTimeout(80ms)` 猜时长。
 */
export function afterNextPaint(cb: () => void): CancelNextFrame {
  let inner = 0;
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(cb);
  });
  return () => {
    cancelAnimationFrame(outer);
    cancelAnimationFrame(inner);
  };
}
