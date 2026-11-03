## Fixed

- **`pnpm ship --merge` 复用一条已在平台上改过标题的 PR 时，squash 那一行取平台现标题，不再按 branch-first 推导**（ISSUE #2806）：标题权威顺序改为 `--title` > 平台上这条 PR 的现标题 > branch-first > 顶端兜底 —— 评审在平台上读到的标题与主干 `git log` 里那一行本该是同一句，此前照第一笔提交写会落一行与内容不符的历史。没给 `--title` 才回读平台标题（省一次往返）；回读没跑起来时明念「读数缺失」再退回 branch-first，与「这条 PR 本来没改标题」在屏幕上长得不一样。
