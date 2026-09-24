## Added

- **角色卡 AI 评审接进工坊（Phase 8 · P8-1b 续）——角色卡行一键「评审」，弹窗展示判定 / 缺陷 / 建议**：
  承接镜头评审（#941）与评审后端（#934），把「AI 对生成的角色卡进行评审」这条也接上。角色卡是可直接
  编辑的文本设定（名字 / 外貌 / 服装 / 性格），不合格的修法就是照建议改这些字段、再用既有「定妆照」通道
  重出，故本片只做「评审 + 重新评审」的判定与展示，不另造角色重生成端点。
  - `src/lib/production/run-client.ts` 的 `reviewCharacter`（#941 已加）之上，新增
    `src/components/workshop/hooks/use-character-review.ts`：评审在途用 `beginStaleRun` 作废守卫
    （弹窗中途关即不落地，§16.2.4.34），IO 走 run-client（视图/hook 不碰 vanillaApi，§17）。
  - 新增 `src/components/workshop/CharacterReviewButton.tsx`：自包含「评审」按钮 + `ui/dialog` 受控弹窗
    （P9 不自绘浮层），打开即评审该角色卡，展示「过 / 不过 + 逐条缺陷 + 改进建议」+「重新评审」。
    projectId 取自当前活跃项目（`getActiveId`，与工坊同源）。
  - `CharacterDesigner.tsx` 每张角色卡头部加 `<CharacterReviewButton character={...} />`（与「AI 润色」「删除」并列）。

## Tests

- 新增 `use-character-review.test.ts`（评审成功 / 失败 / 无 projectId / reset）。
