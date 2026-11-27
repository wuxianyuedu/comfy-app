## Added
- `pnpm changelog:new <号|0> --section <段落> --slug <slug>` / `changelog:list` / `changelog:merge [--check]`（#5172）：碎片文件名、首行段落词表与无号 `0-` 出口此前全靠人记，`ls changelog.d/` 答不出「还剩哪些没并入」。现在把既有的 `check-changelog-fragments` 与 `merge-changelog-fragments` 收成有名字的入口：建骨架后立刻自检、清单按段落列出未并入碎片、并入沿用既有脚本的 `--check`。拒绝覆盖已存在的碎片；补文件名归一与段落词表用例。
