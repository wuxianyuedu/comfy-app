<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/guides/TESTING.md`。改动请回源文件，再重新生成。 -->

# Comfy-APP-T3 测试与文档

> 测试分层:纯函数/store 用 node 环境,组件渲染用 jsdom;断言基于实现语义,
> 禁止为"让测试通过"而弱化断言。最后校准:2026-09-29。
>
> **本文件刻意不放「哪个文件有多少用例」那类清单** —— 它每次提交都会烂一行，而读者据此
> 得出的结论比没有结论更糟。要数就现数（下面「怎么数覆盖」给的就是命令）。

## 快速开始

```bash
pnpm test               # 全量单测（vitest run，约 10~16 分钟，8 worker）
pnpm test:coverage      # 同一套全量 + v8 覆盖率与棘轮门槛
pnpm check:all          # 一键完整门禁：typecheck / eslint 零警告 / 格式棘轮 / 全量+覆盖率
pnpm typecheck          # tsc --noEmit
pnpm test:file <文件>   # 只跑指定文件（跨平台入口，见 tools/start/run-tests.ps1）
pnpm test:e2e           # Playwright 全量 E2E（含 e2e/visual）
pnpm test:visual        # 只跑像素基线那一层
```

- **别默认用 `--no-file-parallelism` 跑全量**：串行要 2~3 小时。它的正确用途是给一条红
  **定性**（串行也红才是真红，见规范 §11.13）。
- 提交时不必手动跑这些：`.githooks/pre-commit` 已经跑「固定守护清单 + 沿静态 import 图
  解析出的受影响用例」（规范 §13.5.8），全量仍归 `pnpm test` / `pnpm check:all`。

## 单元测试（Vitest）

### 配置

- 配置文件：`vitest.config.ts`；扫描面 `src/**/*.test.{ts,tsx}` 与 `tests/**/*.test.{ts,tsx}`
- 默认环境：node（纯函数/store，不依赖 DOM）
- 组件渲染：测试文件头 `// @vitest-environment jsdom`
- 路径别名：`@/*`、`~/*` → `src/*`；`server-only` 在测试里换成空实现
  （`tests/stubs/server-only.ts`，构建期的硬约束不受影响）
- 测试文件与源码同目录，命名 `*.test.ts(x)`
- `globals: false`：显式 `import { describe, it, expect } from "vitest"`；
  RTL 不自动 cleanup，组件测试需 `afterEach(cleanup)`
- **超时与并发按实测给，不是默认值**：`testTimeout: 30_000` / `hookTimeout: 45_000` /
  `maxWorkers: 8`。来由与三档对照表在规范 §11.13；重头用例（如日志面板那两条）另有
  文件级预算，注释里写了实测出处 —— 慢到贴预算时该优化用例，别再抬数

### 测试栈与配方

| 层            | 工具                                                                  | 要点                                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯函数        | vitest                                                                | 正常路径 + 边界 + 非法输入；文件名中文描述行为                                                                                                                                                                                                                         |
| Zustand store | vitest                                                                | 每用例前重置状态（`setState` 初始值或 reset）；派生字段必须通过 action 触发（直接 setState 不会重算）                                                                                                                                                                  |
| 组件渲染      | @testing-library/react + jsdom                                        | `getByRole`/`getByText` 优先；交互用 `userEvent`；jest-dom 匹配器已在 `tests/setup.ts` 全局注册                                                                                                                                                                        |
| hooks         | renderHook（@testing-library/react）                                  | ReactFlow 等有 Provider 依赖的包对应 Provider（`tests/helpers/react-flow.tsx`），否则跳过该分支并注明                                                                                                                                                                  |
| 前端集成      | `tests/helpers/renderWithProviders.tsx` + `tests/helpers/trpc-msw.ts` | useQuery/useMutation 走**真实 tRPC 管线**（MSW 在网络层拦并转发到 `tests/helpers/test-trpc.ts` 现造的 router），必测 loading / error / 缓存失效 / 乐观更新（规范 §11.3）                                                                                               |
| 数据访问层    | `tests/helpers/test-db.ts`                                            | 内存 SQLite + **真 Drizzle**，不 mock —— 这层的正确性全在「SQL 怎么写」上                                                                                                                                                                                              |
| API 路由      | vitest（node 环境）                                                   | `vi.mock` 掉依赖（鉴权 / lifecycle / fs / db）后 `await import("./route")` 取 `GET`/`POST`，断**状态码 + 信封形状**；闸门类（路径包含、NUL、扩展名白名单、三态契约）逐条反向验 —— 只测正常路径等于没测。给这些文件设覆盖率门槛时 `[...path]` 这类动态段要转义（§11.7） |
| Tauri 壳冒烟  | tauri-driver / Playwright WebView（Windows），或脚本层冒烟            | 只测壳级能力：启动、custom-protocol、崩溃兜底/进程树清理、日志出口；业务/画布/数据流去 Web 层测（见规范 §11.10）。改动 src-tauri 需 `cargo build --release --features custom-protocol` 重编后跑                                                                        |

### 怎么数覆盖（不留会烂的清单）

```bash
find src tests -name "*.test.ts" -o -name "*.test.tsx" | wc -l   # 测试文件数
pnpm test 2>&1 | tail -3                                          # Test Files / Tests 两行
```

一次快照（`b7563fd`，本机带 `.next/standalone` 产物）：**468 个文件 / 5873 过 / 23 skip**。
报数时必须说清是哪一种绿 —— 产物级探针只在存在 `.next/standalone` 的检出上执行，
没构建过的检出上它整块自行跳过。每一处这种「条件性暗掉」的站点都登记在
`tests/conditional-skip-registry.test.ts`（档位 `env` / `platform` / `artifact` / `manual`

- 理由 + 站点数，进提交前的固定守护清单）。

**结构性缺口不藏在心里，记在台账**：`docs/guides/PRODUCTION-GAPS.md` 的 E 系列与 P1 段
（例如 `src/app` 下 page/route/layout 的目录级零测试、挂载在 `appRouter` 上的
procedure 有没有执行者**与**消费方（这两条已由 `tests/trpc-surface-executors.test.ts` 接管，见下）、
覆盖率回退要补的五个文件）。往这里抄一份数字只会漂移两次。

### 新增测试指引

- 纯函数模块（lib 层、utils）优先补 `*.test.ts`；跨模块通用能力先补进地基再 import（§12.18）
- 组件测试范例：`AgentPanel.test.tsx`（轻量交互）、`SubgraphHeader.test.tsx`（真实 Provider 包装）
- 断言基于实现语义编写，禁止为"让测试通过"而弱化断言
- 新目录要同时登记两处：`scripts/check-file-structure.cjs` 的 `DOMAINS`（R14）与
  `vitest.config.ts` 的覆盖率门槛（§18.6 / §12.5.3）

### 组件测试（@testing-library/react）

- 依赖已装：`@testing-library/react` / `user-event` / `jest-dom`（匹配器在 `tests/setup.ts` 全局注册）
- vitest 是 `globals: false`，RTL 不会自动 cleanup——测试文件里手动 `afterEach(cleanup)`
- 交互用 `userEvent.click`（比 `fireEvent` 更接近真实事件序列）
- jsdom 未实现的 Web API（clipboard、HTMLMediaElement.play）用 `vi.fn` 桩替换
- 写日志类用例给**自己的临时目录**，别让 `pnpm test` 往仓库 `log/` 写字

## 覆盖率策略（棘轮制）

`pnpm test:coverage` 跑 v8 覆盖率，并对 `vitest.config.ts` 里**逐路径登记**的门槛判失败：
当前是 `coverage.include` 62 项、`thresholds` 82 条（按目录或按出口文件两种粒度）。

**口径三条**（规范 §18.6 / §11.7）：

1. 门槛取**实测值向下取整到 5 的倍数**，不设理想值 —— 设高了让无关提交变红，设低了等于没设；
2. 之后**只升不降**；确实因改动下降的，要在配置注释里写清旧值与原因（有一批就是这么记的）；
3. 新增 `ui/` 出口门槛时**两处同批改**：`coverage.include` + `thresholds`。只写门槛不进
   `include`，那条门槛会**静默失效**（报告里查无此文件，实测踩过）。

**判定的档位**：覆盖率只在**全量**这一档判。单文件跑 `--coverage` 会把其余路径按 0% 汇总、
`thresholds` 每条都刷红 —— 所以它不在 `pre-commit` 的增量测试层里，只在 `pnpm check:all`
（其 test 门带 `--coverage`）与手动 `pnpm test:coverage`。另有一条防静默的开关：
`coverage.reportOnFailure` —— v8 默认在任何用例失败时清掉数据、不产出报告，那样门槛是一条都不判的。

全库整体数字（总行覆盖 ~75%）只作参考，不设全局门槛。

## 视觉回归（Playwright screenshot）

> 像素基线捕获布局/配色退化（画布、空态、弹窗、断点、深浅色），见规范
> [11-测试与可观测性.md](standards/11-测试与可观测性.md#118-视觉回归像素基线)。
> 方案**只此一套**（`toHaveScreenshot`），不引入 Chromatic / Vitest browser mode。

### 目录与运行

```bash
# 像素档（推荐入口）：跑 e2e/visual + 配对判据同批，默认不落盘
pnpm check:visual
# 录基线（显式落盘）：录完请再跑一次上面的命令自证「连跑两次都绿」
pnpm check:visual:update
# 只跑像素档、不带配对判据（排查用；结论不完整，别拿它当「基线没问题」）
pnpm test:visual
# 全量 E2E（含 e2e/visual，测试全量时用）
pnpm test:e2e
```

- **优先用 `pnpm check:visual`**：它把像素档与「基线成套且入库」那条判据放在**同一次**运行里，
  并按三条实测形态给红的定性（缺本平台基线 / 逐帧 chrome / 像素 diff 各自的动作不同）。
  `pnpm test:visual` 仍在，但它的绿**证明不了**基线还在仓库里（两条判据是两次互不相干的运行）。
- 用例放 `e2e/visual/*.visual.spec.ts`，命名带 `.visual` 便于单独筛选（跑哪一层就点名哪一层：
  `pnpm test:visual` 只跑像素基线，`pnpm test:e2e` 含 `e2e/visual`）。
- 基线 PNG 与 spec 同目录（Playwright 默认 `*-snapshots/`），**提交入库**。
- ⚠️ **基线文件名带平台，每个真正执行像素回归的环境都要有自己的那一套**：当前只有
  `-win32.png`（开发机）。缺档时 Playwright 不是「跳过」而是判失败**并把新生成的 PNG 写进
  目录**，于是留下半套基线；判据见 `tests/visual-baseline-pairing.test.ts`（齐全 / 入库 /
  无孤儿三头，登记在提交前的固定守护清单，并由 `scripts/visual-gate.mjs` 保证「改像素层的
  提交一定带着这条判决」）。
- ⚠️ **像素可复现要自己挣**：根布局的全局状态栏带实时帧率与时钟，Next 的 dev 指示器也在
  页面上 —— 这类 chrome 必须 `mask` 掉，否则 fullPage 永远取不到两张稳定截图。写法见
  `e2e/visual/login.visual.spec.ts` 的 `unstableChromeMasks`；验收口径是**同一命令连跑两次
  都绿**，不是 `--update-snapshots` 那一次写成功。
- 基线变更（合法 UI 改动）重录 + 人工 review：
  ```bash
  pnpm check:visual:update                              # 录基线（等价于 --update-snapshots）
  pnpm check:visual                                     # 再跑一次自证：连跑两次都要绿
  ```
  重录后在 PR 描述标注「视觉基线已更新：<原因>」。失败 actual/diff 产物在
  `test-results/`（已 gitignore）。
- 像素档**不在 `pnpm check:all` 里**：它要起 webServer + 浏览器，而结论只在录过基线的那台
  机器上成立（基线名带平台）—— 要跑就显式点名（Windows 侧同一动作是
  `scripts/quality-gate.ps1 -Mode visual`，登记在 launch-and-build §9.5 的对照表）。

### 确定性约束（防 flaky）

- 只截**钉死内容**：不碰时间戳/动画/骨架屏/DB 驱动列表；需要时用固定数据/mock。
- `playwright.config.ts` 已对截图统一关动画、隐藏光标、设 `threshold: 0.1`
  吸收抗锯齿差异。
- E2E 要真的读到库：跑之前先 `pnpm db:push`（`pnpm build` 只证明「没库也能构建」）。

### DOM 快照边界

Vitest `toMatchSnapshot` **禁止新增**用于断言整棵 DOM 结构（易碎且非像素退化）。
存量还剩 4 份结构快照（`WorkflowSubgraphNode` / `WorkflowEditorInner` / `FilmStudio` /
`TrainingStudio` 的 `__snapshots__/*.snap`），按规范 §11.9 逐步迁成行为断言后删除；
视觉防退化统一走本节 Playwright 基线。

## API 文档（TypeDoc）

- 配置：`typedoc.json`
- 入口：`src/lib`、`src/server`、`src/trpc` 下非测试 TS 文件
- 输出：`docs/api`（HTML）
- 排除：`*.test.ts`、`node_modules`、`workflows`

## 已知边界（当前真实状态）

**已经有自动化**：提交前钩子（分支守卫 + tsc + eslint 零警告 + 20 多条静态判据 + 固定守护
清单与受影响用例）；`pnpm check:all` 的全量 + 覆盖率棘轮；29 条 `@critical` E2E；win32 像素基线。

**没有自动化 / 仍开放**（细节与优先级见 `docs/guides/PRODUCTION-GAPS.md`）：

- [ ] **没有平台侧兜底**：#623 之后不跑流水线，唯一自动化是本地钩子（`--no-verify` 可绕）。
      口径与出路见规范 §13.5.3 / §13.5.4（按需召唤评审 NPC），别再补「看起来在守门」的配置。
- [ ] **E2E 没有自动执行者**：在本地手动档（`pnpm test:e2e`）。视觉那一层**有本地判据**：
      `tests/visual-baseline-pairing.test.ts` 在提交前的固定守护清单里，且
      `scripts/visual-gate.mjs`（pre-commit D 组）在暂存命中 `e2e/visual/**` 时判「这次提交带不带
      像素判决」—— 但它判的是**基线的齐全/入库/平台登记**，不是「界面像素有没有变形」：
      真正的像素回归仍要手动跑，入口是 `pnpm check:visual`（规范 §11.8 / §13.5.4）。
      它不在 `check:all` 里（webServer + 浏览器的代价 + 结论只在录过基线的那台机器上成立），
      与 E2E 同属按需层，区别是它的触发条件是明确的：**改了会动到像素判决的东西**。
- [ ] **Rust 壳的 `#[test]` 只在「改了 `.rs`」时被跑**：`scripts/shell-gate.mjs`（pre-commit D 组）
      在暂存改动命中壳输入时跑 `cargo test`、并把硬规则 5「改了壳必须重编」变成判据 ——
      但它**不是全量执行者**：不动壳的提交永远不跑那 37 条 `#[test]`，全量仍要靠
      `cd src-tauri && cargo test` 的手上（`check:all` 里也没有这一路）。
- [ ] **API 路由与页面层仍有大片裸奔**：40 个 `route.ts` 里 15 个有同名测试（闸门第一批补了
      5 个 —— `generated/[...path]`、`debug/source`、`comfy/{stats,queue,ensure}`；第二批补了
      `custom-nodes` 的 argv 注入闸门；⑨第一刀补了 `materials` 的归属闸门；另有 `schema/*`
      两条是别线补的），剩下 25 个与 6 个 `page.tsx` 的目录级测试仍是少数（台账 P1/E3）。
      ⑦第四刀没加 `route.ts` 用例，但补了产物的**第二个入口**的判据（`src/proxy.test.ts`）：
      产物当时住在 `public/generated/` 下，而 `public/**` 由 Next 按静态文件直发、不经过
      任何 handler —— 只在 route 上加闸门时，把 URL 里的 `api/` 去掉就整条绕过
      （实测同一份图：静态形状 200、带闸形状 401）。那条旁路后来被**结构性关掉**：
      产物根搬到仓库根的 `generated/`（台账 A13），这层 proxy 只剩「让老形状的 URL 仍然
      走闸」的兼容职责。
- [x] **服务端 router 集成覆盖已收口，判据升到 procedure 粒度**：12 个 router
      （`generate` / `run` / `task` / `workflow` / `project` / `setting` /
      `film` / `train` / `model` / `llm` / `skill` / `workflowModel`）的用例都按
      **归属 / 协议 / 数值 / 枚举闸门 / 错误信封**组织，不按 procedure 顺序铺。
      最后 3 个零执行者的口（`custom-nodes` tRPC 侧 / `user` / `post`）没有被补成测试，
      而是**定性后删除** —— 给死口写用例等于把它焊死：`customNode.list` 的 `nodes` 是写死的
      `[]`（真实现在 REST `/api/custom-nodes`）还顺手回整个 settings；`post.getLatest`
      的注释自称「要求已登录」，而 `loginRequired` 默认 `false` 让那句话等于没写，且它
      没有 `createdById` 过滤；`user.me` 客户端从来不调（会话走 better-auth 的 `authClient`）。
      防线现在挂在**挂载动作**上：`tests/trpc-surface-executors.test.ts` 枚举 `appRouter`
      的每条 procedure，要求它出现在「import 了该 router 文件闭包」的测试里的调用形态，
      并自带四条反证（没测试 / 只 import 不调用 / 调用但没 import / 齐备）。
      同一份挂载面还判**第二个维度：消费方**（台账 E3′）—— 「测试全绿」与「有人在用」是
      两件事，只有测试在调、界面从不引用的口必须进 `ZERO_CONSUMER` 登记并写明「谁将来接它」，
      登记表还要求**双向不陈旧**（口删了登记还在 = 红，消费方接上了登记还在 = 红）并带长度棘轮。
      这一维照出来的第一批处置：`material.*` 与 `llm.complete` 是 REST 面的第二扇门，收口到
      有人走的那一侧；复算时另照出 **4 条没有落点的 `/api/*` 地址**（实测 404、界面按空态吞掉），
      判据（`tests/rest-endpoint-targets.test.ts`）与四条处置见台账 E3‴，同批已关闭。
      为什么粒度必须是 procedure 而不是 router：⑨ 三批清完后复算，剩下的两条零执行者口
      （`workflow.detailFull` / `workflow.subgraph`）**藏在一份有测试文件的 router 里** ——
      「每个 router 都有一份测试」这句话当时照样全绿。台账 A 系列几批复算证明「一个
      procedure 没有执行者」的实际含义是「它的闸门坏了没人红」，⑨第二刀更狠：
      **`train.cancel` 自 Prisma→Drizzle 迁移起每次都 500**（仓储那个 `select?: unknown` +
      `db.select(select as never)` 把调用点的形状错误整个咽掉，见台账 F13）——
      没有执行者的地方烂掉的不只是判据，还有功能本身。
      ⑨第三刀清的是同一族的另一维：**错误码本身**（19 处裸 `throw new Error` = 业务分支在客户端
      表现成 500，台账 E8）。防线落在 eslint 的 `no-restricted-syntax`（B 组每次提交都跑、直接指到
      行号），并由 `tests/router-error-envelope.test.ts` 三层验全：存量为零、**扫描面非空**
      （路径写错时「零命中」长得就像「都修好了」）、selector 真的会响（拿 `Linter` 跑两段片段）。
- [ ] **`DynamicWorkflowForm` / `CanvasNode` 主组件的深度行为测试**（fetch/poll 生命周期）仍开放。
- [ ] 存量 4 份 `.snap` 结构快照按行为断言迁移（见 §11.9）。
- [ ] `log-store.parseFileLogs`：`[WARNING]` 行当前回退 info 级（源码怪癖，测试已按现状断言并标注）。
- [ ] Tauri 壳冒烟自动化落地：先按规范 §11.10 定壳级清单与边界，壳改动 PR 跑
      `cargo build --release --features custom-protocol` 重编 + 冒烟（Windows 环境）。
