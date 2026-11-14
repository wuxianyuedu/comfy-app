## Fixed

- **每日纯壳获取失败时的 404 出口不再把人引向改路径（ISSUE #3722，`scripts/fetch-daily-shell.mjs`）**：旧提示只说「确认资产存在 / 桌包是否产出」，现场被误读成「保存目录还是旧的」。现在点明本次失败与保存路径无关、不要改落点，并给出立即可用的本地编壳入口 `tools/build/build-tauri-release.ps1`。新增 `tests/fetch-daily-shell.test.ts` 钉住规范落点 `src-tauri/target/release/app.exe`、下载 URL 与成功落盘 —— 该工具此前一份判据都没有，落点修正后才补上防回潮的一层。
