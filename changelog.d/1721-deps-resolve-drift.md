## Fixed

- **「锁文件对得上、而新加的包解析不到」这一档从此有判据**（ISSUE #1721）。
  本地 `node_modules` 停在**装某个新直接依赖之前**时，那个包只以**传递依赖的旧版本**
  落在**包自己的私有层**里（立案实例：`node_modules/@storybook/addon-a11y/node_modules/axe-core`
  是 4.13.0，而 `package.json` 声明 `^4.14.0`），顶层既没有提升出来的那一份、也没有任何
  可解析路径 —— 而两份 lockfile 的实质内容可以**逐字一致**。表现是 `tsc --noEmit` /
  `eslint` 报 `Cannot find module 'axe-core'`（TS2307），而既有判据**全部判绿**：
  `check-deps-freshness.mjs` 的 ③ 比的是两份 lockfile 的**文本**（没有「谁解析得到」这一栏）、
  启动器的 `brokenKeyDeps()` 只点名 typescript / next（新加的那个包从来不在清单上）。
  现在 ③ 由两块拼成 —— 文本层（原有）＋ **解析层**（`launcher-core/worktree.mjs` 的
  `unresolvableDeclaredDeps()`），后者红了**单独说一句话**（「解析不到」而**不是**
  「装的不是你声明的那套」：后者会把读的人送去核对一份本来就对的文件）。
  `--json` 出口多一个 `installDrift.unresolved`。

## Added

- 探针清单的**唯一权威定义**落在 `docs/reference-facts.md` 的新登记行 `deps.resolveProbes`
  （`scripts/doc-facts.cjs` 反向解析它，判据侧的 `RESOLVE_PROBES` 由用例逐项核对）——
  与 `comment.language.asciiOnly` 同一种手法，避免「文档写一套、脚本读另一套」两份清单
  各自漂移。探针刻意只有三条（typescript / next / axe-core）：都是跑门禁时无论如何都会
  解析到的包，多解析一次不产生新的工作；扫全部 `package.json` 会让清单跟着依赖表一起长
  （§12.18 那族「会静默失效的清单」）。
- `tests/helpers/gate-repo.ts` 新增 `installDep(name, version?)` —— 把「已安装依赖」放进
  临时工作区。**不能拿 `mkdir` 顶替**：临时工作区在 `os.tmpdir()` 下，祖先目录里可能有
  任意项目的 `node_modules`，而 Node 的解析**一路向上找**，于是「探针说解析得到」可能是
  从工作区外捡来的。这一步实测踩到过（三条探针全报缺失 ⇒ 用例红成判据坏了）。

## Docs

- `docs/guides/sync-after-pull.md` 新增 §3.1「锁文件对得上，而新加的包**解析不到**」：
  实测现场（顶层没有 `axe-core` 目录、旧版本扣在 `@storybook/addon-a11y` 的私有层、`tsc`
  报 TS2307）、为什么「删掉重装」不是这里的处方（处方就是普通的 `pnpm install`，缺的是
  **有人提醒你**）、以及现在谁在守它。快速对照表补一行「两侧 lockfile 看起来一致但报
  `Cannot find module`」的处置。
- `docs/standards/13-提交与-code-review.md` §13.5.13 的「判据三层」表补 ③ 的第二块，
  并把两块的分工、探针口径、不表态边界（`no-install` 不抢答）与契约测试条数写成正文。
- `docs/reference-facts.md` 新增 §1.6 登记该探针清单。

## 实测

- 复现：`node-linker=hoisted` 检出任其回退到 `node-linker=isolated` 时，顶层 `axe-core`
  缺席，而 `node_modules/@storybook/addon-a11y/node_modules/axe-core` 是 4.13.0；
  `tsc --noEmit` 报 `probe-axe.ts(1,17): error TS2307: Cannot find module 'axe-core'`。
- 反向验证三刀：命中那一档（两侧 lockfile 逐字一致 + `axe-core` 解析不到）⇒ 红且
  `state: "unresolved"`；无 `.modules.yaml` ⇒ 仍走 `no-install`（解析层不表态）；
  三条探针都在位 ⇒ 解析层静默。
