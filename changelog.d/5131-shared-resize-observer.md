## Changed
- 布局量测收敛到共享 ResizeObserver（#5131）：`TruncatedText` / `useElementBox` 此前每个实例各自 new 一个 ResizeObserver 并各排一次 rAF，长列表里 N 个实例就是 N 个观察者与 N 次帧调度，窗口缩放 / 侧栏折叠时同帧各自触发一次量测。新增 `~/lib/dom/shared-resize-observer`：模块级单 observer 持有 Element → 回调集合，一批尺寸变化只排一次 `onNextFrame`；全局构造器变化（测试桩 / HMR）时重建单例，无 ResizeObserver 环境退化为只做首帧同步量测。两个消费点的挂载首帧同步量测语义保留不变。同批补"1 个 observer、一批 1 帧、注销后不再回调"与退化路径用例。
