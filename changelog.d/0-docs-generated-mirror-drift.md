## Fixed

- **补回两份「生成态文档」镜像：`docs/generated/11-测试与可观测性.md` 与
  `docs/generated/13-提交与-code-review.md`** —— 它们落后于各自的源，是主干上带的红，
  不是本批写出来的：`pnpm doc:render` 之后 `--check` 在 `cnb/master` 顶端 `dd4ec873`
  上直接报这两条（复算入口：`node scripts/render-doc-placeholders.cjs --check`，只读、
  不写盘）。成因是 #2110 那批改了 `docs/standards/11-*.md` / `13-*.md` 的正文，
  而 `docs/generated/**` 那一份没跟着重渲染进同一次提交。
- **为什么这一族会漏**：本地钩子不跑这条（ISSUE #1975 那批的处置：判据一字未改、只换执行者），
  所以「改了源、镜像没改」在提交时**不会有任何反应**。而平台那格
  `生成态文档与源同步` 跑的是 `--check --autofix`（`scripts/ci-heavy-gates.mjs` 里那条，
  合进 `重档静态判据` 那一格）—— 它会**就地修好再判**，于是那份红在这一格里被自动吃掉、
  根本不出现。真正把它照出来的是 `受影响用例` 那格里的
  `tests/check-doc-references.test.ts`「绿的时候不多写」：它守的正是「判定通过时一次都不许写盘」，
  而镜像落后会逼自动修档去重渲染，于是**别人的红**在**你的 PR** 上长成一条断言失败。
  本批就是这么撞上的。
- 顺带确认 `prettier 格式` 那一格与这两份镜像无关：它的 `ifModify` 只有 `src/**` 与
  `.storybook/**`，跑的是 `scripts/check-format.cjs`（不扫 `docs/**`）。
