# changelog.d —— CHANGELOG 碎片目录

一件变更一个文件，**不要直接改 `CHANGELOG.md`**。

## 为什么

`CHANGELOG.md` 的 `[Unreleased]` 是全仓库唯一「人人都改、且都改同一个地方」的文件。
两条并行分支（或两个 agent 同时开工）往里追加条目时，必然落在同一行区间——
无论谁先合，另一方都要手工解一次冲突。这段冲突没有任何信息量：
两边的内容都该保留，没有真正的取舍，纯粹是把同一份文本排两遍。

改成碎片后，每条变更各有各的文件，git 层面不会冲突；发布时由脚本一次性拼进
`CHANGELOG.md`，编辑时间从「每轮改动」压缩到「每次发版」。

## 怎么用

1. 按 `<issue号>-<slug>.md` 建文件，例如 `408-changelog-conflict-free.md`。
   没有 ISSUE 号时用 `0-` 开头。
2. 首行写段落标题（`## Added` / `## Changed` / `## Fixed` / `## Deprecated` /
   `## Removed` / `## Security`），下面写条目正文。
   写法与原先写在 `CHANGELOG.md` 里完全一致（Markdown、一行一条、`- ` 开头）。
3. 提交。`scripts/check-changelog-fragments.cjs` 会在 pre-commit 校验文件名与形态。

一个 PR 里有**多条不同类型的变更**，就建多个碎片文件（`Added` 一个、`Fixed` 一个）。

## 发版时怎么并入

```bash
node scripts/merge-changelog-fragments.mjs          # 并入 [Unreleased] 后删除碎片
node scripts/merge-changelog-fragments.mjs --check   # 只预览,不落盘
node scripts/merge-changelog-fragments.mjs --release 0.2.0   # 顺带把 [Unreleased] 定版
```

哪条变更该进 CHANGELOG、哪条不该进，判据见
[规范 §13.10](../docs/standards/13-提交与-code-review.md#1310-changelog-记录规范)。
