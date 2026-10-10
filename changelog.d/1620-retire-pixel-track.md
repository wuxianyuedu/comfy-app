## Removed

- **像素回归层整档撤掉**（ISSUE #1620）—— `e2e/visual/**`（5 份 spec + 30 张基线 PNG +
  `support/page-baseline.ts`）、`scripts/pixel-run.mjs` / `visual-gate.mjs` /
  `recording-font-capability.mjs`、`scripts/.visual-baseline-freshness.json`、
  `package.json` 的 `test:visual` / `check:visual` / `check:visual:update`、
  `playwright.config.ts` 的 `*.visual.spec.ts` 与 `expect.toHaveScreenshot` 那一块、
  `GATES.visual`（`.mjs` / `.ps1` 两侧）与 §9.5 对照表那一行、
  `.githooks/pre-commit` 的两步，以及 7 份相关用例。

  理由是**收益比不成立**：结论只在录过基线的那台机器上成立（基线名带 `process.platform`
  ⇒ 每一档执行环境各要一套 PNG，两档的差异落在字形光栅化上）、平台名担保不了**字体栈**
  （同一个 `-linux` 名下缺 CJK 字体的容器差 1767 像素）、每屏的录制输入面要显式登记
  （实测一份只桩了 2 格的首页 spec，真实链路上有 16 个 `/api/**` 由机器在答）、
  而每次过期都要人逐张看图定性 —— 换来的是一小撮代表屏的覆盖。

  **「界面有没有变形」从此没有任何自动判据**：这是有意的空白，规范 §11.8 写清了它归谁
  （归 review 看图），并明确**不许**拿 DOM 快照或 Storybook 的截图断言去补。撤掉不是
  「暂时不跑」：留一份对不上现状的基线比没有基线更坏。

## Changed

- **新鲜度账内核改名并瘦身**：`scripts/visual-baselines.mjs` → `scripts/freshness-ledger.mjs`。
  像素档那一半（`VISUAL_DIR` / `PLATFORM_RECORDING` / `SUPPORTED_PLATFORMS` /
  `PENDING_PLATFORMS` / 基线清点与配对那批函数 / `checkRecordingEnv`）随档删除；
  剩下的是**三档共用**的那部分（`FRESHNESS_TRACKS` / `freshnessRecord` /
  `freshnessVerdict` / `checkFreshnessLedger` / `writeFreshness` / `writeSkipRecord` /
  `freshnessAge` / `isSameLocalDay` / `dirtiesTrack` / `isUsableSkipReason`）
  —— 三档的「每天首次自证」口径不变。
- `gitUser` 从 `pixel-run.mjs` 挪进 `freshness-ledger.mjs`（它本来就是各档跑法脚本共用的
  记账帮手，此前放在像素档的入口里）。
- **`gatedByPending` / `dailyDemanded` 一并撤掉**：它们的存在理由只有像素档
  （「还有平台档缺成套基线 ⇒ 『每天自证』这句话说不出口」）。三档都按 `track.daily` 判，
  「这一档今天要不要凭证」现在读的就是那一栏数据。
- `scripts/visual-freshness-gate.mjs` → `scripts/freshness-gate.mjs`：判的还是那三档的账，
  只是不再有平台档 / 待补录那一套（`trackScopes` 从 `{kind, platforms, pending}` 收成
  `{kind, keys}`）。
- `.githooks/pre-commit` 的 D 组少一步（「像素层提交带像素判决」），
  「每档都有主」那一步改调 `freshness-gate.mjs`，标签改成三档。

## Docs

- 规范 11 §11.8 由「像素基线怎么做」改写为「**这一档为什么删、删了之后归谁**」：
  收益比那几条实测、撤掉时同批必须动的东西（只删一半 = 判据挂在不存在的东西上）、
  以及**仍然在跑的三档「每天首次自证」**（口径表、两条出路、边界逐条保留）。
- §11.1 的测试分层表去掉「视觉回归」那一行；§11.9 的 DOM 快照边界改成「视觉防退化
  **现在没有自动判据**，且不许拿 DOM 快照去补」。
- §13.5.3 / §13.5.4 的按需档表与理由段落同步（像素那一行改成撤档说明）；
  `docs/guides/TESTING.md` 的「视觉回归」一节改成同一份记录 +
  已知边界的「页面级视觉回归完全没有执行者」一条；
  `docs/guides/PRODUCTION-GAPS.md` 的 F6 与 E3″ 两处现场同步；
  §9.5 跨平台动作对照表去掉像素回归那一行；`guide-storybook.md` / `DESIGN.md` 里指向
  已删层的说法改成现状（并明确「不许因为没人管了就把截图断言写进 story」）。
- `docs/generated/**` 随原文重生成。
- 台账三处同步：`.on-demand-duties.json` 去掉 `visual-freshness` / `pixel-gate-entry`，
  `.declaration-readers.json` 去掉 `pixel-out-of-check-all` 并改 `visual-baseline-freshness`
  那一行，`.tsc-diagnostic-executors.json` 的路径改指 `freshness-ledger.mjs`。

## Tests

- 删 `tests/pixel-run.test.ts` / `visual-baseline-pairing.test.ts` / `visual-baselines.test.ts` /
  `visual-freshness-gate.test.ts` / `visual-gate.test.ts` / `visual-recording-inputs.test.ts` /
  `recording-font-capability.test.ts` / `visual-storybook-division.test.ts`。
- `tests/daily-tracks.test.ts`：登记形状从四档收成三档；`gatedByPending` 那一组换成
  「三档都按日历日判」；`skipHow` 逐档都判（豁免那条出路每一档都要有）。
- `tests/e2e-run.test.ts`：`trackedBy` 抄混那条用例换成跨档（`full` 写进 `e2e` 的账）；
  差异栏改成「`daily` / `skipHow` / 输入面」三项。
- `tests/on-demand-duties-gate.test.ts`：夹具补一条 `on-demand-ledger` 事实
  （台账留一格余量，`MIN_DUTIES` 仍是 5）。
- `tests/gate-executors.test.ts` / `helpers/quality-gate-gates.ts` / `ps1-consistency.test.ts`：
  去掉只属于像素档的两份入口与消费方说明。
