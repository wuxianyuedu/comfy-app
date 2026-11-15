## Fixed

- 工坊会话 stage 游标可倒退（#3902）：新增 `advancePipelineStage`（`lib/workshop/types`，
  单调序取更靠后一格），`setScript` / `setCharacters` / `setStoryboard` / `generateScript` /
  `extractCharacters` / `buildStoryboard` / `composeFinal` 的阶段写入全部改走它 ——
  会话已到 `final_edit` 后补调前面的 set* 工具不再把游标拉回去。
