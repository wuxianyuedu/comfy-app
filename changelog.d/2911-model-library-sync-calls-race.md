## Fixed

- **`use-model-library.test.ts` 负载下偶发红（syncCalls 跨用例串号）修根因**：
  用例原本的收尾只等 `loading`（初次 list）收敛，而 hook 的 sync 经
  `setTimeout(…, 0)` 与 list 并行发车、其 `onSettled` 还会触发一次静默
  refetch —— 负载下这些回包晚于用例结束到达，handler 在 `afterEach` 把
  `syncCalls` / `listInputs` 清零**之后**才执行，把 +1 落进下一条用例
  （PR #2910 首跑实测：syncCalls 期望 1、实际 2）。修复是让每条挂载 hook 的
  用例结束在静止态：新增 `waitSyncSettled`（等 sync 记账到 1 + 初次 list 与
  refetch 都到达服务端 + `refreshing` 收敛），五条用例收尾统一走它；
  「重渲染不复发静默同步」的硬断言 `toBe(1)` 一字未动、不加重试不放宽。
  验证：注入 120ms handler 延迟时旧代码必红、修复后吸收该时序错位转绿；
  回退延迟后 6 路并发复跑全绿。
