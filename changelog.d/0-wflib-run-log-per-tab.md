## Changed

工作流库「执行日志」入口从详情头部统一一处改回各页签独立：画布节点页签与工坊封装页签各自在本页签这一排放入口按钮，并分别带 `canvas-node` / `encapsulation-test` 来源过滤（与运行登记表 `WorkflowRunSource` 同款口径）。详情头部不再集中放置统一入口；全屏日志弹窗仍按来源如实标注。同步更新 `WorkflowLibraryLayout.test.tsx` 断言与 `docs/guides/feature-workflow-library-flow.md` 及其生成副本。
