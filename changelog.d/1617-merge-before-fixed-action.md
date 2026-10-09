## Changed

- **为「合并取错一侧」立一条合并前的固定动作**（ISSUE #1617 §4，人拍定）。`merged-side-loss`
  这一档（§11.23.6）进不了 `--base` 的批、也进不了钩子 —— 它要求人给一个**已知好的基线**
  （`--baseline <good-sha>`），而那个锚点**无法从任何 ref 现算**（被丢的那一侧在 squash
  之后常已不可达）。所以它立成一条**人的纪律**而不是机器判据：每次平台侧合并前跑一次
  `pnpm check:merged-side-loss <sha> --baseline <good-sha>`，或在 PR 里 `@` 评审 NPC
  唤起一轮；`0` 放行 / `1` 逐份人工看 / `2` 没跑起来（不算红）。写进规范 §13.6.2 的
  「合并前那一跳」一节，与 `--base` / `CHAINED_STEPS` 两批并列。
