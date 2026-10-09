## Fixed

- **两条「消费方台账」判据的零站点路径下，台账文件根本没被创建过**（ISSUE #1485）。
  `check-annotate-consumer.cjs` / `check-task-meta-consumer.cjs` 都是纯闸门
  （本仓库零站点，判据报 OK），而它们各自读的 `scripts/.annotate-consumers.json` /
  `scripts/.task-meta-consumers.json` **从建判据起就不存在**：判据写的是
  `if (!fs.existsSync(abs)) return null`（把「文件不在」静默退回成「没有台账」），
  而零站点时在读到台账**之前**就 `return 0` 了。

  表现不是「这里红」，而是**全绿、绿的却是「这份台账压根不存在」** ——
  判据宣称在守一条台账、台账不存在，正是 §11.23「声明 ⇄ 读者」那族。
  这条路径在第一次有人挂注释时就会分叉，而那一侧此前没有任何执行者。

  修法两处同批：台账**缺失**与**解析失败**同等对待（都判失败），
  且零站点时也**先读台账**再报 OK —— 「零站点通过」这个结论由
  「台账在、只是 `consumers` 为空」担保，不再由「台账根本没被读」担保。
  两份空台账（含 `why` 说明）同批落库。

## Changed

- 两份门禁自测（`tests/annotate-consumer-gate.test.ts` /
  `tests/task-meta-consumer-gate.test.ts`）迁到共享 fixture
  `tests/helpers/gate-repo.ts`（§11.16.1）—— 原先各自手抄了同一套四件套
  （mkdtemp / `copyFileSync` / `execFileSync` 归一 / 收尾 `rmSync`），属 §12.12 的字面孪生。
  同批各补一格 **「台账文件根本不在 → 阻断」**：这是上面那条修法唯一的执行者
  （原先 4 格夹具都不带台账，于是别的口径全被「台账缺失」这一件事压住 ——
  迁移时实测过一次，4 格一起红在同一件事上）。两文件各 9 格。
- 规范 11 §11.21.3 / §11.22.4 的判定表各补一行「台账文件根本不在 → 阻断」，
  并把「零站点通过由谁担保」写清。

- **`@theme` 的 token 清单文件快照过期一周、红在 `master` 上**（ISSUE #1485）。
  `#1558` 往 `@theme` 加了一颗 `--gradient-brand`（把品牌渐变的三段 stop 收成 token），
  而 `tests/__snapshots__/theme-tokens.css-theme-surface.txt` 这份基线没同批更新 ——
  `tests/theme-tokens-compile-source.test.ts` 当场红（按 §13.6.2 用 `git worktree`
  在干净 `origin/master` 上复算过，同一条判据同一份红）。

  它红了一周的原因值得单独说：那条用例读的是 `src/app/globals.css` 的**文本**
  （CSS 不在 import 图上），所以**改 globals.css 不会把它带进受影响清单** ——
  增量层正好在它不在的时机跑。而它的表现不是「某处坏了」，而是
  「一份**人工 review 的产物**已经与源码不一致，而没有一个人被告知」。

  修法：基线按 §11.9.1 限范围更新（`vitest run -u <那个文件>`），并把
  `tests/theme-tokens-compile-source.test.ts` 登记进
  `scripts/affected-tests.mjs` 的 `FIXED_STRUCTURAL_TESTS`（52 → 53）——
  与 `design-md-contract-sync` / `reduced-motion-tiers` / `embedded-title-font`
  同因（读文本、import 图追不到、与本次改动无关也必须响）。
  规范 11 §11.9.1 补第四条边界：「改了源、忘了跟基线」要有执行者，
  而它不能靠「跑一遍那条用例」。
