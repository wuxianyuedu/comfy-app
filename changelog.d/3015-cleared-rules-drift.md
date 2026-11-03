## Fixed

- 已清零规则的两处回潮清零（#3015）：
  `unicorn/no-negated-condition` 12 处（#2917 第 1 批 `6ad7f1428` 带入，形态全是
  `x !== undefined ? A : B`，改写成 `x === undefined ? B : A` 交换分支，
  与 #2977 既有形态一致）、`typescript/no-unnecessary-template-expression` 3 处
  （#3001 `0fd99ed7f` 带入 2 处，直接收掉多余的模板包裹；
  #2991 `d727b84ff` 的 1 处是**刻意拆写** `` `run${"Chunk"}` ``——
  本文件里不许出现完整的 `runChunk(` 字面量，另一条判据按文本读这份测试，
  改为 `oxlint-disable-next-line` + 一句理由留在台账上）。
  两条规则全仓复扫（2417 份、不传路径参数、`--type-aware`）0 命中（除台账禁用那 1 处）。
- 与 `typescript/strict-boolean-expressions` 的写法冲突（#2917 正在清的那条要求显式
  `x !== undefined`、本条要求非否定条件）处置口径见 #3016：交换分支后两边同时成立，
  每批落地后按**已清零规则集**复扫一次。
