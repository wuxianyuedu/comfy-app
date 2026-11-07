## Fixed

- `scripts/check-mirror-attendance.mjs` 的 `judgeMirrorAttendance()` 此前只要窗口内有**一次** `present` 就退 `0 / verdict=present`。真跑读数（24h 窗口、取满 3 页 / 180 条）：`6 present + 2 egress` 仍念「出勤 ✓ 6/8」，两跑因 `Runner[orange-connector]` 到 `github.com:443` 出网被判红这件事在结论里一句都说不出来（ISSUE #3278）。于是 `pnpm check:mirror-attendance` 判得准却没人自动跑，就算给它挂个每天跑的执行者，间歇性断流期间也会天天绿、一张单都不立。
- 现在判决对象多带一份**不改三态退码**的 `signal`：`stable` / `intermittent-egress` / `egress-only` / `other-absent` / `no-verdict`。`code=0` 仍答「这一格在窗口内出过勤」，信号单独答「其中几跑是被节点出网卡住的」；`stats.egress` 与 headline 的 `egress×N（环境红/节点出网）` 让日志也能一眼对上。`--json` 带 `signal`，日志档带 `signal=` 那一行。取数编排收成 `collectMirrorAttendance()` 一份，`main()` 与每日档执行者读同一份 `payload`，不写第二套判决（§12.12）。
- 新增 `scripts/ci-mirror-egress-issue.mjs` + 每日档一格 `每日镜像出勤立案`：把按需档 `check:mirror-attendance` 变成**自动执行者**，24h 窗口出现 egress 就建单 / 在同族旧单下追加读数（去重键是标题里的固定串，不带构建号与时刻）。正文只含读数、覆盖自证与下一动作，根因写「未判定」，并带机器标记 `environment-red=github-mirror-egress`，把「环境红 ≠ 内容红」写成可 grep 的一行。列表取不到 / 窗口没盖满 / 开着的单取不到一律退 2「没结论」，不新建、不判绿（§13.6.3）。

## Changed

- **治理口径一字未改**：`ci-github-mirror-push.mjs` 不动，不给 `GitHub 镜像同步` 加回 `--readout`，`GitHub 判决回读 / 日志分块 ×3 / GitHub 判决判定` 的 fail-closed 不动（#3046「一个名字都不许摘」）。断流时 PR **照旧会红**；变的是红之前 ≤24h 已有一张单把环境红写清楚，人不必逐条翻构建日志。
- 新格带 `--no-block`：非零折成退 0，但那句红话原样打在屏幕上并给可粘贴手工出口。理由是一条链上的取舍 —— 它排在 `每日单元测试` / `每日全量E2E` 之前，而间歇性 egress 几乎天天有；做成会红的格等于每天把整条每日链 skip 掉（§13.5.21）。排在 `每日安装依赖` 之后是 `cnbSpawn()` 要装完依赖才解析得到包真身（自托管 runner 宿主 PATH 上没有 `cnb`，见 `ci-token-scopes.mjs` 五跑读数），不是排版偏好。
- `.cnb.yml` 的 `COMFYAPP_CI_DAILY_GATES` 与 `.daily-gates` 锚点同批加一格；`tests/no-platform-ci-config.test.ts` 的 `DAILY_GATES` / `GATE_TIER_LEDGER` 同步并新增一条判据钉住「有执行者 + 带 `--no-block` + 排位两头」；`docs/standards/13-提交与-code-review.md` §13.5.23 补一节，`pnpm doc:gen` 同步 `docs/generated/13-提交与-code-review.md`。

## 验证

- 真跑：`pnpm check:mirror-attendance --json` ⇒ `code=0 / verdict=present` / `signal=intermittent-egress` / `shouldFile=true` / `egress=2` / `windowBuilds=160` / 覆盖「取满窗口（24h）：3 页 / 180 条」；`node scripts/ci-mirror-egress-issue.mjs --dry-run` 同一现场打出「新建 … 正文 1158 字 · 优先级 P2 · 一条都没写」。
- `tests/check-mirror-attendance.test.ts` 20 passed（新增 7 条：6+2 仍 `code=0`、五形信号、headline 点名 egress、`--json` 与日志档都带信号）；`tests/ci-mirror-egress-issue.test.ts` 15 passed（四道门、正文只报读数、`--no-block` 只改退码不改话术）；`tests/no-platform-ci-config.test.ts` 49 passed；联动的 `doc-check-hook-wiring` / `daily-tracks` / `check-doc-mirror-pairing` / `check-doc-references` / `ci-incremental-gates` 合计 335 passed、15 skipped（win32 既有边界，按三态是「没给结论」）。
- 本机反向验证 `temp/verify-3278.mjs` **16/16**：摘掉 `shouldFile` 信号 ⇒ 执行者判 `none`（修前每天都不立案）；三道「没结论」的门都不写单；`--no-block` 只折退码不吞红话；从声明里摘掉这一格 ⇒ 声明 ⇄ 锚点当场对不上。
- 判决面：全库 `pnpm run lint`（384 规则 / 2479 文件）`0 warnings 0 errors`；`npx tsc --noEmit` 0；41 条已清零 oxlint 规则探针 0 命中；`pnpm check:ci-yaml` 5 份 YAML 可解析；`pnpm doc:gen`（`doc:check` + `doc:render`）通过；`pnpm run check:premerge` 43 条判据红 0。
