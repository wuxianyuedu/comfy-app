## Fixed

- 修复 master 基线 void-floats 硬闸红（ISSUE #5111）：PR #5070 带红合并漏掉了
  `comfy-queue-store` 的悬空 Promise 修复，改为 `fireAndForget` 统一出口，
  使该硬闸回到基线 0。
