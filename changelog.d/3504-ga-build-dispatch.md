## Changed

CNB 侧不再执行任何构建：手动 / API 触发口（`web_trigger_*` / `api_trigger_*`）退成**纯触发入口**，实际构建全部迁到 GitHub Actions 执行（ISSUE #3504）。

- 新增 `scripts/ci-ga-dispatch.mjs`：CNB 触发口那一跳 —— 先等 sha 在镜像仓可见（fail-closed 轮询），再 `POST /actions/workflows/{file}/dispatches` 把 master HEAD 派发到 GA 对应 workflow。跑在平台池 Linux 容器（出站 `api.github.com` 同 #3418 的路径判断），退码三态（0 送达 / 1 红 / 2 没判）。
- 新增 `scripts/ci-ga-trigger-map.mjs`：触发口 ⇄ GA workflow 的**配对注册表**（5 档：daily / build / e2e / unit / package），外加「每日格逻辑名 ⇄ GA daily.yml step 名」的 `DAILY_GATE_EXECUTORS` 对照 —— 执行者核对面的唯一出处，判据 import 它。
- `.cnb.yml`：11 条触发流水线的正文统一收敛为一格 `GA 派发·<档>`（`timeout: 10m`，平台池）；旧的每日 / 单跑 / 桌包三张执行锚点清单（`*daily_gates` / `*oneshot_*` / `*package_gates` 共 30+ 格）整体退役。PR 档回读与镜像同步**留在 CNB**（只搬构建，这是用户拍板的口径）。
- 新增 4 个 GA workflow：`oneshot-build.yml` / `oneshot-e2e.yml` / `oneshot-unit.yml`（`workflow_dispatch` + `head_sha`，与 `daily.yml` 共享同形格）与 `package-desktop.yml`（windows runner：桌包工具预置 → `pnpm tauri build` → 上传安装版 / 免安装版 artifact → 发布滚动 Release nightly，另有每晚 03:37 定时档）。并发组按档各一把（`cancel-in-progress: true`），同档连点两次掐旧跑。
- `daily.yml` 补 `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "120000"`（对位 CNB 同名键，`cnb-rkr-1k510rsgg` 的取证：180 MiB 包撞 Playwright 默认 30s 套接字超时）。
- 每日格的执行者核对面从 `.cnb.yml` 的 `COMFYAPP_CI_DAILY_GATES`（连同其解析器一起删除）换到 GA `daily.yml` 的 step 名：格名 ⇄ step 名逐字登记在 `DAILY_GATE_EXECUTORS`，`FRESHNESS_TRACKS[*].ciStage` 的逻辑名保持不变（freshness-gate / daily-tracks 的判据面零改动）。
- 新增 `tests/ci-ga-trigger-map.test.ts`（注册表单元面 + 5 个 workflow 的结构真解析，接住退役的 actionlint 位）；`tests/no-platform-ci-config.test.ts` 的触发口对账 / 门格总账 / 锁判据改按新架构重写；退役的「每日 YAML 真解析」「每日工具链自证」等 7 格移入台账退役层（反向登记）。
- `.cnb/web_trigger.yml` 按钮文案按新落点重写（桌包成品的取包地从本机常驻根改为 GitHub Release / run artifacts）。
