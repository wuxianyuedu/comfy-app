## Fixed

- **canvas 回灌缓存封顶**（#4397）：`importCache`（产物路径 → ComfyUI 输入
  文件名）只增不减。对齐同族 `referenceUploadCache` 的口径：上限 32、超过整表
  清掉——条目只是复用加速，清空只会多传一次，不会错。
