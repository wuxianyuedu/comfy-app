## Fixed

**`node-engines.mjs` 手写 semver 解析：订正正当理由 + 修 `within()` 下界取反 bug + 补三个小口子**（ISSUE #2569）。

### 正当理由订正（这是「记档」那一句的修正）

手写、不引 `semver` 的理由有且仅有两条，且互相独立：

- **自举性**：本文件被 `scripts/check-pnpm-available.mjs` 在「装依赖之前」那一步调用
  （`.cnb.yml` 的 `Install dependencies` 里它排在 `ci-install-deps.mjs` 之前，是前提步骤），
  即「环境还没装好」时它就得能跑——一旦 `import "semver"`，node_modules 缺失 / 损坏 /
  版本装错时检查脚本自己先崩，而那恰是它最该跑的时机；
- **三态语义**：`semver.satisfies()` 只给 `boolean`（读不懂 与 不满足 都是 false）；本文件
  `satisfies()` 给 `true | false | null`，**拒解**是第三态（`20.x` / `^0.2.3` / `*` 一律 `null`，
  由调用方转成「没跑起来」而非「判绿」）。semver 给不出这个，它永远返回 bool。

⚠️ **「少一个依赖」不是理由**：`semver` 自身零依赖、约 15KB，且 npm 几乎必带一份——以
「减依赖」为名手写它等于没减到任何东西。这条理由从记档里删掉（模块头已加 `为什么手写、
不引 semver` 一段，防止后人「优化」回 semver）。

### `within()` 下界包容性取反（已修 + 补矩阵单测）

旧式 `(!outer.lowerInclusive || inner.lowerInclusive)` 是反的，正确是
`(outer.lowerInclusive || !inner.lowerInclusive)`。实测 4 行中 2 行错：`outer >20`、
`inner >=20` 是真实 gap，旧式误报 true 放过。现网形状两端皆 inclusive（^ 与 >=），故此前
休眠；一旦写 `>26.0.0` 即活。`tests/node-engines.test.ts` 锁下界 4 行 + 上界 4 行矩阵。

### 三个小口子

- `collectDependencyFloors` 静默漏扫：`require.resolve(name+'/package.json')` 遇 `exports`
  不暴露 `./package.json` 的包会抛，原代码 `continue` —— 不计入 resolved、也不算失败，只有
  全部失败才判红 ⇒ 部分依赖悄悄退出扫描范围。现加兜底：直接
  `fs.readFileSync(node_modules/<name>/package.json)`（pnpm 的 symlink 会被自动跟随）。
- `recommendFrom` 已满足仍给建议：本仓 `describeNodeAgainstFloor` 在 `ok===true` 时把
  `recommend` 置 `null`，不再读起来像「你必须升」。
- 文档轻微超售：模块头曾写支持 `<X.Y[.Z]`，但独立上界（无下界的 `<23.0.0`）→ `parseRange`
  返回 `null`（fail-closed）。已补一句「独立上界视为读不懂」。

### 业务结论（非 bug，提前知会）

`covers(dep=">=22.12.0 <23.0.0", declared)` 对 `@sentry/nextjs` = false——其 `engines.node`
带上界 `<23.0.0`，与 26.x 硬冲突。若把本仓 `engines.node` 钉成 `>=26.12.1` 会直接判红，需
人工裁决（升 sentry 或在判据开白名单并写明理由）。这一轮不改它，只把事实点出来。

### 验收（回应用户「待验」）

`ok:false` 经 `tests/dev-launcher-toolchain-gate.test.ts` 的 `checkDeclaredFloor({ root }).ok`
断言 `true` 转成非零退出——该用例在 PR 阻塞测试档里，故「闸能拦违规」成立（不是只「没发现
违规」）。`node-engines.test.ts` 新增 10 条（下界/上界矩阵、三态、漏扫兜底、recommend）。
