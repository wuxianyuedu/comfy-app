## Fixed

- master 的 `docs/generated/launch-and-build.md` 是**手写**的（多删了一行），于是
  `pnpm doc:render --check` 在**每个 PR** 的「受影响用例」那一格都判红
  （`tests/check-doc-references.test.ts` 内部跑 `--check --autofix`，第一遍就红）。
  `0a03628d`（#2197 / PR #2330）同批提交了源与生成态，但那份生成态是手写的：
  它把源文档开头那段「占位符约定」说明**整段四行**都删了，而
  `scripts/render-doc-placeholders.cjs` 的 `stripPlaceholderNote()` 只剥前三行
  （第四行 `> pnpm doc:check 检查本文是否有值未同步。` 是独立一句，不在那个正则的
  匹配范围里）⇒ 手写删多了，与脚本自己的渲染结果差一行。
  这次让脚本自己算：跑 `pnpm doc:render` 重渲染 `docs/generated/**`，
  33 份生成态与源全部一致，`render --check` 退 0。
