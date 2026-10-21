## Added

- **`每日单元测试` 这一格的读数补到「税的内部分解」那一层**（此前只有墙钟），结案数据落
  `docs/audits/2026-10-21-timing-baseline-refs-volume.md` 新加的**表 E**：本地 `pnpm test:coverage:tracked`
  一跑（13:26:59 起跑，load 每核 0.00，16 核 / `maxWorkers=4`）读到
  墙钟 **698.4s**、`Test Files 789 passed (789)`、`Tests 10275 passed / 1 expected fail / 29 skipped (10305)`；
  Σ文件总时长 1297.7s = 断言 **1242.6s** + 装载/钩子 **55.2s（占 Σ 的 4%）**，
  中位每份 0.0s、其余 779 份合计 2.8s，而 **91% 的税集中在三份文件**。

## Fixed

- **#10 那格结案：既不治、也不切** —— 依据是形态不是大小。表 E 里逐条看过那三份的 `beforeAll`：
  `db-migrate-equivalence`（税 28.5s / 断言 5.9s）真 `spawnSync` 跑一次 migrate + 一次 push，
  判的是两条路径产出的表结构等价；`docs-candidate-hygiene`（12.1s / 0.1s）现造整棵文档夹具目录
  （它的 `hookTimeout: 45s` 就是为这一步设的）；`tailwind-source-roots`（9.4s / 0.4s）用
  `@tailwindcss/postcss` 从 `globals.css` 编一次真实 CSS 再数 source roots。
  ⇒ 这三笔**不是「白载了什么」**（那是第一刀那类：node 档无条件载 DOM 测试栈，可削、已削，−52%），
  而是**判据自己的动作**。要把它"治"下来只有两条路，都不换：换成不真跑的等价判据 = 削判据强度；
  挪出每日档 = 有些判据从此每天不被执行。而收益只有 55.2s = 本档墙钟的 **7.9%**。
  耗时前三名（`check-ui-primitives` 135.6s / `check-reformat-only` 75.8s / `a11y-axe-stories` 60.2s）
  同理在断言侧：全库 prettier、全 story 的 axe —— 也是真 gate 工作。**这一格到此关闭，别为它重开一轮**；
  复量只要一条命令 `pnpm test:coverage:tracked`，读数由 `scripts/full-suite-run.mjs`
  的 `suiteRanking` + `suitePhaseTax` 自己打（判据在 `tests/daily-tracks.test.ts`）。
- **那张新鲜度账从「一条豁免声明」换成「今天真跑绿」**：`scripts/.full-suite-freshness.json`
  原来记的是 2026-10-18 的一次 `--skip` 式声明（理由是「本次只改 ci-image-plan 的文案」），
  现在记的是本次全量 + 覆盖率跑绿的时刻 —— 这是这条链唯一的「这一档上次跑绿在什么时候」的事实，
  按脚本自己那句话连同提交（`writeFreshness` 只在绿时写，红着不记）。
  ⚠️ 附带一条今天落地的判据相互作用：#2098 让这一跑在红带超时指纹时会先隔离复跑，
  所以「绿」与「放行」在账上是分开的 —— **两种放行都不记账**（负载假红 / 未校验都不是
  「整档带门槛跑绿过」那件事）。本次是第 1 遍直接绿，走的是记账那一支。
- 复算：`pnpm doc:check` 退 0、`doc:render --check` ✓（31 份，audits 这份额外未入渲染面）、
  表 E 三张表逐行按竖线数复量与表头一致、`## 立案` 那一节未被挤掉；
  本档实跑 `EXIT=0` 且尾部打出 `✓ 全量单测 + 覆盖率通过`。
