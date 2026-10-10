## Changed

- **像素基线这一档接进「每天首次自证」，并多一道「有成套基线才要得起凭证」的闸**（ISSUE #1620）。此前 `FRESHNESS_TRACKS.visual.daily` 是 `false`，理由写在 §11.8 与 `visual-freshness-gate.mjs` 文件头：像素回归的结论只在**录过基线的那台机器上**成立，拿墙钟阻断等于让所有人卡在一个只有少数人能解的账上。理由是对的，结论下宽了一格 —— 它把**「谁能解这条账」**与**「这条账怎么被答复」**混成了一件事，于是像素档成了四档里唯一只被判「有主、写清」的那一档：「这批基线一直是对的」这句话在那几秒里无人回答，而它恰好是唯一真能把判据跑起来的那份账。
  - 判据收在 `dailyDemanded({ track, pending })` 一处（新增导出）：`daily` 决定要不要按日历日判，`gatedByPending` 决定这一档的「每天自证」是不是**与成套基线同一件事的两面**（只有像素档是）。`PENDING_PLATFORMS` 非空时像素档退回只判「有主、写清」—— 缺几张基线的那一档，那句话还说不出口。于是那张表真的清空的那一刻，这一档**自动**升成「每天一次」，不需要有人记得回来改一个布尔。
  - 两条出路都留得下可复核的事实：真跑一遍（跑绿即记），或 **`pnpm check:visual --workers=0 --skip "<理由>"`** 记一条写明理由、当天有效的豁免。`--workers=0` 只与 `--skip` 搭档（不带它当场退 4，且不会把 0 透给 Playwright）；本机缺成套基线时这一路当场退 2 —— 那一档要的是「先补一套」，不是一句「今天不跑」。占位理由与过短的理由与其余三档同一份判定（`isUsableSkipReason`）。
  - `--workers` 的解析下限从「≥1」改成「≥0」，`0` 的语义写明是「今天不跑」而非「0 个 worker」；`planRuns` 因此显式要求 `workers > 0` 才追加那个开关。`--dry-run` 顺带把「这一档今天还欠不欠凭证」打出来（缺成套基线那档不算欠）。

## Docs

- §11.8 两条：把「刻意不做墙钟阻断」那段改成「『有主、写清』与『今天有没有被真跑过一次』是两条判据」（后者只在按日历日判的档上判，且不设「多久算旧」的阈值）；把「每天首次守着三档」那张表补上像素档那一味与 `gatedByPending` 那道闸。
- `.githooks/pre-commit` 的 freshness-gate 那一步注释同步（四档的形状、两条出路、缺基线那一档为什么不算欠账）。

## Tests

- `tests/pixel-run.test.ts`：`--workers=0` 过解析但不透给 Playwright；`--skip` 的两条边界在**真入口 + 临时工作区**里跑一次（缺基线 ⇒ 退 2 且一个字不落账 / 占位理由 ⇒ 退 4 / 齐备 ⇒ 记一条 `skippedReason` 的账）；`--workers=0` 不带 `--skip` ⇒ 退 4 且不落账。
- `tests/daily-tracks.test.ts`：像素档 `daily === true` 且 `gatedByPending === true`，`dailyDemanded` 在 `PENDING_PLATFORMS` 空/非空两态下分岔；其余三档 `gatedByPending === false`（不受它影响）；`skipHow` 在登记里且是 `--workers=0` 那一形。
- `tests/e2e-run.test.ts`：两条账的差异栏从 `daily` / `skipHow` 改成 `gatedByPending`；像素档那条从「不吃每天首次」改成「吃，但 pending 非空时退回只判形状」。
- `tests/visual-freshness-gate.test.ts`：放行用例喂当天写的凭证（这一档现在按日历日判）。
