## Fixed

- **lib 里剩下 6 处遮 `noUncheckedIndexedAccess` / 跨函数边界窄化丢失的
  非空断言 `!`**：都是「判据与断言各写一遍」的形态——同一件事用两次，
  改判据忘了同步 `!`（或反过来）就分叉。三处一并收成同行判据：
  · `src/lib/project-canvas/canvas-api.ts` `pollTask` 里 `imgs.find(...) ??
    imgs[0]` 拿到 `TaskResult | undefined`，两行 `v!.localPath` / `v!.mediaType`
  是「外层已判过 `imgs.length > 0`」的人眼结论。改成 `if (v) { ... }`
  早退——`imgs.length > 0` + `imgs[0]` 必然存在，else 分支是「编译器认为
  不可能」的兜底，走到这里就让轮询继续；两处 `!` 一并消掉。
  · `src/lib/workflow/workflow-param-mapping.ts` `classifyPins` 里
  `raw as WorkflowIOEntry | undefined` + `pinFamily(entry)`，隐含契约是
  「family 非 null 时 entry 一定存在」但编译器看不到——push 里三行
  `entry!.name` / `entry!.type` / `entry!.defaultValue` 就是这份契约
  用两次。加显式 `if (!entry) continue;` 让判据与窄化同行，三处 `!` 消失。
  · `src/lib/workshop/model-mode-contract.ts` `moveContractInput` 用
  `const [moved] = next.splice(from, 1); next.splice(to, 0, moved!);` ——
  数组解构在 `noUncheckedIndexedAccess` 下 splice 返回 `T[]`、索引结果
  `T | undefined`，`moved!` 只是遮这一点。改成 `inputs.filter((_, i) => i !== from)`
  再 `splice(to, 0, id)`——语义完全等价（filter 摘掉 from 位保留原序，
  再按 to 插回；to>from 与 to<from 两种偏移都在同一算法里成立），`!`
  消失。
