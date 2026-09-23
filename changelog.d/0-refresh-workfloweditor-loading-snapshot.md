## Fixed

- **刷新过期的 `WorkflowEditorInner` 加载态快照**：P67 治理把加载态 Spinner 从「手抄 `<span animate-spin>`」迁到 shadcn/lucide `<svg>` 基元，改到了 `WorkflowEditorInner` 的加载态渲染，但当时没同步这张消费方快照，导致它在 master 上长红。本次用 `vitest -u` 重新采集，diff 仅为该 Spinner 标记结构变化（无其它语义改动）。非源码缺陷修复，纯快照与现状对齐。
