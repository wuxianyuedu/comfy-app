## Changed

format-bot 红路径端到端实测（ISSUE #2358，业主指示；#2342 只实测过绿路径）：
在 `src/lib/safe-name.ts` 故意引入一处纯格式违规（`replace` 逗号后去空格 ——
tsc / eslint / 用例均无感，只有 `prettier 格式` 一格会红），观察平台上
`ci-format-fixup.mjs` 是否按设计完成「红 → 就地修 → 复判 → bot 推 format-only
提交回 PR 分支 → 流水线重跑」。本 PR 自身的判读读数记录在 #2358 关单评论里；
对 master 的净效果为零（bot 修复提交恰好抵消本笔的格式违规）。
