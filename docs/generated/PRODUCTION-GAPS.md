<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/guides/PRODUCTION-GAPS.md`。改动请回源文件，再重新生成。 -->

# 生产级缺口清单(Production Gaps)

> 2026-08-30 全库审查(结构/类型/测试/安全/规范)沉淀的未竟事项。
> 每项含优先级与建议路径。完成一项划掉一项。
>
> **巡检约定**：本清单每季度按 [docs/README.md §7](../../README.md) 的季度巡检流程逐条复核，
> 已完成项勾掉、过时项改写成现状或删除、仍开放项保留并指向承接它的 Issue。
> 上次巡检：2026-09-27（本轮新增七维审计台账，见下方「2026-09-27 全库商业级差距审计」；原 2026-08-30 台账条目均已闭环或流程化保留）。

## P0 — 安全/正确性

- ~~`task.cancel` 越权(任意用户可取消他人任务)~~ **已修复**(08669df,含回归测试)。
- ~~`scripts/parse_custom_nodes.py` 与 `src/generated/` 不在仓库~~ **已解决**:
  - 解析器本身在仓库:`scripts/parse_custom_nodes.py`(`git ls-files` 可见);
  - `src/generated/` 是**构建产物**(`.gitignore:82` 明确忽略),由构建期生成,
    不需要入库——原条目把「产物不入库」误判成缺口。custom-nodes 路由的
    spawn 路径与优雅降级保留现状。
- ~~LLM `provider` 字段:garbage 值静默回退 local 并覆盖 DB 的 remote 配置~~
  **已解决**(ISSUE #309 P0 批次):`src/server/api/routers/llm.ts:34,75` 收紧为
  `z.enum(["local", "remote"])`,垃圾值在校验层被拒;历史遗留的默认值由
  `schema.ts` 的 `provider` 列默认 `"local"` 承接,不再有静默改写。

## P1 — 测试覆盖爬坡(商业级下限)

- [x] ReactFlow Provider 包装方案落地(tests/helpers/react-flow.tsx)+
      CanvasNode/FlowNode 渲染冒烟与折叠交互(7 用例)。表单/生成链路的深度
      行为测试(fetch/poll 生命周期)仍开放。
- [x] `CustomNodesSettings` 主组件拆分后行为测试:组件已按四层范式拆为容器 73 +
      视图 379 + hook 503 + 纯函数模块,并补齐逻辑层行为测试
      (`hooks/use-custom-nodes-settings.test.ts`,17 用例:失败路径必须有可见出口、
      打开才请求、解析收尾时序、派生分组计数)。
- [x] Playwright 框架 + 冒烟 E2E(`e2e/smoke.spec.ts`:login 渲染/Tab 切换、
      `/` 重定向 workspace)与核心链路 E2E(`e2e/critical-flows.spec.ts`,
      进 `@critical` 门禁)。命令:`pnpm test:e2e`(原记录写作 npm 形式,
      违反 AGENTS 硬规则 1「包管理只用 pnpm」,已于 2026-09-10 巡检修正)。
- [x] 覆盖率棘轮抬升:`src/lib/comfyui/**` 两批模块相继入榜,判断规则与
      调度判决被逐条断言: - `lifecycle.ts` 的判决表抽到纯函数模块 `lifecycle-derive.ts`(90% 硬门槛),
      `lifecycle.ts` 本体按实测值设门槛(45/60/45 + 分支 30); - 两条 sweeper(`reaper.ts` 70/60)与调度器(`executor-scheduler.ts` 70/50)
      的判决矩阵测试落地后按实测值设门槛。
      新增 `comfyui/**` 模块的测试后,按同样方式把各自门槛加进 §11.7 棘轮表。

## P2 — 架构路线图(见 reviews/2026-08-30-canvasnode-review.md)

- [x] `canvas-types.ts` 收窄 `CanvasNodeData` 索引签名(ISSUE #320):拆成
      `StrictCanvasNodeData`(业务代码用,拼错字段名编译报错) +
      `CanvasNodeData = Strict & Record<string, unknown>`(仅 ReactFlow 类型参数
      位置)+ `asCanvasNodeData()` 单点收口;画布链路 `as unknown as` / `as never`
      清零;两处 Prisma Json 边界改为 Zod 校验。
- [x] `errorSuggestion` 正则规则表外置为数据(**已过时项,已改判为完成**)。
      规则表**已外置**到数据模块
      `src/components/studio/project-canvas/CanvasNode/error-suggestions.ts`
      (`ERROR_SUGGESTION_RULES` 数组 + `pattern` / `suggestion` 数据项),
      `ErrorPanel.tsx` 只消费 `suggestForError()`。原条目按「未做」记录,
      复核后改判为已完成。
- [ ] 注册表触发式采纳(仍开放):下次新增节点 kind 时按
      reviews/2026-08-30-canvasnode-review.md 第二节执行顺序走。
      **性质**:流程性约定(触发条件是「下次新增节点 kind」),无完成态,
      长期保留作为执行提醒;不需要新开 Issue 承接。

## P3 — 卫生/规范执行

- [x] 文件级 `no-explicit-any` 头 59 → 0(895f99c 等)。
- [x] 未使用/单规则可修的 eslint-disable 头清理(5355a2b)。
- [x] lint warning 清零:全库 `eslint . --max-warnings 0` 退出码 0(零错误
      零警告)。**本地 pre-commit 此前只判「无 error」而 CI 判零警告,口径不一致
      ——warning 能在本地进历史、到 CI 才被拦下(复核返工)。**已把 pre-commit
      对齐为零警告口径(ISSUE #322);剩余行内 disable 全部带可核验理由
      (exhaustive-deps 按三分类法逐条判定,prefer-nullish 属「伪建议」类:
      空串在服务端反序列化产物里表示「没有值」,`??` 会改语义)。
- [x] `CustomNodesSettings` 主组件进一步拆分(见 P1 对应条目,容器 73 行)。
- [x] `DynamicWorkflowForm` 已拆为四层(容器 44 + 视图 249 + hook 261 + 纯函数
      105),并补齐逻辑层行为测试(30 用例:行归属、多模式可见性、拖拽重排、
      图片上传、默认值刷新口径,见 ISSUE #319)。`CustomNodesSettings` 同批拆分
      与测试见 ISSUE #318。
- [x] `components/model/model-library.tsx` 与 `studio/ModelLibrary.tsx`
      语义撞车的处置(原条目「确认两者职责或合并」)。
      **结论:确认职责,不合并**——两者服务不同路由、各自独立握手: - `components/model/ModelLibrary.tsx` 服务 `/models` 独立页
      (`app/(main)/models/page.tsx` 唯一消费方),面向「模型卡片库」浏览; - `components/studio/ModelLibrary.tsx` 服务 `/workspace` 工作室内页签
      (`app/workspace/page.tsx` 经 `studio/index.ts` 动态导入),面向
      「本机 ComfyUI 可用模型按扫描目录分类」。
      两者已各自按规范 §17 四层范式拆分,逻辑分别落在各自的
      `hooks/use-model-library.ts`,消费方互不交叉,无需合并。
      治理记录见 `docs/standards/17-UI与逻辑分离.md` §17.6.2。

## 2026-09-27 全库商业级差距审计（新增台账）

> 七维审计（安全 / 供应链 / 发布运维 / 可观测 / 测试工程 / 产品化 / 桌面壳）沉淀的未竟事项。
> 与上方 2026-08-30 台账相互独立、并列勾销；原 P0 三项已闭环，本轮 P0 为新增阻塞项。
> 每条含优先级、证据路径与建议路径；完成一项划掉一项。上轮巡检：2026-09-27。

### P0 — 缺了就不算「已发布产品」（阻塞发布）

- [ ] **P0-1 无 CI/CD**：`.github/workflows` / `*.cnb.yml` 均不存在，门禁只在本地且 `--no-verify` 可绕过，无第二执行者。建议：CNB 流水线跑 `pnpm check` + 全量 `vitest run --coverage` + 棘轮 `--strict` + `pnpm audit`。证据：`docs/standards/11-测试与可观测性.md:160-167`；`docs/standards/12-代码组织与文件结构.md:534-535`。
- [ ] **P0-2 自动更新未接通**：`tauri.conf.json` `updater.endpoints:[]` / `pubkey:""` / 未开 `createUpdaterArtifacts`；能力已开校验全无（填端点即变未验签更新）。需：生成 keypair、配端点、开产物。证据：`src-tauri/tauri.conf.json:34-41,43-67`；`src-tauri/capabilities/remote.json:19`。
- [ ] **P0-3 客户端崩溃零上报**：缺 `src/sentry.client.config.ts`，`instrumentation.ts` 仅 nodejs/edge 分支；ErrorBoundary 仅 `console.error`。证据：`src/instrumentation.ts:8-24`；`src/components/ui/error-boundary.tsx:31-35`。
- [ ] **P0-4 无 release / source map 关联**：`next.config.js` 无 `withSentryConfig` / sourceMap 上传，堆栈无法符号化。证据：`next.config.js`（grep sentry/Sentry/sourceMap = 0）。
- [ ] **P0-5 无版本化 DB 迁移**：`drizzle/` 不存在，主推 `db:push`（无 TTY 可「报错 + exit 0 + 留 0 字节库」）。需：`drizzle-kit generate` 落地 + 禁用无 TTY push。证据：`package.json:13`；`src/server/db.ts:41-52`。
- [ ] **P0-6 无代码签名 / 公证**：缺 `certificateThumbprint` / `macOS.signingIdentity` / `publisher` / `licenseFile`。证据：`src-tauri/tauri.conf.json:43-67`；`src-tauri/Cargo.toml:6`。

### P1 — 安全正确性与运维可见性

- [ ] **A1 鉴权默认关闭**：无会话回落演示用户，`loginRequired` 默认 false，约 20 个 router 可写。证据：`src/lib/auth-server.ts:99-106`；`src/lib/app-settings/index.ts:96`。需评估默认强鉴权或显式化。
- [ ] **A2 IDOR：`task.workflow` 无归属校验**（同文件 delete 有 `userId` 判定）。证据：`src/server/api/routers/task.ts:179-194`。
- [ ] **A3 IDOR：`project.outputs` 无归属校验**（get/patch 有 owner 判定）。证据：`src/server/api/routers/project.ts:74-79`。
- [ ] **A4 LLM `apiKey` 明文回传客户端**（含远端条目）。证据：`src/lib/llm/server.ts:184`；`src/server/api/routers/llm.ts:60-64`。
- [ ] **A5 SSRF：`llm` / `comfyEmbeddable` 任意 URL 服务端 fetch 带 Bearer**（`trainerUrl` 有 `^https?://` 校验，这两处无）。证据：`src/server/api/routers/llm.ts:151-165`；`setting.ts:158-166`；`src/lib/comfy/comfy-embed.ts:274-280`。
- [ ] **A6 `/api/custom-nodes` 参数注入 → 任意文件覆写**（`--only-pkgs` 可被 `--out=` 覆盖）。证据：`src/app/api/custom-nodes/route.ts:768-777,506-513`。
- [ ] **A7 `workflow.create.sourcePath` 读本机任意文件 + 路径回显**。证据：`src/server/api/routers/workflow.ts:450-471`；`src/lib/comfyui/importSource.ts:66-70`。
- [ ] **A8 `task.delete` 缺路径包含校验**（与 `openFolder` 白名单不自洽，`../` 不拦）。证据：`src/server/api/routers/task.ts:207-218`。
- [ ] **A9 无 `middleware.ts`、better-auth 未配 `trustedOrigins`；限流仅 1 个 mutation**。证据：`src/server/better-auth/config.ts:8-39`；`src/server/api/routers/task.ts:197`。
- [ ] **A10 脚手架残留 `post.getSecretMessage` 仍在路由表**。证据：`src/server/api/routers/post.ts:23-25`。
- [ ] **B1 capability 对回环通配源开满**（`http://127.0.0.1:*` + `process:default` / `updater:default`）。证据：`src-tauri/capabilities/remote.json:8-26`；`src-tauri/tauri.conf.json:31`。
- [ ] **B2 生产路径 21 处 `unwrap()` + 构建失败 panic**，无降级 UI。证据：`src-tauri/src/lib.rs:72,918,1391,1741`；`shell_launch.rs:78,83,201`。
- [ ] **B3 违反自身规范：`std::process::Command` 直起外部进程 3 处**（应走 `tauri-plugin-shell`）。证据：`src-tauri/src/shell_launch.rs:575`；`lib.rs:1167`；`detached_spawn.rs:147`。
- [ ] **B4 安装型部署回收退化**（回收依赖项目根脚本，副本中不成立；`kill_sidecar` 被 `#[cfg(not(debug_assertions))]` 排除）。证据：`src-tauri/src/lib.rs:1153-1182,2205-2206`。
- [ ] **B5 sidecar 崩溃无重拉 / 退避**（watchdog 只盯 splash）。证据：`src-tauri/src/shell_launch.rs:661-668`；`lib.rs:2101`。
- [ ] **B6 `externalBin` 仅 Windows-msvc 一份 node（89MB 入库）**，跨平台出包不可行。证据：`src-tauri/tauri.conf.json:54-56`。
- [ ] **B7 无 panic hook / 错误全 `String` 化**，前端无法按错误码分支。证据：`src-tauri/Cargo.toml:28-47`（无 thiserror/anyhow）。
- [ ] **B8 退出无二次确认 / 无 `prevent_close`**。证据：`src-tauri/src/lib.rs:1384-1410`。
- [ ] **C1 零依赖漏洞扫描 / license 合规 / SBOM / 自动升级**。证据：全仓 renovate/dependabot/audit/sbom = 0。
- [ ] **C2 `minimumReleaseAge: 0`** 关闭投毒版本时间窗。证据：`pnpm-workspace.yaml:6`。
- [ ] **C3 `.env.production` / `.env.development` 未被忽略**（仅 `.env` + `.env*.local`）。证据：`.gitignore:37-38` vs `next.config.js:50`。（已修：`.gitignore` 改为 `.env.*` + `!.env.example`）
- [ ] **C4 `Cargo.lock` 被忽略** → Rust 二进制依赖树不可复现。证据：`.gitignore:113-114`。
- [ ] **C5 `pnpm-workspace.yaml` 无 `packages:` 字段** + `allowBuilds` 手工清单疑漏 `sharp`。证据：`pnpm-workspace.yaml`（grep packages = 0）；`pnpm-lock.yaml:12198`。
- [ ] **C6 生产 CSP 仍 `'unsafe-inline'`**，无 nonce/hash / `object-src 'none'` / `upgrade-insecure-requests` / `report-uri`。证据：`next.config.js:109-112`。
- [ ] **C7 未关 `poweredByHeader`**；`typescript.ignoreBuildErrors:true`。证据：`next.config.js`（0 命中）/ `:17-19`。
- [ ] **C8 `shadcn` CLI 错放 `dependencies`**。证据：`package.json:83`。
- [ ] **D1 日志无轮转无上限**（固定名 `app-runtime.log` 纯 append）。证据：`src/lib/log/app-runtime-log.ts:85`；`log-sessions.ts:5`。
- [ ] **D2 日志级别不可运行时调整**。证据：`src/lib/core/logger.ts:115,161`。
- [ ] **D3 日志不出用户机器**（无上报 / 导出通道）。证据：`src/lib/core/logger.ts:145-154`。
- [ ] **D4 Sentry 无 release / tags / 用户上下文 / 离线缓存；Edge 缺 beforeSend 脱敏**。证据：`src/sentry.server.config.ts:8-21`；`src/sentry.edge.config.ts:14-18`。
- [ ] **D5 `/api/health` 仅 `{status,db,t}` 且 `*` CORS + 回显运维命令**。证据：`src/app/api/health/route.ts:27,39,46`。
- [ ] **D6 无自动备份 / 恢复工具**（仅手册）。证据：`docs/guide-database-backup.md:37-42`。
- [ ] **D7 版本号三处手工重复（均 0.1.0）** 无同步守卫。证据：`package.json:3` / `tauri.conf.json:4` / `Cargo.toml:3`。

### P2 — 成熟度与体验

- [ ] **E1 pre-commit 仅跑 7 测试文件（1.6%）**；`check:all` 仅 4 项不含棘轮。证据：`.githooks/pre-commit:63-70`；`scripts/quality-gate.mjs:39-65`。
- [ ] **E2 覆盖率门槛是死配置**（test 门无 `--coverage`）。证据：`scripts/quality-gate.mjs:61-64`；`vitest.config.ts:22-23,41-59,146-181`。
- [ ] **E3 服务端集成覆盖 4/16 router**；E2E 仅 3 spec / 31 用例且无登录态。证据：`src/server/api/routers/**`；`e2e/*.spec.ts`；`playwright.config.ts`。
- [ ] **E4 msw 仅 7 文件使用**；缺 zod↔API 契约测试。
- [ ] **E5 棘轮 `--update` 无制衡**。证据：`AGENTS.md:94,97`。
- [ ] **E6 无 bundle 体积门禁 / 变异测试 / a11y 自动化**。
- [ ] **F1 零 i18n**（中文硬编码、`lang` 写死）。证据：`src/app/layout.tsx:36`。
- [ ] **F2 缺 `global-error.tsx`**；`error.tsx` 仅 1/6；`loading.tsx` 仅全屏；`<Suspense>` 0 处。
- [ ] **F3 `next/image` 0 处且 lint 关闭**。证据：`eslint.config.js:185-192`。
- [ ] **F4 无离线能力**（无 SW / `onLine` / 离线队列；58 文件手写 localStorage 无 persist）。
- [ ] **F5 虚拟滚动仅 2 处**；`next/dynamic` 仅 2 处。
- [ ] **F6 无 Storybook / 可视回归**；UI 复用棘轮 78 条存量违规。证据：`scripts/.ui-primitives-baseline.json:18`。
- [ ] **F7 metadata 脚手架默认值**（无 OG/SEO/manifest）。证据：`src/app/layout.tsx:19-23`。
- [ ] **F8 无 Onboarding**；快捷键仅一处命令面板。
- [ ] **F9 更新无通道 / 回滚**；`installMode:passive` 失败无回退。
- [ ] **F10 `eslint-plugin-jsx-a11y` 未显式启用**。证据：`eslint.config.js:63-69`。
- [ ] **F11 端口 TOCTOU + 800 槽哈希分桶碰撞无兜底**。证据：`src-tauri/src/lib.rs:831-834`；`single_instance.rs:189-192`。
- [ ] **F12 无 Web Vitals**；SQLite 无 `busy_timeout`；几乎无事务边界。证据：`src/server/db.ts:74-75`。
- [ ] **P3 卫生**：无 `.editorconfig`；`package.json` 无 `engines`；tsconfig 缺 `exactOptionalPropertyTypes` 等；`cn@^0.3.0` / `lucide-react:^1.47.0` 版本偏宽；双 TS 版本导致构建/门禁语义不一致；`/api/update-check` 无鉴权回显变更指纹；`comfyapp://` 由外部 helper 实现需单独审计防任意网页利用本机路径。

## 规范状态

已固化:12(结构/命名/卫生/防线)、13.5(本地提交门禁)、03 §3.1(v4 规范
类名)、TESTING.md(分层策略/覆盖率棘轮)、reviews/(两轮审查归档)。
待补:无——新缺口按上表滚动进入对应章节。
