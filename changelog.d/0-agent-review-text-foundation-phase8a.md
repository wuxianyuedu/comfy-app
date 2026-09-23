## Added

- **AI 评审地基（Phase 8 · P8-1a）——对已生成的文本内容（分镜镜头 / 角色卡）做机器质检，
  不合格可「抽卡」或「改提示词重新生成」**：统一生产流水线跑完后，内容好不好此前只能靠人看，
  AI 无法自我把关，也就谈不上「跑完→质检→自动返工」。这一片补上「评审 + 重生成」的**后端地基**：
  - `src/lib/production/review-types.ts`（纯逻辑）：`ReviewVerdict { pass, issues[], suggestion,
scoredAt }` 判定模型 + `ReviewMode = "gacha" | "reprompt"` + 宽容解析 `normalizeReviewVerdict`
    / `getRecordReview` + 通用写回 `applyReview`（按记录 id 命中，镜头与角色卡共用一个 reducer，
    与 `applyShotRedo` 同口径）。判定挂在实体记录上（`shot.review` / `character.review`），随
    `production` 的 JSON 列持久化，新增字段无需迁移。
  - `src/lib/production/sync.ts` 加 `applyReprompt`：先换镜头 `prompt` 再复用 `applyShotRedo`
    退回（清产物 + rev 自增），让规划器把它重新纳入待办、用新提示词重跑（§12.18 不重抄退回语义）。
  - `src/lib/llm/prompts.ts` 加 `buildReviewMessages` / `buildShotRepromptMessages`（复用既有
    `LLMMessage` 形状，与解析侧同文件收口）。
  - `src/server/agent/review.ts`（server-only）：`reviewContent`（读 production → 提炼待评审文本
    → `completeLLMStructured` 出判定 → 归一 → 写回内容列）与 `regenerateShot`（gacha=同提示词换种子
    退回，reprompt=未给新提示词时据 `shot.review` 让模型改写再退回）。**只写内容列、不碰 run**
    （字段所有权）。
  - tRPC `run.reviewShot` / `run.reviewCharacter` / `run.regenerateShot` 三个端点接上执行器。
  - 范围界定：本片只做**文本评审**（镜头 / 角色卡）与重生成动作的落库原语；镜头图 / 成片视频的
    评审依赖多模态地基（当前 `LLMMessage.content` 是纯 `string`，无视觉通道），留待后续；视图层的
    「评审」按钮、抽卡/改提示词交互，以及把评审接进自主 run 循环（跑完自动质检、不合格自动返工），
    在后续 PR 接线。`regenerateShot` 只把镜头退回（rev 自增），不主动起 run —— 是否立即重跑交给调用方。
