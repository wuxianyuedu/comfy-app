## Changed

「编辑对外参数」页签不再展示上一次运行的结果图；运行结果只在「实际使用」页签显示。

- `WorkflowCanvasNodePreview` 的运行结果图渲染条件新增 `viewMode === "use"`，与
  已有的「失败提示只在实际使用页签显示」规则保持一致。
- 编辑对外参数页签是配置界面，保留运行按钮的禁用提示与进度，但隐藏结果图，
  避免配置时被打扰或误判为已执行。

涉及文件：`src/components/studio/workflow-library/WorkflowCanvasNodePreview.tsx`、
`src/components/studio/workflow-library/WorkflowCanvasNodePreview.result-image.test.tsx`。
