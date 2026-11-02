## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 10：
  `src/components/studio/project-home` 清零（35 处 / 2 份）**（ISSUE #2776 /
  #2917）：剧集组织器一族 —— 业务 hook（use-series-organizer：
  `seriesId` / `seasonId` / `episodeId` 的 `string | null` 显式判空 14 处、
  `projectId?: string` 的 `!== undefined && !== ""` 一族、React Query
  `enabled:` 7 处由 `!!x` 改显式判）与视图（SeriesOrganizer：
  `projectId` / `c.seriesId` / `c.seasonId` / `c.episodeId` 的 JSX 条件
  渲染显式判空 11 处）。
  - 口径与前几批一致：`string | null` → `!== null && !== ""`；
    `string | undefined` → `!== undefined && !== ""`；同文件同字符串多处
    按缩进分组批量替换后重拉复核。
  - 实测口径说明：清单记 35 处，实测 35 处 / 2 份，处数一致，份数以实测
    为准。
  - 验证：`src/components/studio/project-home` 该规则复测 0 残留（改完后
    重拉复核）；该目录 1 份测试 4 用例全绿。eqeqeq 台账 0 新增、oxlint
    禁用台账 0 处。
  - 剩余总量见 `log/tools/sbe-remaining-2026-11-02.md`（批 12 收尾时统一
    核账为 550 处 / 219 份）。
