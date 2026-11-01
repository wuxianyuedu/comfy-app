## Added

- **premerge 逐格计时账**（ISSUE #2832）：`check:premerge` 每一跑把逐格墙钟落进
  `.git/comfy-premerge-timing.jsonl`（追加 JSONL；本机账，不入库，与
  `comfy-precommit-timing.jsonl` 同口径），收尾往 stderr 念「快照建树单独一格 +
  最慢 5 条 + 合计」。实现：`baseCheckMany` 加可选 `onTiming` 回调（本检出每条门 /
  快照建树 / 快照侧每条门各一次，不给即无此格、行为逐字不变）；两个脚本段
  （claims / mergeLoss）也各计一格。**只记账、不阻断**：写失败只往 stderr 说一句，
  不影响任何退出码。git 目录用 `resolveGitDir` 现算（base-check 自己就跑在 worktree
  里，硬编码 `.git` 会把账写飞）。首条实测：`--only=base` 本检出侧 42 条 / 153.4s
  —— eslint 59.6s + 脚本档 tsc 21.3s 占近半；快照侧（10 分钟的大头）随下次真红入账。
