## Changed

- **回退 `Dependabot triage (mirror)` 的 push 触发，恢复每日定时 + 手动两口（ISSUE #4444）**：这一格是把镜像仓 Dependabot open 告警聚合成 CNB 单的**每日对账口**，告警面由 GitHub 依赖图在 push 后异步重算，Actions 起跑快于刷新——push 触发那一跑多半读到旧面、新生告警读不到，只会空转。#4433 按「改了 src-tauri 没触发」的诉求加的 push 触发，经单子作者复核属误解，回退。
