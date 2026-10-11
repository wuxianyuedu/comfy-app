## Fixed

- **刷新工作区后用户被踢回首页（页签恢复被落盘反冲）**（ISSUE #1501 / #1727）。
  `useWorkspaceTabs` 的「恢复」与「落盘」是两个 effect、跑在同一个 commit 里：
  恢复只 `setTabsState()`（下一轮渲染才生效），而落盘拿到的仍是这一轮的**初始态**
  （只有首页一页），于是把 `sessionStorage` 里存好的页签列表原样冲掉。现场是
  「`localStorage` 的 active-id 还在、`comfyui*` 项目页签却没了」——`openableViews`
  只在 `activeProjectId` 非空时列项目类视图，用户因此被踢回首页。
  判据从「恢复跑过没有」（一个拦不住落盘的布尔量）改成「这一轮要落盘的 state
  是不是已与存储对过账」：`hydrated` 作为**状态**承载，恢复落地那一轮渲染才为真，
  落盘天然只发生在对账之后。新增 `use-workspace-tabs.test.ts` 两条（含 StrictMode
  双挂载那条正是本缺陷的复现条件，反向验证过：改回旧写法必红）。
- **主链路 E2E 的终态判据把 `QUEUED` 当成结论**（ISSUE #1727）。
  `e2e/main-journey.spec.ts` 两条用例此前用 `expect.poll(...).not.toBe("RUNNING")`
  等任务收口 —— 而那一句对 `QUEUED` 也成立，提交后任务正在排队时 `poll` **立刻放行**，
  随后断言 `SUCCEEDED` 必红。报出来的是「终态不是 SUCCEEDED，error=无」，看起来像
  执行链路断了，其实执行器跑得好好的。判据改成「**已到终态**」，
  取 `src/lib/task-state.ts` 的唯一出处 `isTerminalTaskStatus()`，不在用例里再抄一份。

## Tests

- `e2e/model-library.spec.ts` 的页头期望名从「模型库」改成注册表口径的「模型」
  （`NavItems.tsx` 的 `label`、`viewLabel` 缺省；由 `tests/page-name-single-source.test.ts`
  守着）。此前那个名字是路由 `metadata.title` 里的字、不是 `h1` 里的字。
- `e2e/critical-flows.spec.ts` 的虚拟滚动 spacer 算式改为引用模块常量
  `LOG_ROW_SINGLE`（它从 27 改到 28 时这里漏改，报「期望 54000、实际 56000」）。
- `e2e/overlay-entries-as-views.spec.ts` 两条锚点跟随 `#1423` 的重排：区块小标题
  改成 `SectionLabel`「短名 + hint」之后，锚短名（`远端模型` / `选择要配置的模式`），
  不再锚被拆掉的长句。
- 全套 `--grep @critical` 69 条实跑全绿（此前 13 红）。
