## Fixed

- **ISSUE #1834 遗留的全量 e2e 稳定红：11 条 → 0 条**（win32 检出，`pnpm test:e2e` 默认档）。
  立案时的归因写的是「与负载无关的稳定红（出图链路 / queue-monitor / runtime-budget）」，
  本次按 `44a533d7` 当场复算后，那批红其实是**四个互不相干的成因**，逐条都有读数：

  1. **半个改名**（7 条）—— ISSUE #1847 把侧栏那一项从「流程」改成「工作流库」，
     `NAV_ITEMS` 的 `label` 改了，而**同一文件头部的注释、`nav-items.test.ts` 的三处说明、
     `WorkshopHeader.tsx` 的一行、以及 3 份 e2e 钉的标签**都没改。源码里已经没有
     名为「流程」的按钮（`git grep` 当场验过），用例却在等它。
     现在那 3 份 spec（`critical-flows` / `overlay-entries-as-views` /
     `project-context-refresh`）的标签与常量对齐现状，并把源码侧同批 **7 处过期表述**
     （`NavItems.tsx` 3 + `nav-items.test.ts` 3 + `WorkshopHeader.tsx` 1，其中一条是用例标题）
     一并改正 —— 注释才是喂出错误用例的东西，只改用例的话下一次还会红。
  2. **用例自造的两处竞态**（`overlay-boundary` 2 条）—— 它先把每个顶栏按钮的
     `aria-label` 抓成字符串、再拿字符串精确重查；而 `MessageCenterButton.tsx:27` 的那个属性
     **是动态的**（有未读时变成「系统消息，N 条未读」），两次动作之间落一条消息，
     抓来的字符串当场失效，locator 一直等到 60s 用例超时。第二个气泡探针认全局
     `[data-slot="tooltip-content"]`，上一枚还在退场（`data-closed`）时就撞成
     strict mode violation（实测一次同时数到两枚）。
     现在遍历**活的 locator**、标签逐轮重读，且只认 `[data-open]` 那一枚。
  3. **取样式表的时机**（`theme-token-consumers` 1 条）—— `[data-view="canvas"]` 是
     `WorkspaceViewStack.tsx:266` 的 **wrapper**，它先挂；带 `@xyflow/react/dist/style.css`
     的是里面那个 `dynamic(..., { ssr: false })` 的 chunk，晚一拍。等 wrapper 可见后
     **取一次** `document.styleSheets` 就是在自己的前提上抢跑（读到 0），而那 3 处 token
     一直好好在 `style.css` 里（当场 `grep -c` 核对）。改成轮询到规则出现，保留原「前提没了」话术。
  4. **`goto` 的等待形态选错**（同一条的另一半，也是最后才浮出来的）—— 这份 spec 写着
     `waitUntil: "domcontentloaded"`，而本地默认档是 `pnpm dev`（按需编译），chunk 必然晚于 DCL：
     按钮「看得见、点得动」，但 React handler 还没挂上，`createProject()` 压根没被调用，
     于是永远等不到 `[data-view="project"]`。失败瞬间的无障碍快照是决定性的：
     页签只剩「首页」、那张卡还在原位 —— 是**没接住点击**，不是导航慢。
     同仓的对照证据：点同一个按钮的 `project-context-refresh.spec.ts` 用默认 `load`，从没红过。
     去掉那个 `waitUntil` 即与它同口径。**这不是「加等待绕过红」**，`load` 才是这条路径成立的前提。

  过程中我提过并**已撤销**的两个错假设，记下来免得重走：① 给这份 spec 补一个
  `page.route("**/api/trpc/**", () => fulfill({ json: [] }))` 当作「与同级同前置」——
  空数组喂不进 `httpBatchStreamLink`（`e2e/support/trpc-stub.ts` 的文件头把「好 JSON 与坏
  JSON 表现一致、控制台零报错」这件事写得很清楚），它不解决任何东西；② 先开一次「＋」菜单
  当作水合探针 —— 没有活跃项目时那个菜单压根不出现，探针自己成了新的红。

## Changed（让位：本批一度加上的「性能档隔离」已撤回）

- `runtime-budget` 那 1 条**不是本批改的，也不该由我改**。当时读到全量里
  `loadEventEnd 964.8ms` > 预算 `320 × 2 = 640ms`，而单跑 `1 passed (34.1s)`，
  我据此判成「同伴用例在抢首帧编译」，加了 `chromium-perf` 独立 project +
  `dependencies: ["chromium"]`，并补一条用例钉住那个形状。
- **合并 `origin/master` 之后这个推断被两条证据否证**：① 上游同期把基线改成按平台各一份
  （`scripts/.runtime-budget-baseline.json` 的 `metric.byPlatform`：win32 `716`、posix `320`，
  倍数同为 ×2），而它写明的 win32 校准读数是 **715.5ms，取于「两遍全量 e2e + 一遍单 worker
  独跑」** —— 也就是**在全量并发下**拿到的同值，直接打掉「同伴抢编译」这条因果；
  ② 我那次 964.8ms 的读数出自同机并行跑着门禁的时刻，压满的是宿主而不是页签。
  在新基线下 `964.8 < 716 × 2`，那条红本来就不需要隔离来治。
- 于是在合并后的树上**撤掉隔离**重跑全量：`81 passed / 0 failed (2.1m)`，
  `runtime-budget` 就在主 `chromium` project 里跑、**11.7s 通过**。
  隔离连同钉它的那条断言一起撤（`playwright.config.ts` 回到 master 的形状、
  `tests/e2e-runtime-budget.test.ts` 删掉那条）—— 同一件事不留两套判据，
  承重的那套是基线按平台分档。
- 这一条的**红线没有移动过**：`timeout: 60_000`、`factor: 2`、基线数字三处
  一个字节都没动（`git diff -- e2e/runtime-budget.spec.ts` 为空）。抬任何一个都是拿判据换颜色。

## 相关但独立的两件事

- 跑这一档的过程中发现的「一条 `--help` 就能买到一天的绿账」是**另一个缺陷**（在记账侧，
  不在用例侧），已拆成同批的 `0-daily-ledger-passthrough-hole.md` 单独一笔提交。
- 合并 `origin/master` 之后冒出来的 3 条红是**上游 ISSUE #1900 的 e2e 尾巴**（`baseline-red`，
  归因与两条静态证据在 `0-e2e-comfy-runtime-tab-stale-reds.md`），也单独一笔。
  两件事各自可回滚，所以不写在同一篇里。

## 刻意没做的事（写清楚，别当成已完成）

- 没有把 `.first()`、`fullyParallel`、并发数、任何预算或基线调过，用来让颜色变绿。
- 没有给 `theme-token-consumers` 保留那个 tRPC 桩：它与这条的判据（CSS 变量二次代入）无关，
  而我试过、它不解决问题。
- 没有动 `e2e/support/trpc-stub.ts`：它已经把「桩要喂成 JSONL 信封」这件事做对了，
  错的是我最初绕过它直接 fulfill 裸数组。

## 验证

- 全量 `pnpm test:e2e` 在 `44a533d7` 这一版基线上：**78 passed / 0 failed（4.3m）**，
  两档都跑（`--list` 计数一致），记账 `✓ 全量 e2e 通过`。
- **合并 `origin/master`（`40b274d6`）之后重跑**：**81 passed / 0 failed（2.1m）** ——
  上游新增的用例一起在内，且**撤掉性能档隔离之后** `runtime-budget` 仍在主 `chromium`
  project 里通过（11.7s）。账上 `who=yuedu`、无 `skippedReason`；
  `node scripts/freshness-gate.mjs` 三档退 0。
- 定向复跑（改完前 5 条红时）：4 份受影响 spec `34 passed / 0 failed`。
- 逐条隔离复跑取定性读数：`theme-token-consumers` 7 passed、`runtime-budget` 1 passed、
  `queue-monitor` 5 passed。
- `tests/e2e-runtime-budget.test.ts` 仍绿 —— 撤掉本批加的那条隔离断言之后 **14 条**，
  上游按平台分档的那几条一条没动。
- 这一批动了 `src/` 与 `tests/`，所以同批把**全量单测 + 覆盖率档**当场自证一次：
  `node scripts/full-suite-run.mjs` 退 0，账记在 `who=yuedu` 上（随本笔一并提交）。
- `tsc --noEmit` 绿；eslint 零警告；`pnpm doc:check` 绿。
