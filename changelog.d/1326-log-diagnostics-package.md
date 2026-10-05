## Added

- **一键打包诊断现场**（ISSUE #1326 第 3 刀）：日志面板新增「打包诊断」按钮 → `POST /api/logs/diagnostics`，把 `log/current/`（本次运行）+ 最近 3 次 `log/runs/` 打成一个 zip 落在 `log/exports/diagnostics-<日期>_<时分秒>-<runId>.zip`，并把**绝对路径**回给面板显示。
  - 与既有的「保存到本地」分工不同、不可互相替代：「保存到本地」存的是**面板当前筛选到的行**（用户看得见的东西）；「打包诊断」带走的是**诊断要的整份现场** —— `run.json`（runId / 应用版本 / 分支 / commit / 各进程 pid / 退出码 / 耗时）、上一次崩溃留下的残留（`crashed: true`）、ComfyUI 通信层原始回执。这些都是面板上看不到、而报 bug 时最该有的东西。
  - 打包逻辑**不在端点里实现**：复用启动编排的 `exportDiagnostics()`（`scripts/launcher-core/run.mjs`）—— 归档/保留/目录名形态与写方共用同一份判据，在端点里再写一遍压缩就是第二条实现（且它必然先漂）。这与 `POST /api/schema/push` 直接 import `scripts/db-schema-state.mjs` 是同一种形态。
  - 端点把**日志根的父目录**交给 `exportDiagnostics`（它按 `root/log` 定位），而不是传 `process.cwd()`：让「日志在哪」只有一处判断（§12.14），否则两处语义一旦不同，表现是「打包出来的包里没有日志」。
  - `scripts/launcher-core/run.mjs` 已在桌包载荷白名单里（第 2 刀登记），所以打包能力脱离仓库也还在。

## Notes

- `src/components/studio/logs/log-store.ts` 加完这一处到 **899 行**（R5 阈值 900）。刻意把 store 上的说明压成一行、把完整分工写进 `log-file-client` 的 `saveDiagnosticsPackage` —— 不是「塞得下就行」，是这一刀不该顺手把拆分一起做（那会让 PR 混进两种改动）。它已经贴着阈值，下一次碰它的人该先拆。

## Tests

- `src/app/api/logs/diagnostics/route.test.ts`：产物**真的能解开**（用 `python3 zipfile` 验 CRC，不靠「文件存在」）、内容含 `current/run.json` 与历史包（缺了就等于没打包）、暂存目录不留痕、未登录 401 且不落盘。
- `LogPanel.test.tsx` 新增一例：两个按钮各走自己的端点 —— 「打包诊断」请求不带 body（服务端自己找现场），断言它没被接到 `/api/logs/export` 上。
