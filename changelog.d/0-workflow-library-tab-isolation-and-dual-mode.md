## Added

- **画布节点页签双模式切换**（编辑对外参数 / 实际使用）：edit 模式展示参数连线画布、禁止执行生成；use 模式隐藏参数编辑、只留表单 + 生成按钮 + 产出结果。

## Fixed

- **两个页签的运行状态与日志互相干扰**：日志入口从共享的详情头部下沉到各页签内部（画布节点按 `source="canvas-node"` 过滤、工坊封装按 `source="encapsulation-test"` 过滤），不再合并显示；画布节点页签的 resume 逻辑也按 source 过滤，不会误恢复到工坊封装的运行上。`latestRunForWorkflow` 与 `WorkflowRunLogModal` 新增可选 `source` 参数。
