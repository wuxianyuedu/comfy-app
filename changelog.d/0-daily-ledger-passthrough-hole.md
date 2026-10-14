## Fixed

- **治理洞：一条 `--help` 就能买到一天的绿账 —— 三档每日自证的记账条件少了一半**。
  `e2e-run.mjs` / `full-suite-run.mjs` /
  `artifact-run.mjs` 都把额外参数**按位置透传**给底层命令，而各自的 `shouldRecord` 只看
  `exitCode === 0 && !dryRun`。实测本机中招：跑了一次 `node scripts/e2e-run.mjs --help`，
  Playwright 打完 usage **退 0**，账本当场多出一条「今天全量 e2e 绿了」且**没有**
  `skippedReason` 的记录 —— 而一次用例都没跑。
  这张账的全部价值在于它是事实（`freshness-gate` 拿它替「今天有没有人自证过」作证，
  并把「没跑起来」与「跑红了」分开处理），所以这条路径必须堵在记账侧，而不是靠人事后心虚。
- 现在收进 `freshness-ledger.mjs` 的一份形状判据 **`isWholeTrackRun(extra)`**：
  带任何透传参数（`--help` / `--list` / `--grep` 子集 / 指到单个文件）都**退 0 也不记账**，
  并明确提示「要记账就一次参数都不带地跑完它」。三档各自导出的 `shouldRecord` 都接上它 ——
  **三份 `shouldRecord` 本是逐字同形的孪生**（§12.12），这次一并收成一份共享判据，
  导出名与签名向后兼容（不带 `extra` 时仍是「绿即记」，`tests/daily-tracks.test.ts`
  原有的钉法一字未改）。
- 那条被 `--help` 写进去的假账已撤除（工作区回到上一条**带理由的真实豁免**），
  随后真跑绿的一遍把当天的账重新记上了。
- **顺带修掉这一拍自带的一句假话**：补上形状判据后多出一种形态——退出码 0、却不记账。
  三档里只有 e2e 档给它写了独立话术，另两档会继续走红的那句
  「✗ ……未通过（退出码 0）」，括号里是 0、话里说没通过，下一个人会去查一条不存在的失败。
  现在三档共用 `freshness-ledger.mjs` 的 **`notWholeTrackNotice`**（措辞与判据同源，
  不再各写一遍，§12.12），且那条分支显式判在 `exitCode === 0` 上——红仍然说红。

## 刻意没做的事（写清楚，别当成已完成）

- **没有**改成「只有 e2e 档特殊处理」：三档同形同病，只修一档的话另外两档照样能被一条参数骗出来。
- **没有**让 `--dry-run` 之外的任何透传参数「照记但标注」：账面只有「记 / 不记」两态，
  加一个「跑过子集」的第三态会让 `freshness-gate` 的判据重新变成要人读话术的东西。

## 验证

- 记账语义两向都钉：`tests/e2e-run.test.ts`（本档）与 `tests/daily-tracks.test.ts`
  （另两档各一轮，含「不带 `extra` 的旧形态仍绿即记」），外加一条**接线**断言：
  三档都得走 `notWholeTrackNotice`、且那条分支显式判「退出码 0」。
- 反例当场验过：把 `--help` 形态喂进 `shouldRecord` 返回 `false`；旧形态返回 `true`。
- **端到端复现过一次中招路径**：`node scripts/e2e-run.mjs --help` 在 Playwright 打完
  usage 退 0 之后，打印的是「○ 这一跑退出码 0，但**不记账**」，
  `scripts/.e2e-freshness.json` 的 md5 与跑前逐字一致（`d3a19afd…`）——账没被写。
- 真跑绿的那一遍仍照常记账：全量 `pnpm test:e2e` → `78 passed`，
  `node scripts/freshness-gate.mjs` 退 0。
- `tsc --noEmit` 绿；eslint 零警告；`node scripts/check-gate-flag-claims.cjs` 绿。
