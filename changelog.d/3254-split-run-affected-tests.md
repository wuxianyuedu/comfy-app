## Changed

- 拆分 `scripts/run-affected-tests.mjs`：把「第 2 遍认不出自己 ⇒ 有界逐文件补跑」（含 `PER_FILE_RERUN_MAX` 上限）切到 `scripts/affected-launch-per-file-rerun.mjs`，使该文件回到 900 行硬闸以内（857 行），解除 #3251 的格式化阻塞。行为、退码与话术不变。
