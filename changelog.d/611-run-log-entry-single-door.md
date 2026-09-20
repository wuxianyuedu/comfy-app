## Fixed

- **执行日志入口收敛到详情头部一处（补齐 #611 未做完的那一半）**：`WorkflowRunLogButton` 的文件头注释与 #611 的变更日志都写着「入口上移到详情头部、两个页签共用」，但实现只做了一半 —— `DetailHeader` 里根本没有渲染入口，而「画布节点」与「工坊封装」两个页签各自还挂着一个（连带各自的 `logOpen` / `logTaskId` 状态与一份全屏弹窗）。结果是同一扇门仍有三处（其中两处还随「进了哪个页签」变化），而 `WorkflowLibraryLayout.test.tsx` 的两条断言（头部要有 `wflib-log-open`、两个页签里不许出现 `WorkflowRunLogButton`）长期为红、也没登记进 `KNOWN_FAILED_FILES`。现在入口收在详情头部那一排（「删除」之后，「没跑过」时也渲染、点开是空态文案），弹窗只留一个且**不按来源过滤** —— 入口只剩一处，再按 `source` 分两个门就等于又把门变回两处。
- 两个页签里的入口、`logOpen` / `logTaskId` 状态与各自的弹窗一并删除；`WorkflowCanvasNodePreview` 的两个测试里对 `WorkflowRunLogModal` 的 `vi.mock` 随之删除（该文件已不再引用它）。
- 文档同步：`docs/guides/feature-workflow-library-flow.md` 的运行链路图里「全屏执行日志弹窗（两个入口同一扇门）」改为「入口只有详情头部一处」。
