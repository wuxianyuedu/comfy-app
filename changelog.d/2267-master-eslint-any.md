## Fixed

`master` 上的 eslint 不再是红的 —— 三处 `as any` 换成**收窄**，判据与用例一个字未改。

- **这条不是本 PR 引入的**：引入它的那一笔是 `87818fd6`（`feat(freshness): 新鲜度账回写
  机器分支 ci/freshness-ledger (#2247) (#2261)`），而 `ESLint 零警告` 在 PR 那一档是
  **停用**的（`COMFYAPP_CI_DISABLED_GATES` 里登记着「单元测试, ESLint 零警告」，
  它现在归每日档 `每日 ESLint 零警告`）⇒ 合并时平台没有跑它，红就这么进了 master。
- **复算证据**：`pnpm check:premerge` 的 `base` 段给出 `[base-check] 结论：baseline-red`，
  点名「红的那几条：eslint（零警告，范围见 package.json lint）（baseline-red）。
  干净基线上**同样命中** ⇒ 这是别线的红（origin/master），与你的改动无关」。
- **为什么顺手收掉**：它挡所有人的路 —— 合并前复算的 `base` 段**收** B 组那条 `eslint`
  （`scripts/base-check/hook-steps.mjs` 的 `resolveMergeBatch`）⇒ 从此每个要推分支的人
  都被拦一次，而红的文件跟他没关系。判据给的动作是「挡路的（硬闸类）就地修掉：
  单独一个 commit + 单独一条 changelog.d 碎片」。
- **怎么修的**：`as any` 让整条表达式退化成「不检查」的样子（`no-unsafe-member-access`
  正是为它准备的），而这三处恰恰是「这一档被读到了」的断言 ⇒ 收窄成
  `{ verifiedAt?: string }`（一个本地小helper），账的形状 `Record<string, unknown>`
  与读账那层的契约一个字未改。
