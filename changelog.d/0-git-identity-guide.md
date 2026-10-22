## Added

- **新增 `docs/guides/git-identity.md`：同一台机器上怎么区分「谁在哪个仓库干的」**（ISSUE #2163）。
  答的是读屏时最常被问住的那一格：`git log` 里 `author` 与 `committer` 不是一回事 ——
  平台 squash 合并会换掉 committer、保留 author，所以能用来区分的只有 `%ae`。
  指南给出 `includeIf` 的两种挂法（按 remote 地址 / 按检出目录）与四条实测坑：
  `gitdir:` 不带尾斜杠**一条都不命中**（worktree 恰好相反，是带尾斜杠落空）、
  `hasconfig:remote.*.url:` 上的 `**` 不生效且 URL 不做归一化（`https://` 与 `git@` 是两回事）、
  `.git/config` 里的 `--local` 会静默压住 `includeIf`、两条同时命中时后写者胜。
  一并说清「多个 NPC / Agent 共用一个平台账号」的边界：能区分的在平台账号的子地址
  （`<任意串>+<账号>@noreply.cnb.cool`），不在 git 配置里；改身份去区分人会让平台上的
  提交归属散掉，留痕应走分支名与 commit scope（规范 §13.2 / §13.6）。
  文档已登记进 `docs/guides/` 的校验范围（`scripts/doc-facts.cjs` 的 `SCOPED_DOCS`）
  与文档中心索引（`docs/README.md`）。
