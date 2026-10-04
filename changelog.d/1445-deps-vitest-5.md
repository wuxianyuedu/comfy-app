## Changed

- **`vitest` / `@vitest/coverage-v8` 4.1.11 → 5.0.3**（ISSUE #1445 第 4 件，**大版本**，
  面最大的一件：动的是全部 7334 条用例的执行器）。

## Fixed

- **`src/lib/comfyui/lifecycle-launch.test.ts`：两条用例在升版后红，根因是「模块级状态
  用 `beforeEach` 复位」这个位置本身就写错了，vitest 4 只是让它**碰巧**绿。**
  现场分三层，逐层都记下来（否则下次还会照原样写回去）：
  - **表层**：vitest 5 把 `clearMocks` 的默认值由 `false` 翻成 `true`（实测两份
    `dist/chunks/defaults*.js`：v4 `clearMocks: false` / v5 `clearMocks: true`，
    且 `clearModuleMocks()` 跑在 `onBeforeTryTask`），于是该文件原先「在 `beforeEach`
    里读**上一条用例**留下的 `mock.calls`，再借它调 `onExit` 复位」的写法整批落空 ——
    调用记录已经被清掉了。
  - **根因**：`keepAliveExitWatcher` 是**被测模块的模块级变量**，而那个 `beforeEach`
    复位完之后，**本用例自己的 `arm()` 又会把它挂上**；引用是跨用例活下来的，所以
    下一个用例的 `beforeEach` 一进来就已经是「已挂」状态 —— 「还没挂 → 挂上」这条
    判据当场失真（实测：第 3、4 条用例的 `beforeEach` 里 `arm()` 直接被
    `if (keepAliveExitWatcher !== null) return;` 早退，连 mock 都没调到）。
    换句话说，**即使 `clearMocks` 还是 `false`，这个复位也放错了位置**。
  - **修法**：复位搬到 `afterEach`（用例跑完再收拾），并且只读**本用例**留下的
    `mock.calls`（`afterEach` 与 `beforeEach` 不同，它看得到本用例的记录，实测
    能读到、能调到 `onExit`）；顺带把 `lastWatcherDeps()` 抽成一个助手，
    两处读法不再各写一遍 `.mock.calls[0]?.[0]`。
  - **变异核过**：把 `afterEach` 的复位整段去掉 → 恰好那两条红，其余 6 条绿。

- 其余用例零改动：全量 588 文件 / 7319 通过 / 15 跳过，`--coverage` 下
  `vitest.config.ts` 的几十条 `thresholds` 全部达标（**一条没动**）。
  规范 §11.13 那套预算与并发口径也照旧成立 —— `maxWorkers: 8` 的默认档与
  `--maxWorkers=4` 的钩子档都实测过：4 档全绿，墙钟 153.65s
  （比 §11.13 记的 vitest 4 那档 1949s 快一个量级，那一档的数字是旧机器/旧版本的
  记录，本次不据它改任何配置）。
- 顺带记一条**不是这次引入、也不由这次解决**的已知形态：全量并行（`maxWorkers: 8`）下
  `src/components/studio/hooks/use-model-library.test.ts` 的「卸载后 refetch 回包不得
  触发更新调度」偶发假红（本次两轮全量里中了一次），`--no-file-parallelism` 隔离
  连跑三次全绿 —— 属 §11.13 明写的争用形态，判红仍要先隔离重跑定性，不许靠抬预算掩盖。
