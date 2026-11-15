## Fixed

- **production 行的并发写不再互相覆盖 / 撞主键**（ISSUE #3832）：
  - `syncFilmToProject`（成片合成回写）原先把**整行读出的旧快照**全部内容列写回 ——
    合成期间工坊自动保存 / run 引擎 / 评审器对剧本、角色、镜头的修改会被回滚成
    旧值。现在改走 `patchShotsAndProgress`，只回写成片链路自己拥有的
    `shots` / `progress` 两列。
  - `production.upsertForUser` 从「先查后插/改」改为单语句
    `onConflictDoUpdate`（主键为冲突目标）：自动保存双触发、MCP 桥接与保存
    赛跑时，并发首存不再让后到者撞主键 500。
  - `PUT /api/production` 的「读 existing 继承衍生字段 → 写」收进
    `behavior: "immediate"` 事务（与 `saveLlmSettings` 同一形状，§18.10.1），
    丢失更新窗口关闭。
