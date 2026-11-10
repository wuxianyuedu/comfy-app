## Changed

- **设置页改为即时自动保存（ISSUE #3508）**：删除本地模型（LlmLocalSection）、创作后端（ComfyuiSection）、退出与后台服务（ExitSection）三处显式「保存 LLM 配置 / 保存偏好」按钮，与已即时落库的远程模型、外观分区体验对齐。
  - 文本输入：失焦即落库（`saveLlm` / `savePrefs`，成功静默、仅报错提示，用户决策）。
  - 离散控件（模型下拉、候选勾选、开关、CPU 档位单选）：切换即落库（新增 `commitLlm` / `commitPrefs`；`toggleExtraModel` 改为即时持久化）。
  - 新增 `persistLlmDraft` 的 `silentOk` 选项；`savePrefs` 支持传入 `override` 草稿并返回保存结果。
  - 远程模型弹窗的「保存 / 添加并保存」提交按钮按用户决策保留，成功仍弹提示条。
