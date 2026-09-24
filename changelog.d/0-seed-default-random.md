## Changed

- **抽卡种子改为「默认随机」（Phase 8 · P8-1c 续）**：#949 把「种子」做成对外参数后，`execImages` 只在
  抽卡重出（rev 变新）时注随机 seed、首刷仍用工作流图内 seed。按「种子算高级输入、默认随机」的口径统一为
  **每次自主出图都带一个新的随机 seed**（首刷与抽卡重出一致）。工作流没连「种子」口时该值落不下去（进
  unmatched）、仍用图内 seed —— 实际是否可换依旧由工作流决定，运行期绝不改 `control_after_generate`。
  - `run-engine.ts` `execImages`：去掉 `isReroll` 分支，恒传 `seed: randomSeed()`。
  - 顺带修 `execReviewShots` 文档里对已回退的 `PR#942 randomizeSeed` 的过期引用。

## Tests

- `run-engine.test.ts`：首刷与抽卡重出都断言 `synthesizeFirstFrame` 收到一个有限数字 seed（默认随机）。
