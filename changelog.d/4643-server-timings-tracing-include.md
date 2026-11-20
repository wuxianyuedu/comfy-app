## Fixed

- **打包产物补回 `launcher-core/server-timings.mjs`（#4643）**：#4367 引入这份执行器宿主运行期脚本时只进了 `RUNTIME_SCRIPTS` 与 `check-standalone-contents.cjs` 的清单，没同批点名进 `next.config.js` 的 `outputFileTracingIncludes`；Next 静态追踪抓不到它，产物缺件，带 `.next/standalone` 的本地检出在 executor-host 冒烟里真红（CI 的单元测试格不构建 standalone，看不见这一类缺）。现在按 §7.5.1 逐件补回 include，并在 `tests/standalone-runtime-completeness.test.ts` 钉住这条配置；本地重跑 `pnpm build` + `tests/executor-host-artifact.test.ts` 验证产物里真有它。
