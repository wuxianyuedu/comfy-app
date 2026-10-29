## Fixed

- **脚本档清账批 8：`scripts/check-deps-freshness.mjs` 20 格清零，账从 170 处 / 15 份降到
  150 处 / 14 份（ISSUE #2589 / 规范 §13.5.14.1）**：这一份是硬规则 25 那条「开工前先跑
  依赖新鲜度」的执行体。20 格里 **5 格是同一件事**：`runFreshnessCheck` 的 `@returns` 把两个
  **早已存在、三个消费点正在读**的形状写成 `remoteDrifts: object[]` / `installDrift: object | null`，
  于是 `d.file` / `d.kind` / `.state` / `.unresolved` 一律报「Property does not exist on type 'object'」——
  **声明把实现擦掉了**，不是实现没有（与批 4 那张假 `@returns`、批 5 那个 `@param {object} diff`
  同族，第三次出现）。补成 `Drift` / `InstallDrift` 两个 typedef 之后那 5 格自己消失，
  而 `InstallDrift.diff` 指的是 `lockfile/lock-diff.d.mts` 里那份**权威**的 `LockDiff`
  （本文件只搬运给 `renderLockDiff`，不另写第二份）。

  三处「类型在如实说话」的小改，语义一字未动，逐处写清：

  1. `远端删除` 那一支原来写成复合判据 `baseText !== null && remoteText === null`。
     两侧都为 null 在上一行已经 `continue`，所以复合里那半边是重复劳动，而它让检查器
     没法把 `remoteText` 收进非 null 那一支 ⇒ 下面 `diffLockfiles(baseText, remoteText)`
     报 `TS2345`。拆成独立的 `if (remoteText === null)`：判据覆盖面与走向完全一致，
     红的那一格是**声明没跟上**，不是这里真能传进 null。
  2. `InstallDrift.unresolved` 改成**必填**：两个构造点（`{ state: "unresolved", unresolved }`
     与 `{ state, diff, unresolved }`）都必带它，写成可选就让 `drift.unresolved.join(…)`
     报「possibly undefined」。顺带把 `--json` 那格 `unresolved ?? []` 的兜底撤掉——
     类型如实之后那个 `??` 是给不存在的情况写的。
  3. `resolveRemoteMasterRev` 的 `sort()[0]` 与 `main()` 里 `process.argv[rootArg + 1]`
     两处的下标读取收成局部变量再判（同一形，第三次出现：批 1 / 批 6 / 批 8）。

  行为恒等的凭据（三条都跑了）：
  ① 专供本判据的 `tests/deps-freshness-gate.test.ts` 串行复跑 = **18 条全绿**（含
  「分叉之后自己在分支上加依赖 ⇒ 不算远端改过依赖」「MERGE_HEAD 在场 ⇒ ② 不判」、
  `--staged` 命中与未命中两支）；
  ② 真机两条出口各走一遍：仓库根 `--json` 给出
  `{code:0, remoteChecked:true, remoteAgeMs:553656.9, remoteDrifts:[], installDrift:null, envBroken:false}`；
  把 `--root` 指到一个**与 git 无关的空目录** ⇒ `EXIT=2` 且念的是「没跑起来 / 这里不是一个可信的检出」——
  这一条是第 3 处改动的关键凭据（那次改动动的正是「不许静默退回脚本所在的检出」那格）；
  ③ `node --check` 通过；棘轮 `--update` 后复算 = 面 **214** / 存量 **150** / **14** 份（本笔零新格，
  也没有把任何新增登记成已知存量）。
