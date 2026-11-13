## Fixed

- **每日纯壳获取失败时的 404 出口不再把人引向改路径（ISSUE #3722，`scripts/fetch-daily-shell.mjs`）**：纯壳资产 `ComfyAPP-shell.exe` 由每日桌包档的回传步产出，滚动 `nightly` Release 里暂时还没有这一份时，旧提示只说「确认资产存在 / 桌包是否产出」，现场被误读成「保存目录还是旧的」。现在明确念出「上游资产尚未产出」（核对回传步与 `CNB_RELEASE_TOKEN`、或等下一轮成品、资产名不同用 `--asset` 指定），并给出立即可用的本地编壳出口 `tools/build/build-tauri-release.ps1`，同时点明本次失败与保存路径无关、不要改落点。新增 `tests/fetch-daily-shell.test.ts` 钉住规范落点 `src-tauri/target/release/app.exe`、下载 URL、404 出口措辞、鉴权重试与成功落盘 —— 该工具此前一份判据都没有，落点修正后才补上防回潮的一层。
