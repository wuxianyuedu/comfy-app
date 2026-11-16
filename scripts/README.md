# scripts/ 目录导航

> 本目录是**全部工程脚本的唯一落点**。#3930 之前 360+ 份文件平铺在顶层，找东西靠 grep；
> #4111 把剩余的散放文件也归了家。现在按「家族」归入域子目录，**顶层只放单件入口**
> （每份是一个 pnpm 动词、一个钩子步骤或一个被壳 / CI 直接调用的入口）。
> 改本目录前先读 [AGENTS.md](../AGENTS.md) 的「强制先读规范文档的改动范围」表——
> 启动链路 / 壳 / 产物这几条路的判据都住在这里。

## 域子目录（一族一个目录，按前缀归家）

份数为约数（以 `git ls-files scripts` 为准）：

| 目录              | 收谁                                       | 一句话职责                                                                 |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `gates/`          | `check-*`、`gate-*`、`quality-gate*`、`premerge-*`、`shell-gate*` 与各门禁台账 `.json`（约 124 份） | 质量门禁判据与其对账台账：pre-commit / pre-push / CI 里每一条 `run "标签"` 的执行者 |
| `ci/`             | `ci-*`（79 份）                            | CI 流水线机制：派发 / 镜像 / GA 回调 / 装依赖 / 逐格判决与读数              |
| `ship/`           | `ship.mjs` + `ship-*`（38 份）             | `pnpm ship` 交单流程：分支→提交→PR→CI→合并，模块分工见 [ship.mjs 文件头](ship/ship.mjs) |
| `affected-tests/` | `affected-*`、`run-tests.*`、`full-suite-run.mjs`、`fixed-structural-tests.mjs` 等（36 份） | 受影响用例判定链 + 测试执行与记账：改动面 → import 图 → 用例清单 → 派发 / 重试 / 覆盖率 |
| `devtools/`       | 开发者工具（24 份）                        | 截图 / trace / storybook / 环境引导 / 依赖守卫 / 双击辅助 —— 人直接敲的那一层 |
| `docs/`           | 文档与 changelog 工具（11 份）             | doc:check / doc:toc / doc:render / API 文档 / 碎片并入 / 索引排除表         |
| `build/`          | 打包与产物（7 份）                         | portable 包 / 桌包发布 / 执行器宿主构建 / 产物新鲜度                        |
| `platform/`       | CNB 平台协作（6 份）                       | agent 索引与成片 / 开发汇报 / 单子身份 / 空提交                             |
| `ui-primitives/`  | `ui-primitives-*`（10 份）                 | UI 基元复用棘轮的规则库与引擎（执行者是 `gates/check-ui-primitives.cjs`）   |
| `db/`             | `db-*`、`heal-db.cjs`、`app-data-backup.mjs`（11 份） | 数据库运维：建表 / 迁移 / 备份恢复 / 自愈（`pnpm db:*` 与启动链路的 schema 同步） |
| `tw4/`            | `tw4-*`（4 份）                            | Tailwind v4 规范扫描与 codemod                                             |
| `dev-drive/`      | `dev-drive-*`（4 份）                      | 开发盘（ReFS / Dev Drive）探测与调优（`pnpm dev:drive`）                    |
| `freshness/`      | `freshness-*`（6 份，含三份 `.json` 账）   | 新鲜度账（e2e / 全量单测 / 产物三档自证）的账本与同步                      |
| `reformat/`       | `reformat-*`（3 份）                       | 格式化提交与行为改动分离的扫描核心（执行者是 `gates/check-reformat-only.cjs`） |
| `e2e/`            | `e2e-*`（3 份）                            | Playwright 编排入口与 schema 预检（`pnpm test:e2e`）                        |
| `base-check/`     | 判决链拆件 + `merged-side-loss-*`（9 份）  | `gates/base-check.mjs`（CI 红了先归因给谁）的模块与「合并另一侧损失」判定  |
| `launcher-core/`  | 启动编排的平台机制层（27 份，含 `node-engines.mjs`） | 端口 / 进程组 / 日志 / 就绪等待 —— 平台判据只收这里（§3.1–3.3）       |
| `lib/`            | 跨脚本共享库件（9 份）                     | `git-dir` / `changed-scope` / `python-probe` / `package-bin-entry` 等多个域共用的纯 Node 模块 |
| `lockfile/`       | lockfile 守卫拆件（5 份）                  | `deps:guard` 的 diff / 缓存 / 展示拆件                                      |
| `storybook-checks/` | storybook 判据拆件（3 份）               | `devtools/storybook-check.mjs` 的规则拆件                                   |

## 顶层单件入口（不在任何一族里的「命令」，19 份）

按用途分组（**这里是导航不是清单承诺**：以 `git ls-files scripts` 为准）：

- **启动与壳**（路径被 Rust 壳运行期引用，**不可移动**——见规范 §1.5 / §7.6）：
  `dev-launcher.mjs`（全平台唯一编排）、`dev-launcher.ps1`（Windows 转交入口）、
  `dev-launcher-session.mjs`、`standalone-runtime.mjs`（壳 sidecar 入口）、
  `standalone-private-inputs.mjs`、`start.mjs`、`dev.mjs`、`app-port.mjs/.ps1`、`app_port.py`、
  `app-service-exit.mjs`、`reap-process.mjs`（非 TS 宿主的整树回收 CLI）、`entry-common.ps1`、
  `install-git-hooks.mjs`（postinstall 唯一入口）。
- **构建与产物契约**：`build-desktop.mjs`（`tauri.conf.json` 的 beforeBuildCommand）、
  `executor-host.mjs`、`sidecar-name.mjs`、`parse_custom_nodes.py`（`src/app/api/custom-nodes`
  运行期派发的生成器）。

## 隐藏台账（`.` 开头，门禁的对账对象，别手改——各判据自己写 / 校验）

- **`gates/`**：`.gate-thresholds.json`（承重数值账）· `.gate-executor-ledger.json`（执行者台账）·
  `.on-demand-duties.json`（按需档索引）· `.scripts-typecheck-baseline.json`（脚本档 tsc 棘轮）·
  `.tsc-diagnostic-executors.json` · `.declaration-readers.json` · `.annotate-consumers.json` ·
  `.test-todo-consumers.json` · `.task-meta-consumers.json` · `.barrel-heavy-deps.json` ·
  `.bundle-budget-baseline.json` · `.a11y-*.json` · `.form-field-wiring-baseline.json` ·
  `.ui-primitives-baseline.json` · `.void-floats-baseline.json` · `.dependency-audit-baseline.json` ·
  `.storybook-coverage-baseline.json`。
- **`affected-tests/`**：`.test-file-timing.json`（用例耗时账）· `retired-baselines.json`（已退役基线名录）。
- **`freshness/`**：`.artifact-freshness.json` · `.e2e-freshness.json` · `.full-suite-freshness.json`。
- **`e2e/`**：`.runtime-budget-baseline.json`（性能预算基线，消费方是 e2e 用例自己）。

## 迁移纪律（改目录前必读）

- **顶层 = 单件入口，子目录 = 一族**。新脚本先问「它属于哪一族」：有族归族，无族落顶层并
  在本 README 登记（§12.18 复用优先 / §12.5.3 子域纪律的 scripts 面同一条逻辑）。
- **壳运行期引用的路径不可移动**（上面启动与壳那组）：`shell_launch.rs` 按
  「检出里有没有 `scripts/dev-launcher.mjs`」判 prebuilt / standalone 形态，动了它 =
  所有已发行壳判错形态。`app-port.mjs` / `standalone-runtime.mjs` / `reap-process.mjs` 同理
  被 `src-tauri` 直接派生或引用。
- 搬目录连带五查（§12.5.3）：import 说明符 / 门禁白名单 / 测试夹具假路径 /
  `path.resolve(__dirname, …)` / 文档与规范里的路径引用——#3930 与 #4111 两次迁移
  每一类都撞过实例；#4111 的经验是**别名锚点**（`const HERE = import.meta.dirname` 之类）
  与**分参 join**（`path.join(root, "scripts", name)`）是机器扫描最容易漏的两类。
- 门禁的执行者登记在 `.githooks/pre-commit` 的 `run` 行（标签不变、路径跟着搬），
  台账由 `gates/check-gate-executors.cjs` 双向核对。
