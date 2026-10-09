## Added

- **提交信息里的机械可核声明 ⇄ 这次提交的树事实，有了执行者**（规范 §11.23.5 / ISSUE #1605）。`ad81a912`（PR #1580 的 squash）的提交信息原文自称「master 新增的 §13.5.13 / §13.6.3 两节与各处插记照旧保留」，而那次提交的树里**两节一次都不出现** —— 一句反事实的陈述，从写下到进 master，经过的每一道关都不看它（平台侧 squash 不跑本地钩子、ISSUE #623 后也无 CI 兜底）。同一形态连着发生三次（`ad81a912` / `bdabd26f` / `b9bedd37`）。
  - 新判据 `scripts/check-commit-claims.mjs` 只核**一格、且窄到零歧义**：认 `§<章节号> … 照旧保留 / 原样保留 / 照原文保留` 这一种句式，核「该章节号是不是**这次提交的树**里某份规范文档的一个标题」。纯 `grep`。
  - 三条避免误报的口径都是**对着真提交信息**定的（全仓 500 条提交里只有 1 条命中，就是立案现场）：① 引号里的复述不算声明（`1f629434` 引用致罪那句并当场反驳它）；② 裸「保留」不算（`b3bf69fe` 的「保留共有段落」是解冲突叙述）；③ 「保留」的宾语必须是那一节（`23bc80da` 的「§3.6.1 的 p71-allow 例外块照原文保留」说的是那个块）。
  - **不进钩子**（本地看不到平台侧 squash），按 §13.5.4 的按需召唤那一层跑：`pnpm check:claims` / `node scripts/check-commit-claims.mjs <sha>`。退出码三态与 `base-check.mjs` 同口径：`0` 无相反声明、`1` 声明与树事实相反、`2` 没跑起来（与「跑了且红」分开）。
  - 登记进 §11.23.3 的声明 ⇄ 读者索引（`commit-message-claims`）；索引判据 `check-declaration-readers.cjs` **新增 `npm-script` 执行者类型**（入口名不在 `package.json` 的 `scripts` 里即红）。

## Tests

- `tests/commit-claims-gate.test.ts` 8 条（进 C 组固定清单）：立案现场形态、为真放行、引号复述、裸「保留」、宾语不是那一节、多 §号共享一个「照旧保留」逐个数、取不到提交退 2、`--report` 恒 0。
- `tests/declaration-readers-gate.test.ts` 新增 3 条：`npm-script` 入口被删 / `package.json` 解析不出 / 未知 `executor.kind`。

## Docs

- 规范 §11.23.5 新增（载体的一种：提交信息里的机械可核声明）、§11.23.3 索引表加一行、§13.6.2 补「与 `--base` 的分工」一段。
