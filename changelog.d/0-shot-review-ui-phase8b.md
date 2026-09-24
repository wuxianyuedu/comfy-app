## Added

- **AI 评审接进项目界面（Phase 8 · P8-1b）——分镜镜头行一键「评审」，不合格弹窗内「抽卡」/「改提示词重生成」**：
  P8-1a 落的是评审后端（判定模型 + LLM 结构化评审 + 重生成落库 + tRPC 端点），但没有可点的入口。
  本片把它接到成片工作室的「分镜列表」上，让统一项目跑完的镜头能被就地质检、不合格就地返工：
  - `src/lib/production/run-client.ts` 加 `reviewShot` / `reviewCharacter` / `regenerateShot` 三个薄封装
    （视图/hook 不碰 vanillaApi，§17），统一走 `run.*` 端点。
  - 新增 `src/components/agent-run/hooks/use-shot-review.ts`：评审 / 重生成的执行态收口 —— 评审在途用
    `beginStaleRun` 作废守卫（弹窗中途关闭即不落地，§16.2.4.34），重生成用 `useBusyAction` +
    `runAsyncAction`（忙碌位绑 finally、成功/失败都有可见 toast，§16.2.4.71 / §16.2.4.30），成功后回调刷新。
  - 新增 `src/components/agent-run/ShotReviewDialog.tsx`：`ui/dialog` 受控弹窗（P9 不自绘浮层），打开即评审，
    展示「过 / 不过 + 逐条缺陷 + 改进建议」；不合格才给「抽卡重生成」「改提示词重生成」两个出口，另留「重新评审」。
  - `FilmStudio.tsx` 项目镜头行加「评审」按钮（与既有「退回」并列）→ 打开评审弹窗；重生成成功后
    `reloadProjectShots` 刷新左栏（镜头已退回、rev 自增，下次执行会重出）。`use-film-studio` 暴露 `reloadProjectShots`。
  - 范围：本片先接「分镜镜头」评审（用户列的第一项、且抽卡/改提示词到镜头重生成的映射最直接）；
    角色卡评审的 tRPC/客户端已就绪，UI 入口与「评审接进自主 run 循环（跑完自动质检、不合格自动返工）」
    在后续 PR 接线；镜头图 / 成片视频的视觉评审依赖多模态地基，仍是后续。

## Tests

- 新增 `use-shot-review.test.ts`（评审成功/失败/无项目、重生成成功回调/失败 toast，5 例）；
  `run-client.test.ts` 补 reviewShot/reviewCharacter/regenerateShot 透传断言（含 gacha 不带 newPrompt 分支）。
