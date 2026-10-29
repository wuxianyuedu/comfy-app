## Fixed

**`ship` 轮询在「按 sha 查不到 build」时读出 PR 的 `mergeable_state` / `blocked_on`（ISSUE #2645）**。

### 症状（为什么要改）

CI「没起」与「红了」在读数上长得像——`pnpm ship` 两种都停在 exit 2 / exit 1。
那一轮（`eslint-gate-canary` 那批）我按「流水线没派生」排查了很久（换分支名、推空提交），
真正的因是 **`mergeable_state=conflict` / `blocked_on=code_conflict`**：冲突的 PR 平台
不派生构建。下一个人还会照着这个顺序踩一遍。

### 做法

`pollUntilTerminal` 在 `!picked`（按 sha 还没解析到 build）那一格、给了 PR number 时，
顺带读一眼 `cnb pulls get-pull` 的 `mergeable_state` / `blocked_on` 打到结论里；冲突时
明确念一句「平台不跑 CI，先 `git fetch` + 合上游解冲突、推新 sha，别干等」。只念一次
（`announcedPrState`），没给 number 时不发这一问（兼容只轮询、还不知道 PR 号的形态）。
`ship.mjs` 把建/复用 PR 的 number 透传进去。

### 验收

- `tests/ship.test.ts` 的 `pollUntilTerminal` 描述新增两条：PR 冲突念 conflict 提示且每轮
  只念一次、PR 可合并只念 `mergeable_state` 不报冲突；整份 267 全绿。
- 真值出口：`get-pull` 只读 `data.*`，与 `reportVerdict` 同一份 `readPullVerdict`，
  不代写平台原话。
