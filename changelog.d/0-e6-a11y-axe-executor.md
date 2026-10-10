## Added

- **a11y 自动化有了执行者**（台账 E6 三格里的第一格）：`tests/a11y-axe-stories.test.ts`
  把 `src/components/ui/*.stories.tsx` 的**每个故事**在 jsdom 里逐个渲染后跑 `axe-core`，
  已进 C 组固定清单（`scripts/affected-tests.mjs` 的 `FIXED_STRUCTURAL_TESTS`）。
  它补的是既有那道 a11y 判据（`scripts/check-a11y-rules.cjs`，规范 06 §6.12）回答不了的一半 ——
  那边判「规则开关 ⇄ 台账」，规则开着、界面照样能渲染出一枚没有名字、没有 label 的按钮。
- 登记表 `scripts/.a11y-axe-known.json`：违规按 `(组件文件, axe 规则)` 记账，
  **双向不陈旧**（新增违规 ⇒ 红；修好了但登记还留着 ⇒ 也红）；「这一档拿不到状态的故事」
  同样登记在册（55 条需要 Storybook decorator / provider 的故事），不静默跳过。
  **没有 `--update`**：判红时打印逐字可粘的候选清单，但判据自己不写回登记表。
- 依赖：`axe-core@4.14.0`（devDependency，纯 JS、无构建脚本 ⇒ 不动 `pnpm-workspace.yaml` 的 `allowBuilds`）。

## Fixed

- `.storybook/main.ts` 与 `docs/guide-storybook.md` 把 a11y 自动化的出处写成 **F6** ——
  F6 讲的是 Storybook / 像素基线，a11y 自动化属 E6。引用挂错编号的坏处是「按编号去找账，
  找到的是另一件事」，现在两处都指向真正的执行者文件。

## 实测

- 首版把 276 个故事全渲染进同一个 `document.body`、`cleanup()` 写在 `afterEach`
  （它只在**整条用例**结束后跑一次）⇒ axe 每跑一遍就把前面所有故事重计一次，
  量出 `region: 8566` / `button-name: 3587` —— **那不是存量，是重复计数**。
  改成逐故事渲染 → 判 → 立刻卸载，数字才可比对；页面级规则（`region` / `landmark-*`）
  对裸渲染的单枚组件没有意义，显式关掉并写明理由。
- 真实存量：11 条 `(组件, 规则)` / 4 个规则 / 55 条 `unrenderable`；单文件耗时 ~20s。
- 反向验证两刀各红一次：往登记表塞一条 `(ghost.tsx, fake-rule)` ⇒ 红（stale 一侧）；
  删掉一条真登记 ⇒ 红（newViolations 一侧）。
