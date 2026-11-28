## Fixed
- 逐镜 TTS 任务生成与监看回写（ISSUE #5244，收口 #5213 剩余）：建片入口可配 `ttsWorkflowId`，提交视频时给有 `ttsParams` 的镜头起 T2S 任务，瞬时故障按 `shouldRetryTts` 重建、业务失败不重试；监看每轮跟音频任务，成功把产物写回 `filmShot.params.audioPath`（成片合成据此混音），失败只清任务 id 与记 warn，不改视频镜头状态。补 5 条建任务/重试/回写用例；产品 FR-QA-06 同步更新。
