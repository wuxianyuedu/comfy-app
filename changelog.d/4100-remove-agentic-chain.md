## Removed

- 退役零生产消费方的 agentic 链路（chatAgent / expandIdea / 离线状态机）：Agent 对话已由 `/api/agent/chat`（`lib/agent/server.ts`）承接，画布 agent 节点的渲染链登记同批改为只显示公共链路（#4100）
