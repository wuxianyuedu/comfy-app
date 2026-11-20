## Fixed

- **comfy-cli 1.26.0 起拒绝 `--client-id` 与 `--wait` 同用，所有走 comfy-cli 的生成
  在提交后 ~2s 即失败**（`client_id_rejected`，reason=wait）。提交参数不再下发
  `--client-id`（`--wait` 是进度/收口流水线的承重参数，保留）；ComfyUI 侧对账改用
  cli 在 `queued` 事件里回报的自生成 `client_id`，由提交成功日志行带出
  （「✓ comfy-cli 已提交（prompt_id: …，ComfyUI 侧 client_id: …）」）。
