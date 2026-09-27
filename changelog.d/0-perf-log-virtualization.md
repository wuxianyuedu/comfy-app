## Fixed

- 执行/运行日志弹窗（`GlobalStepLogPanel`、`WorkflowRunLogModal`）接入 `VirtualLogList` 虚拟滚动，最多 300 行不再一次性挂进 DOM（规范 §2.6：大列表必须虚拟滚动）。新增共享组件 `src/components/studio/logs/VirtualLogList.tsx`，复用 `log-virtual` 的行高/窗口纯逻辑计算，并内联「跟随底部」最小语义（离底阈值复用 `use-scroll-follow` 导出的 `NEAR_BOTTOM_PX`），替代两处此前各自的非虚拟 `.map` 渲染与 `useScrollFollow` 调用。
