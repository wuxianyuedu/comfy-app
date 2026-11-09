## Fixed

- **CNB 侧回调 build 的日志现在念得出自己绑在哪个 sha 上**（ISSUE #3430，现场见 #3378 03:48 两张贴图）：GA 收尾 job 的日志一直带 `sha=…`，而 `api_trigger_ga_verdict` 那条短流水线的「GA 结论判定」stage 只打 `conclusion=… -> success|failure` —— 排查一条回调落在哪笔 PR 预合并 sha 上，得跳去 GA run 页面翻。
- 根因是绑定 sha 只放在 `POST /-/build/start` 的请求体 `sha` 字段，没随 `env` 送进回调 build；而平台 `build-in-env.md` 的 `CNB_COMMIT` 取值表**不列** `api_trigger*` 事件（"绑 sha 时 CNB_COMMIT 等于那个 sha"只是 #3374 探针实测，无文档保证），CNB 侧因此没有确定来源的身份读数。
- 现在 `scripts/ci-ga-verdict-callback.mjs` 的 `startBuildRequest()` 在 `env` 里补 `GA_CALLBACK_SHA=<同一个预合并 sha>`（与 `GA_VERDICT` 同一条已验过的 `--env` 注入链路）；`.cnb.yml` 的内联 PS 脚本先打印 `[ga-verdict] callback sha=<全 sha> pr=<PR号> role=<角色>` 与 `[ga-verdict] callback cnb_commit=<CNB_COMMIT> sha_check=match|mismatch` 两行，结论行也带上 8 位短 sha。全 ASCII、PS 5.1 兼容，`CNB_COMMIT` 只作交叉核对、不一致时以 `GA_CALLBACK_SHA` 为准并明写 `mismatch`。
- **只加日志，不动承重**：三态退码（`exit 0/1/2`）、`GA_VERDICT` 的 fail-closed 折叠、`git.enable: false`、流水线 `name`（commit-status context 含它）、§13.5.33 判决链与 `GA 回调结论回读` 一字未改。
- 同批：GA 侧 `pr-gate.yml` 头注与回调脚本头注、`tests/ci-ga-verdict-callback.test.ts`（`GA_CALLBACK_SHA` 与请求体 `sha` 逐字相同）、`tests/no-platform-ci-config.test.ts`（钉住内联脚本的身份读数与三态退码）。
