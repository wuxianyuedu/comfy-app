## Added

- **生图视觉评审（FR-QA-07 ⑤ · #2479 · P8-2）**：LLM 层加多模态消息形态——`LLMMessage.content`
  支持文本块 + 图块数组，`messagesToWire` 按 provider 分派（OpenAI 兼容 content 数组 /
  Ollama 消息级 `images`），视觉模型走独立通道 `getVisionLLMConfig`（可配远端
  `kind=image` 模型或回落主模型，Ollama 多模态模型即此形态）。生图后按生图 rubric
  （与提示词对齐 / 角色一致性对照定妆照 / 构图景别 / 画面瑕疵）**看图打分**，判定写回
  `shot.imageReview`（与文本 `shot.review` 分开存、各打各的分）。自动 run 的 `review_shots`
  升级为「文本 + 图」双裁判——图没过 = 不过，不合格走 `gacha` / `reprompt`，达
  `REVIEW_MAX_RETRY` 上限转人工。新增 `run.reviewShotImage` 过程。
