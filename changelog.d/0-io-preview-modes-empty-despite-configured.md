## Fixed

- 修复 IO 预览面板错误提示「该工作流还没有配置模式」：服务端
  `buildWorkflowDetailFull` 下发的详情 JSON 仍使用旧键 `modes`，而客户端
  `WorkflowDetail` / `WorkflowDetailFull` 接口与 UI 已统一读取
  `availableModes`，导致 `detail.availableModes` 始终为 `undefined`、
  面板判断 `modes.length === 0` 命中空状态。现在服务端输出与客户端读取
  均使用 `availableModes`，`WorkflowEditorInner` 的本地乐观更新也同步写对字段。
