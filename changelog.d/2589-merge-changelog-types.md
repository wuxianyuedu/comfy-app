## Fixed

- **脚本档清账批 10：`scripts/merge-changelog-fragments.mjs` 19 格清零，账从 131 处 / 13 份降到
  112 处 / 12 份（ISSUE #2589 / 规范 §13.5.14.1）**：这一份是硬规则 14「碎片写
  `changelog.d/`、不直接改 `CHANGELOG.md`」的执行体。19 格里最值得留档的是三条**口径**，
  都不是「补个注解」那么轻：

  ① **属性判据不收窄元素**（4 格）：`pending.filter((p) => p.rev !== null)` 之后紧跟着的
  `a.rev < b.rev` 照样报 `TS18047`。批 9 里那招 `.filter((p) => p !== undefined)` 之所以有效，
  是因为判的是**参数本身**；判属性时检查器不推断谓词。修法是把它写成一条具名谓词
  `hasAnchor`（`@returns {p is AnchoredSection}`），并给「带锚的那一支」单列一个 typedef ——
  「过滤完 `rev` 必非 null」这条事实本来就该有声明面，写一次让排序与落点两处同时受益。

  ② **`reduce` 的累加器类型来自初值**（1 格）：先在等号左边写 `@type {Record<string,string[]>}`、
  再改成整体 cast，两种都**改不到** `acc[f.section] ??= []` 那一格 —— 实测要注解在
  **初值那个 `{}`** 上才生效。这条写进注释，免得下一个人又去动等号左边。

  ③ **「判完 `length` 再按下标取」是五格的共同根因**：`const target = anchored[0] ?? pending[0]`
  带着 `undefined` 走到后面四处使用点。改成先解构 `const [firstPending, ...restPending] = …`、
  以 `if (!firstPending) throw` 顶掉原来那句 `pending.length === 0`（两者逐字等价），
  `target` 从此是 `PendingSection`。这不是为了骗过检查器：**「清单非空」这一件事在原文里
  只用一次判据表达、却在五处被默认相信**，解构是把它写成类型的机会。

  其余 9 格按既有口径处理：下标读取在**产生端**收（`--version` / `--anchor` 两处
  `args[i+1] ?? null`、`pendingSections` 里的 `m[1]` 解构 + 真值判据、锚的 `a[1] ?? null`）、
  `bucket` 收成 `Map<string, string[]>` 并把两处 `has` 再 `get` 合成一个 `listOf()`
  （取到的一定是数组，且建立与写入同处）、`catch (err)` 的 `unknown` 用
  `err instanceof Error ? err.message : String(err)` 显式判型而不是 cast。

  行为恒等的凭据（三条都跑了）：
  ① 两份用例串行复跑 = **16 条全绿**：`tests/merge-changelog-anchor.test.ts`（锚决定落点）
  与 `tests/check-changelog-fragments.test.ts`（碎片形态判据）；
  ② 真机 `node scripts/merge-changelog-fragments.mjs --check` 走完整条改动面
  （读碎片 → `bySection` 聚合 → 定 `target` → 重建段落）→
  `将并入「## [Unreleased]」、锚 → 73ca83b4(变了);未改动任何文件。` 且 `EXIT=0`；
  `--check --json` 那一路的 `summary` 也照旧出（`target` / `anchor` / `refreshed` / 碎片名单）；
  `git status` 复算确认工作树只有本脚本一处改动（**没有**误写 `CHANGELOG.md`）；
  ③ `node --check` 通过、`pnpm exec eslint` 对该文件零输出；棘轮 `--update` 后复算 =
  面 214 / 存量 **112** / **12** 份（本批零新格）。
