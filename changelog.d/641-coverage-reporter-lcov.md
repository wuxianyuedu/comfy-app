## Fixed

- **CI 的「单元测试与覆盖率」步骤直接失败，全量门禁在测试这一步整段中断**：PR #641 把覆盖率改成走平台 `testing:coverage` 插件上报（插件读 `coverage/lcov.info`），但 `vitest.config.ts` 的 `coverage.reporter` 仍然只配了 `text` 与 `json-summary` —— 插件在本步开始 1.8s 后以「没有找到覆盖率报告文件」退出，vitest 根本没跑起来，这条上报与核时收益同时静默失效。现在 reporter 补上 `lcov`，两端口径对上。
- **新增回归护栏，锁住「插件 pattern ↔ vitest reporter」这条契约**：`tests/cnb-pipeline-gates.test.ts` 新增一组判据 —— 从插件声明的 `pattern` 后缀反查 vitest 该开哪个 reporter，缺失即在本地/CI 失败。此前只改一侧不会红，理由只能靠人记住，正是本仓库反复踩的「判据写两遍、漂移了没人知道」。
