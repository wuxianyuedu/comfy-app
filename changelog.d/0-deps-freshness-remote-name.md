## Fixed

- **依赖新鲜度判据不再假定远端叫 `origin`**（规范 §13.5.13，审查台账 R12-01）：
  `scripts/check-deps-freshness.mjs` 此前把要比对的引用写死成 `origin/master`，而本仓的远端叫 `cnb`
  （`git remote -v` 里没有 `origin`）⇒ 在这份检出上它**恒**报 `[未校验] 没有可用的远端引用`，
  也就是 AGENTS 硬规则 25 的执行者在这台机器上**不判任何东西**（降级话术本身是诚实的：不阻断、
  也明说「不许读成远端就是最新」，但承诺的能力为空）。现在引用名按 `refs/remotes/**` 里
  以 `/master` 结尾的那条**现算**（`origin/master` 在场时仍优先它，保住既有语义与夹具），
  取证时间那条 reflog 的路径也跟着引用名拆 (`<remote>` / `<branch>`) —— 旧实现按「去掉 `origin/` 前缀」
  算分支名，`cnb/master` 会被拼成 `logs/refs/remotes/origin/cnb/master`，永远取不到。
  输出现在**点名它实际比对了哪条引用**（`[已核对] 比对的是 cnb/master，它的 reflog 距今 N 小时`）。
  同时补一态：远端引用**不领先于 HEAD**（已在本地历史里）时报「判过：没有待同步的远端依赖改动」，
  不再回落成 `[未校验]` —— 「没看」与「看了且没有」在输出上必须分得开，这条判据的存在理由就是这个区分。
  这一态认的是 `merge-base --is-ancestor`，而那条命令在同一个文件的 `forkPoint()` 里**早就在跑**
  （只是把结论压进了 `null`，调用方分不出来）⇒ 顺手收成 `isRemoteAncestorOfHead()` 一处，两处共用。
  回归用例两条（远端命名为 `cnb` / 引用不领先），见 `tests/deps-freshness-gate.test.ts`。
  实测：修前在本检出跑它退 0 且报 `[未校验]`；修后报 `[已核对] 比对的是 cnb/master … ② 判过`。
