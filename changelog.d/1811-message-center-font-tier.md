## Fixed

- **消息中心的面板字号回归档位（清掉 master 上的一处 `baseline-red`）**。`1353e63a`（消息中心按启动分组）给面板写了 4 处字面字号（`text-[9px]` / `text-[10px]` / `text-[15px]` / `text-[12.5px]`），同批没有收 `tests/design-md-contract-sync.test.ts` 的字号棘轮基线 —— 于是那条判据在干净 `master` 上**就是红的**（调用点字面字号 140 → 141），拦住每一个人的提交（复算确认见 PR 描述）。
  - 按 §Typography 归到具名档：`runId` 与未读角标 → `text-3xs`(10px)、面板标题 → `text-sm`(14px)、消息正文 → `text-xs`(12px)。同文件其余文字本来就在用 `text-2xs` / `text-3xs` / `text-sm`，这四处是**文件内部的漂移**，不是刻意另立一档。
  - 判据口径与基线一个字节未动 —— 修的是那条字面量，不是把尺子放松。
