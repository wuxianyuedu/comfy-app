## Added

- **页面级视觉基线铺开（`e2e/visual`），并给「组件级 ⇄ 页面级」这条分工上了判据**（ISSUE #1381）。
  - 「Storybook 管组件级视觉、Playwright 管页面级视觉」此前一直留在账上（`docs/guides/PRODUCTION-GAPS.md` 的 F6），而 `e2e/visual/` 里只有登录页一页 —— 规范 11 §11.8 声明的基线范围（深浅两态 / 响应式断点 / 空态 / 画布 / 弹窗）里只有「断点」勉强沾边。这一批铺开前三条：登录页暗/亮两档、首页暗/亮两档、模型库空态、移动端断点。
  - **两处数据依赖被钉死**：页面级基线若随「这台机器的 DB / localStorage 里有什么」变，它就不是基线。`models` 屏用 `stubTrpc` 把 `model.list` 桩成空列表；首页用 `clearProjectIndex` 清 `canvas-store` 的项目索引（按前缀清，不写死带版本号的具体键名）。
  - 公共前置收在 `e2e/visual/support/page-baseline.ts`（`unstableChromeMasks` / `setTheme` / `settle` / `clearProjectIndex`）—— 三份 spec 各抄一份就是 §12.12 的孪生对。
  - **新增分工判据** `tests/visual-storybook-division.test.ts`（进固定清单）：story 里不许出现 `toHaveScreenshot`、不许引入第二套像素工具（Chromatic 那一族）、§11.8 声明的档不得被**减法**清掉（删掉东西比加东西更容易过 review）。不判「覆盖几个页面」：§11.8 已定调「只锁定关键 UI，不追求全组件覆盖」。
  - **如实登记一处录不全的现实**：自动化执行环境（NPC 工作区 / CNB 容器）都是 linux，新增截图名会让 win32 档缺那几张，而像素只能在那一档的机器上录。`scripts/visual-baselines.mjs` 的 `PENDING_PLATFORMS` 把它记成一条有主的账，并用双向不变式盯着：补齐了还留着登记 ⇒ 红、登记不存在的平台 ⇒ 红、`reason` 写得太短 ⇒ 红。`pixel-run` 的前置判决据此给出「正在待重录」而非「从没登记过」。

## Fixed

- **`login.visual.spec.ts` 里的过期口径**：那份文件一直写着「登录页为固定深色 UI，可作为深色主题基线样板」，而 `ThemeProvider` 的约定是「**所有**表面跟随主题 token，不存在『暗色品牌页』」—— 浅色档因此从来没被录过。现在用 `setTheme()` 写 `theme` 偏好切档，**不用** `documentElement.classList.add()`（它绕过 `next-themes`、水合时被 Provider 的偏好覆盖，且表达不出 `light` 档）。规范 §11.8 的示例代码同步改掉。

## Docs

- 规范 11 §11.8：补「当前落点」表（哪一档落在哪份 spec）、「哪件事该由谁做」的判据、`PENDING_PLATFORMS` 的双向不变式，以及示例代码改用 `setTheme`。
- `docs/guide-storybook.md`：补「这一侧真要看像素时写进 `e2e/visual`，不要写进 story」。
- `docs/guides/PRODUCTION-GAPS.md` F6：页面级视觉那一半、两处数据依赖的钉法、过期口径的纠正、以及仍待补的两档（画布 / 弹窗）。
