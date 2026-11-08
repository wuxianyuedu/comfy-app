## Fixed

- **GA 回调「把结论送回 CNB」步骤不再在推送成功后仍显示红叉**（ISSUE #3404，现场见 #3378 贴图）：`scripts/ci-ga-verdict-callback.mjs` 的 `main()` 原先在成功拿回 `sn`（`已起回调 build …`）之后，仍按 `verdict` 返回 `CODE.FAIL=1` —— 把「GA 判红」这个**判决内容**借 step 退出码表达了出来，于是信使步骤被染红、读起来像「推送失败」。这一跳是信使：退出码只该回答「结论送没送到」，判决内容已经通过 `env.GA_VERDICT` 交给 CNB 回调 build 读、独立折红/折绿并挂进 commit-statuses（承重在那边，§13.5.33 判决链一字未动）。
- 现在前提齐全 + 成功拿回 `sn` ⇒ 恒退 `0`（判绿判红都一样），`--dry-run` 同口径；两格 fail-closed 退 `2` 不变：前提不全、或没拿回 `sn`（没发出去，绝不读成绿）。结论→`GA_VERDICT` 的 fail-closed 折叠（只认 success/neutral/skipped，其余一律折 failure）一字未改，GA 判红时 CNB 回调 build 照旧折红拦合。job 级 `continue-on-error: true` 不变，workflow run 的 conclusion（CNB 回读格读的那个）仍由五个判据 job 决定。用例同步：判红时断言退 `0` 且 `GA_VERDICT=failure` 仍如实送出。
