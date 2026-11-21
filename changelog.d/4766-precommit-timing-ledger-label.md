## Fixed

- **`precommit-timing` 人读表头的账本路径打成 `.git/`，已改回实际落点 `.tmp/timing/`**（ISSUE #4766）。
  `node scripts/gates/precommit-timing.mjs`（含 `--last N`）的表头两处写的是
  `账本 .git/comfy-precommit-timing.jsonl`，而账本实际落在 `.tmp/timing/`（同文件头注释、
  `ledgerDir()` 与落点判据用例都是 `.tmp/timing/`，与 premerge-timing 同目录）——
  按表头去 `.git/` 找会扑空。纯显示修正，路径构造与记账行为不变。
