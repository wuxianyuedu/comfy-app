## Added

- **RunControlBar 加「生图后自动评审」开关（Phase 8 · P8-1c 续）**：自动评审循环（#944）此前只能经
  CLI `--auto-review` 或 `run.start` 入参开启，应用内点不到。在画布 / 工坊共用的 AI 控制条启动面板上，
  于「确认粒度」旁加一个复选框「生图后自动评审」，勾选后启动的 run 会走「生图 → 逐镜 AI 评审 → 不合格
  自动抽卡重生成（换种子，有界重试）→ 出片」的自纠错流程。
  - `use-agent-run`：`AgentRunController` 加 `autoReview` / `setAutoReview` 态，`start()` 把它带进
    `run-client.startRun`（→ `run.start`）。
  - `RunControlBar`：启动面板加 `ui/checkbox` 的 `Checkbox`（不自绘，P68 合规），点选回抛 `setAutoReview`。

## Tests

- `RunControlBar.test.tsx` 补一例：idle 面板渲染「生图后自动评审」复选框，点选回抛 `setAutoReview(true)`。
