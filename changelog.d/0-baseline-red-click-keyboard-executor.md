## Fixed

- **收掉两处「别线的红」——本 PR 不引入，但硬闸堵着所有人的提交**（复算证据：在干净的 `origin/master` 提交上跑 `node scripts/base-check.mjs "判据执行者台账"` 与 `pnpm exec tsc --noEmit`，命中完全一致）：

  - **`check-click-keyboard.cjs` 有判据、没执行者，5 处站点长期红着**：这条「鼠标点得开、键盘点不开」的棘轮（§6.11）写好、基线清零、UI 也收口过，却**从没接进任何一步** —— 于是它自己那 5 处站点（`MessageCenterPanel` / `DebugChainFooter` / `HistoryTaskCard` / `MultiModeSelect` / `AttributeMultiSelect`）与 3 条用例一起红在那里而无人知，正是「判据在场但跑的是 0 个用例」的同一味药。现在两件都补上：**5 处站点按语义修掉**（整行/整块可点 → 原生 `<button>`；ARIA 的 `checkbox` / `option` 行 → `simpleKeyHandler`，§16.2.4.57 的唯一出口），**判据接进 pre-commit D 组**。原生按钮那几处**不再**挂 `simpleKeyHandler` —— 那会复刻浏览器默认行为，正是这条账要消除的形态。

  - **`check-deps-freshness.mjs` 同样零执行者**（ISSUE #1569 落下的）：接进 D 组，用它的 `--staged` 档（只在暂存改了 `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` 时判定，实测 0.4s）。判据本身**绝不 `fetch`**（网络不进钩子，§13.5.4），所以这一步不会把「离线 / 远端抖动」变成提交失败。

- **`tsc --noEmit` 在 master 上恒红（3 条报错）**：`tests/task-list-wire-contract.test.ts` 引用的 `videoTaskRowSchema` / `parseVideoRows` / `historyTaskRowSchema` 在合并后的树上不存在 —— ISSUE #1579 的**服务端与客户端两半在合并时掉了，判据那半留下了**（同一形态：**能力落了一半，而没有任何判据会喊**）。这 3 条报错同时让 `pnpm docs`（typedoc 走 tsc）整条不可用，而 `docs/api/**` 是提交进 git 的判据产物 —— 等于**所有人的 API 文档同步都停摆**。这次把它补齐：`task.list` 投影补发 `videoPath`（封面是预览图时 `cover` / `mediaType` 都答不出成片在哪；服务端才答得了这一列）、客户端按线上真实列改写成 zod 镜像 + `parseVideoRows`（缺 `videoPath` 的那行**整行判掉**、不补兜底 —— 补了就把契约分叉抹成「每个任务都没有视频」），`historyTaskRowSchema` 导出给判据读。

## Tests

- `src/components/message-center/MessageCenterPanel.test.tsx`（3 例，此前红）、`src/components/studio/history/HistoryTaskCard.test.tsx`（2 例，此前红）：`Enter` 能打开详情 / 标记已读，删除按钮是行按钮的**兄弟**（不嵌套 → HTML 合法、各自可 Tab）。
- 两处 ARIA 角色行的键盘等价物由 `check-click-keyboard.cjs` 自身判（0 处 ≤ 基线 0 处）。
- `tests/task-list-wire-contract.test.ts`（12 例，此前整份因 tsc 报错跑不了）：镜像声明的每一列线上都在发、少发 `videoPath` 时整行判掉、真 router → 传输 → 客户端往返。
- 队列三份夹具按**契约**补 `videoPath: null`（`QueueRow` 由 router 输出类型推导，投影加列即夹具必须补齐）。
