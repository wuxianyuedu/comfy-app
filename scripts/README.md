# scripts/ 目录导航

> 本目录是**全部工程脚本的唯一落点**。#3930 之前 360+ 份文件平铺在顶层，找东西靠 grep；
> 现在按「家族」归入域子目录，**顶层只放单件入口**（每份是一个 pnpm 动词、一个钩子步骤
> 或一个被壳 / CI 直接调用的入口）。改本目录前先读 [AGENTS.md](../AGENTS.md) 的
> 「强制先读规范文档的改动范围」表——启动链路 / 壳 / 产物这几条路的判据都住在这里。

## 域子目录（一族一个目录，按前缀归家）

| 目录        | 收谁                                       | 一句话职责                                                                 |
| ----------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `gates/`    | `check-*`、`gate-*`（85 份）               | 质量门禁判据：pre-commit / pre-push / CI 里每一条 `run "标签"` 的执行者     |
| `ci/`       | `ci-*`（76 份）                            | CI 流水线机制：派发 / 镜像 / GA 回调 / 装依赖 / 逐格判决与读数              |
| `ship/`     | `ship.mjs` + `ship-*`（36 份）             | `pnpm ship` 交单流程：分支→提交→PR→CI→合并，模块分工见 [ship.mjs 文件头](ship/ship.mjs) |
| `affected-tests/` | `affected-*`、`run-affected-tests.mjs`（23 份） | 受影响用例判定链：改动面 → 静态 import 图 → 用例清单 → 派发与重试        |
| `ui-primitives/`  | `ui-primitives-*`（10 份）            | UI 基元复用棘轮的规则库与引擎（执行者是 `gates/check-ui-primitives.cjs`）   |
| `db/`       | `db-*`（8 份）                             | 数据库运维命令：建表 / 迁移 / 备份恢复 / 同步（`pnpm db:*` 的实现）         |
| `tw4/`      | `tw4-*`（4 份）                            | Tailwind v4 规范扫描与 codemod                                             |
| `dev-drive/`| `dev-drive-*`（4 份）                      | 开发盘（ReFS / Dev Drive）探测与调优（`pnpm dev:drive`）                    |
| `freshness/`| `freshness-*`（3 份）                      | 新鲜度账（e2e / 全量单测 / 产物三档自证）的账本与同步                      |
| `reformat/` | `reformat-*`（3 份）                       | 格式化提交与行为改动分离的扫描核心（执行者是 `gates/check-reformat-only.cjs`） |
| `e2e/`      | `e2e-*`（3 份）                            | Playwright 编排入口与 schema 预检（`pnpm test:e2e`）                        |
| `base-check/` | 判决链拆件 + `merged-side-loss-*`（8 份） | `base-check.mjs`（CI 红了先归因给谁）的模块与「合并另一侧损失」判定        |
| `launcher-core/` | 启动编排的平台机制层                  | 端口 / 进程组 / 日志 / 就绪等待 —— 平台判据只收这里（§3.1–3.3）             |
| `lib/`      | 共享库件                                   | 多个顶层脚本共用的纯 Node 模块                                              |
| `lockfile/` | lockfile 守卫拆件                          | `deps:guard` 的 diff / 缓存 / 展示拆件                                      |
| `storybook-checks/` | storybook 判据拆件                | `gates/check-storybook-*` 与 `storybook-check.mjs` 的规则拆件               |

## 顶层单件入口（不在任何一族里的「命令」）

顶层每份文件是一个入口。按用途分组列出（**这里是导航不是清单承诺**：以 `git ls-files scripts` 为准）：

- **启动与壳**（路径被 Rust 壳运行期引用，**不可移动**——见规范 §1.5 / §7.6）：
  `dev-launcher.mjs`（全平台唯一编排）、`dev-launcher.ps1`（Windows 转交入口）、
  `dev-launcher-session.mjs`、`standalone-runtime.mjs`（壳 sidecar 入口）、
  `standalone-private-inputs.mjs`、`standalone-dev-artifacts.mjs`、`standalone-link-repair.mjs`、
  `start.mjs`、`dev.mjs`、`start_tauri_launcher.py`、`app-port.mjs/.ps1`、`app_port.py`、
  `app-service-exit.mjs`、`reap-process.mjs`（非 TS 宿主的整树回收 CLI）、`entry-common.ps1`。
- **构建与产物**：`build-desktop.mjs`、`build-executor-host.mjs`、`publish-desktop-bundle.mjs`、
  `package-bin-entry.mjs`、`package-desktop-portable.mjs`、`tauri-tools-cache.mjs`、
  `shell-gate.mjs`、`shell-gate-cargo.mjs`、`shell-smoke.mjs`、`smoke-executor-host-standalone.mjs`、
  `spawn-shell-scan.mjs`、`check-app-port-vectors.cjs/.ps1/.py`、`win32-*.py`。
- **提交与合并流程**：`premerge-check.mjs`（`check:premerge`）、`premerge-proof.mjs`、
  `premerge-timing.mjs`、`quality-gate.mjs/.ps1`、`quality-gate-shared.mjs`、
  `install-git-hooks.mjs`、`intentional-empty-commit.mjs`、`known-failed-selftest-gate.mjs`、
  `suspended-gate-tests.mjs`、`worktree-remove.mjs`、`git-dir.mjs`、`git-name-status.mjs`、
  `git-dir-literal-scan.mjs`。
- **测试编排**：`run-tests.mjs/.ps1`、`run-ast-gates.cjs`、`vitest-projects.cjs`、
  `junit-readout-diag.mjs`、`changed-scope.mjs`、`file-size-proximity.cjs`、`file-structure-rules.cjs`。
- **文档工具链**：`doc-facts.cjs`、`doc-reading-map.mjs`、`doc-toc.mjs`、
  `generate-docs.mjs/.ps1`、`generate-api-docs.mjs`、`typedoc-run.mjs`、
  `render-doc-placeholders.cjs`、`check-doc-references.cjs`、`repair-imports.cjs`。
- **CI 之外的诊断与读数**：`base-check.mjs`、`ci-load.mjs`（在 `ci/`）、`artifact-run.mjs`、
  `coverage-readout.mjs`（在 `ci/`）、`daily-run.mjs`、`fetch-daily-shell.mjs`、
  `screenshot.mjs`（`pnpm screenshot`）、`session-report.mjs`（`pnpm report:session`）、
  `progress-heartbeat.mjs`、`precommit-timing.mjs`、`premerge-timing.mjs`。
- **本地环境**：`env-init.mjs`、`env-preflight.mjs`、`dev-handle.mjs`、`deps-install-guard.mjs`、
  `prune-virtual-store.mjs`、`force-ipv4-dns.cjs`、`python-probe.mjs`、`node-engines.mjs`、
  `setup-comfy-cli-venv.mjs/.ps1`、`enable-ps1-double-click.ps1`、`prepare-local-run.ps1`、
  `sync-lint.ps1`、`install-comfyapp-helper.ps1`、`comfyapp-open-folder.ps1`、
  `parse_custom_nodes.py`、`heal-db.cjs`、`qoder-ignore.mjs`、`cnb-fields.mjs`。
- **应用侧联动**：`agent-film.mjs`、`agent-index.mjs`、`app-data-backup.mjs`、
  `executor-host.mjs`、`sidecar-name.mjs`、`docs-api-input-closure.mjs`、`cli-arg-contract.mjs`、
  `gates-which.mjs`（`pnpm gates:which`）、`full-suite-run.mjs`、`dependency-face.mjs`、
  `eslint-gate-canary.mjs`、`theme-color-exemptions.cjs`、`retired-baselines.json`。

## 隐藏台账（`.` 开头，门禁的对账对象，别手改——各判据自己写 / 校验）

`.gate-thresholds.json`（承重数值账）· `.gate-executor-ledger.json`（执行者台账）·
`.on-demand-duties.json`（按需档索引）· `.scripts-typecheck-baseline.json`（脚本档 tsc 棘轮）·
`.tsc-diagnostic-executors.json` · `.declaration-readers.json` · `.annotate-consumers.json` ·
`.test-todo-consumers.json` · `.task-meta-consumers.json` · `.barrel-heavy-deps.json` ·
`.bundle-budget-baseline.json` · `.runtime-budget-baseline.json` · `.a11y-*.json` ·
`.form-field-wiring-baseline.json` · `.ui-primitives-baseline.json` · `.void-floats-baseline.json` ·
`.dependency-audit-baseline.json` · `.artifact-freshness.json` · `.e2e-freshness.json` ·
`.full-suite-freshness.json` · `.storybook-coverage-baseline.json` · `.test-file-timing.json` ·
`.theme-color-baseline.json`（若在场）

## 迁移纪律（改目录前必读）

- **顶层 = 单件入口，子目录 = 一族**。新脚本先问「它属于哪一族」：有族归族，无族落顶层并
  在本 README 登记（§12.18 复用优先 / §12.5.3 子域纪律的 scripts 面同一条逻辑）。
- **壳运行期引用的路径不可移动**（上面启动与壳那组）：`shell_launch.rs` 按
  「检出里有没有 `scripts/dev-launcher.mjs`」判 prebuilt / standalone 形态，动了它 =
  所有已发行壳判错形态。
- 搬目录连带五查（§12.5.3）：import 说明符 / 门禁白名单 / 测试夹具假路径 /
  `path.resolve(__dirname, …)` / 文档与规范里的路径引用——本次迁移（#3930）每一类都撞过实例。
- 门禁的执行者登记在 `.githooks/pre-commit` 的 `run` 行（标签不变、路径跟着搬），
  台账由 `gates/check-gate-executors.cjs` 双向核对。
