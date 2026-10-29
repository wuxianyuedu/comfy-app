## Fixed

- **补齐落后的 drizzle 迁移快照**（ISSUE #2600）：`db:generate` 一次性补出
  `0001_perfect_sinister_six.sql`——新建 5 张表（`series` / `season` / `episode` /
  `episode_character` / `character`，FR-SR 容器层）与三笔列改动
  （`task.parentId`、`taskImage.humanRating` / `isFavorite`、`workshopSession.projectId`），
  对应快照停更后落地的五笔 schema 提交（#2502 / #2511 / #2543 / #2554 / #2558）。
  `db:migrate` 与 `db:push` 两条建库路不再各说各话。
- **残余已知差异（如实记，待业主拍板）**：等价判据在表/列补齐后仍红在**列序**——
  migrate 路经 `ALTER TABLE ADD COLUMN` 把新列**追加**在表尾，push 路按 schema.ts
  **声明序**建表；SQLite 列序无语义（按名取列），但两条路产不出相同顺序。
  解法二选一（等价判据的比较改列集无序、或接受并写明该差异）需拍板，
  详见 #2600 评论——单子明令不许为变绿改那条测试的口径，故本 PR 不动它。
