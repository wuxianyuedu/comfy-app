## Added

- **win32 档那 4 张缺失基线的「补录」从文档里一句话，变成流程上有守卫、有入口、会被点名的动作**（ISSUE #1381）。
  - **口径登记成数据**：`scripts/visual-baselines.mjs` 新增 `PLATFORM_RECORDING`（每档录于 `dev` 还是 `start` 口径），`SUPPORTED_PLATFORMS` 从它**派生**（不另写一份数组，两处不会漂）。口径此前只写在文档里，**录基线那一档完全不校验它**。
  - **录基线档补缺口径守卫**：`scripts/pixel-run.mjs` 起 webServer / 浏览器之前先核「本机 `CI` 的真假换算出的 webServer 口径」与「该档登记的口径」是否一致（`checkRecordingEnv`），不一致直接拦下（退出码 3）并给出置法。为什么录基线档也要拦：口径不符时 `--update` 会**成功** —— 生成一套看着正常的 PNG，自洽、不当场红，只在以后某次真差异里混进来、还指不出是它。`pnpm check:visual --dry-run` 会把「本档登记为哪条 / 本机实走哪条」一起打出来。
  - **「待重录」的账在改像素层时被点名**：`scripts/visual-gate.mjs`（改了 `e2e/visual/**` 才跑那一步）在放行后顺手打印一行 —— 哪几档还缺、只能在哪台机器补、补完连同 `PENDING_PLATFORMS` 那条登记一起删。**不阻断**是刻意的：补录只能在那一档的机器上做，阻断等于让所有人卡在一个只有少数人能解的账上。

## Docs

- 规范 11 §11.8：新增两条 ⚠️ ——「基线按 webServer 口径录」这条现在有数据也有判据（`PLATFORM_RECORDING` + `checkRecordingEnv`）、以及「待重录」的账在改像素层时被点名（不阻断）的理由。
- `docs/guides/TESTING.md`：补口径守卫的入口与动作。
