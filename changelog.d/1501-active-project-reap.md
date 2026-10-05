## Fixed

- **新建画布项目后刷新一下就被踢出项目上下文，「＋」菜单里的六个项目页签全没了**（ISSUE #1501）。根因在挂载时的空草稿清扫：首页「新建画布项目」走 `createProject()`，它**立刻**往项目索引落一行「零节点零连线 + 名字 = 未命名」的记录并设 `active-id` —— 这一行**正好命中**空草稿哨兵（`EMPTY_DRAFT_NAME`），于是刷新时工作区页面挂载即调的 `reapAllEmptyDrafts()` 把它当历史遗留的空草稿清掉，`active-id` 跟着被清，而 `openableViews` 只在 active 非空时才列项目类视图 ⇒ 菜单从 11 项退回 5 项。
  - 判据收成一处 `isReapableEmptyDraft(project, activeId)`，「回收一条」（`reapEmptyProject`）与「清扫一批」（`reapAllEmptyDrafts`）共用它 —— 此前两处各写一遍、已经漂过一次。新加的闸只有一条：**当前活跃项目一律不可回收**（用户此刻正站在里面）。「它是不是空草稿」与「它能不能删」是两件事。
  - 顺带把 `useProjectPersistence.persistNow` 里那段的**顺序**反过来：此前先 `clearActiveIfDraft` 再 `reapEmptyProject`，于是回收被拒时 active 已经被清了，界面留下「项目还在、上下文没了」的半截状态。现在是「回收成功才清 active」，两件事一起做或一起不做。
  - 另一半是孤儿行：`reapAllEmptyDrafts` 此前直接 `writeIndex(survivors)` 就算完事，**不经过 `deleteProject`** ⇒ 每清一条都在服务端留下永久的一行（界面读的是客户端索引，再也指不回它）。那几行 `未命名` / `未命名_2` / `未命名_3` 就是这么攒出来的。现在逐条走 `deleteProject`，本机与服务端一起删。

## Tests

- `src/lib/project-canvas/canvas-store.test.ts` 新增两组：活跃项目不可回收（批量清扫不动它、也不清 active；同批的非活跃空草稿照旧被清；`reapEmptyProject` 对活跃项目返回 false；`createDraftProject` 的草稿本来就不在索引里），以及清扫要连服务端一起删（每条被清的空草稿各发一次删除、没得清就一条都不发）。
- `src/components/studio/project-canvas/hooks/use-project-persistence.test.ts` 新增一组，钉住「先问能不能收，再决定清不清 active」这个顺序（回收被拒时不动 active）。
- `e2e/project-context-refresh.spec.ts`（新建，`@critical`）：真浏览器里判「新建 → 刷新 → 六个项目页签仍在「＋」菜单里」，外加一条直接读 localStorage 的（`active-id` 与它对应的索引行都还在）。**两条都核过变异**：把 store 的修复摘掉跑 → 两条同时红。
