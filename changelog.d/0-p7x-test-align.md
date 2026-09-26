## Fixed

- `tests/check-ui-primitives.test.ts` 里 6 处随历次「棘轮 → 硬闸」升档后未同步更新、一直在 master 上红的差分回归测试改到位（不改脚本判据、只让测试跟上口径）：
  - **整块可点的开关行（label 包住 Switch）不被 P23 计**：P78 已升硬闸、视图层裸 `<label>` 会被拦；测试意图（P23 不计它）保留、改成断「P78 拦 + P23 不出现」。
  - **P71 只计 p71-allow 块外的 dark:palette**：`outside: "text-rose-700 dark:text-rose-400"` 里 `text-rose-700` 会同时触发 P79 硬闸、把 `--update` 一起拒了；fixture 改成 `dark:text-rose-400` 只留 P71 一条账。
  - **--update 允许登记新判据起点、但拦下已有 rule id 的上升**：P78 升硬闸后走不到「新判据起点登记」这条分支；载体从 P78 换到仍是棘轮的 P71（`dark:bg-red-400` / `dark:bg-rose-400` 各计一处）。
  - **P79 与 P71 共享 p71-allow 例外块** / **p71-allow 同时认 `//` 与 JSX 注释两形态** / **P80 两个独立 className 各有一对 w-N h-N**：P79 / P80 都是硬闸、`--update` 会被「未清零」直接拒绝；改用 `--report`（只出清单不判失败）后解析 `[ui-primitives] Pxx ... —— N 处 / M 文件` 那一行的数字，等价锁住「计数与 allow 剥离生效」。
