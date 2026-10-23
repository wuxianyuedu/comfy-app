# AGENTS.md — AI 协作强制规范

> 本文件会被编码代理（ZCode、CodeBuddy 等）在会话开始时自动加载。
> **改动前先读项目文档是硬约束，不是建议**：任何代理在改动任何文件
> （代码 / 配置 / 脚本 / 文档 / 依赖）之前，必须先完成下方「改动前必读文档」
> 的前置阅读，再按改动范围命中「强制先读规范文档的改动范围」表时完整阅读
> 对应规范章节，并在实施说明中注明遵循了哪些条目。

## 改动前必读文档

任何改动动手前，先按序完成下列前置阅读（缺一视为违规）：

1. `README.md` — 项目是什么、技术栈、目录结构、常用命令与入口。
2. `docs/README.md` — 文档中心统一索引：主规范与 standards 文档集（01~18 章）、
   各指南、冲突裁决链与「改动前先看对应章节」的定位方法。
3. 本文件（`AGENTS.md`）全文——尤其下方「硬规则」与「强制先读规范文档的改动范围」表。

按改动范围快速定位规范章节：

- 前端业务 / 组件 / 状态 / 性能 / 类型 / 样式 / 测试 → `docs/standards/README.md`
  总览，按主题进入 `docs/standards/01~18` 对应章节；
- 启动链路 / Tauri 壳 / 构建打包 / ComfyUI 生命周期 → `docs/standards/launch-and-build.md`
  （§4.3「陈旧实例：运行图落后于源码」= 长开窗口 + 拉新代码导致的白屏及其通知；
  改 store 动作、或新增会被已挂载实例调用到的模块时必读；用户侧说明见
  `docs/guide-stale-code.md`）；
- 改 `src/lib/**` → `docs/standards/18-lib层规范.md`（**它曾是四类门禁的盲区**：
  分层 element / Node-only 声明规则 / 文件与函数长度棘轮 / 覆盖率门槛；
  尤其 §18.4「`.server.ts` / `server-only` / 纯 Node 宿主」三选一的唯一口径，
  自查 `node scripts/lib-node-only-scan.mjs`；新增模块时先答「它属于哪个子域」——
  根目录只收顶层单例，新增子域目录**必须同批**登记 `scripts/check-file-structure.cjs`
  的 `DOMAINS`（R14）并按 §18.6 在 `vitest.config.ts` 设实测门槛，见 §18.12 / §12.5.3）；
- 提交 / PR / 自查清单 / 分支策略 → `docs/standards/13-提交与-code-review.md`
  （§13.1 自查清单、§13.5 门禁、§13.6 分支与合并、§13.6.1 master 提交守卫）；
- 不确定读哪些 → 先读 `docs/standards/15-附录.md` §15.5「新成员 10 分钟速读路径」建立全局认知。
- **依赖版本可能落后于远端**（别人升过库、你还在旧的上面干活）→ 先跑
  `pnpm check:deps-freshness`，再读 `docs/guides/sync-after-pull.md`；判据口径见 §13.5.13。
- 跨文件检索 / 代码图谱查询（`codegraph`、`zvec-grep` 两个本地只读 MCP，声明见 `.mcp.json`）→
  用法、安装与索引前提、输入输出与失败语义**只有一份出处**：project Skill
  [`.qoder/skills/code-navigation/SKILL.md`](.qoder/skills/code-navigation/SKILL.md)，本文件不重抄。
  这里只保留那条红线：**门禁判据只在 `scripts/check-*.cjs` 与 `.githooks/pre-commit`**——MCP
  不替代机器判据，也不作为提交前的独立校验源。第二条红线同样属于本文件：**索引未初始化时
  语义检索返回空而不报错**，所以「MCP 查不到」**不等于**「仓库里没有」——要下「没有现成实现」
  的结论（硬规则 24 的复用优先），必须再用 Grep / Read 复核一遍。
- **不确定某个第三方库在「本仓锁定的那个大版本」上 API 长什么样**（训练数据滞后于
  Next 16 / React 19 / drizzle 0.45 / tRPC 11 / better-auth 1.7 / Tauri 2）→ 用 `context7` MCP
  查官方文档，**别凭记忆写**。用法与那条边界（它治 API 漂移、不治依赖版本漂移，也不回答
  本仓判据是什么）**只有一份出处**：project Skill
  [`.qoder/skills/version-docs/SKILL.md`](.qoder/skills/version-docs/SKILL.md)。

> 判断标准：改动被「强制先读规范文档的改动范围」表或本清单覆盖但未先读就动手 = 违规，
> 提交会被拒或要求回滚。

## 强制先读规范文档的改动范围

| 范围                                                                  | 路径                                                                                                                                                                                                                            | 规范章节                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 启动链路                                                              | `scripts/dev-launcher.mjs` + `scripts/launcher-core/**`（**全平台唯一编排**）、`scripts/dev-launcher.ps1`（仅入口）、`src-tauri/src/shell_launch.rs`（壳自编排）                                                                | §1–§3（编排 §3.3 / 入口 §3.2）                                                                                                                                                                                                                                                                  |
| Windows 双击入口                                                      | `tools/<分类>/*.ps1`（启动类 `tools/start/`）、`scripts/entry-common.ps1`                                                                                                                                                       | §8                                                                                                                                                                                                                                                                                              |
| Tauri 壳                                                              | `src-tauri/**`（conf.json / src / splash-assets）                                                                                                                                                                               | §2、§7                                                                                                                                                                                                                                                                                          |
| ComfyUI 生命周期                                                      | `src/lib/comfyui/**`（lifecycle / executor-* / reaper）                                                                                                                                                                         | §3、§5                                                                                                                                                                                                                                                                                          |
| 工坊管线                                                              | `src/components/workshop/**`、`src/lib/workshop/**`                                                                                                                                                                             | §5                                                                                                                                                                                                                                                                                              |
| UI/逻辑分离                                                           | 视图层新增 `fetch`/`vanillaApi`/tRPC hook 时                                                                                                                                                                                    | §17（[17-UI与逻辑分离.md](docs/standards/17-UI与逻辑分离.md)）                                                                                                                                                                                                                                  |
| lib 层边界与门禁                                                      | `src/lib/**`（新增/移动模块、拆 `.server.ts`、共享类型给视图层）                                                                                                                                                                | §18（[18-lib层规范.md](docs/standards/18-lib层规范.md)）；分层由 `eslint.config.js` 的 `boundaries` 强制，Node-only 声明由 `scripts/lib-node-only-scan.mjs` + `tests/lib-node-only-declarations.test.ts` 强制（§18.4），文件长度**硬闸** `check-file-structure.cjs`（超 900 行即阻断，无 flag） |
| lib 子域归属                                                          | `src/lib/**`（新增模块、新建子域目录、搬目录）                                                                                                                                                                                  | §12.5.3 + §18.12；门禁 `check-file-structure.cjs` 的 R13′/R14                                                                                                                                                                                                                                   |
| 跨平台动作（新增/删除 `.ps1` 或 `.mjs` 入口、改 `package.json` 脚本） | `package.json`、`tools/**`、`scripts/*.ps1`、`scripts/*.mjs`                                                                                                                                                                    | §9.5（[launch-and-build.md](docs/standards/launch-and-build.md) 的**跨平台动作对照表**）+ §12.8；门禁 `scripts/check-ps1-consistency.mjs`                                                                                                                                                       |
| 跨平台行为 / 端口与文档                                               | 新增按平台分叉的逻辑、改动 `src/lib/process/kill-process-tree.ts` / `launch-path.ts` 的平台判据、动 `scripts/app-port.mjs` 或 `src-tauri/`（Cargo 的 windows/gate、sidecar 命名、shell 插件）、**在文档/README 里写具体端口号** | §1.1、§3.1、§3.3、§9（[launch-and-build.md](docs/standards/launch-and-build.md)）；端口「两条链路」见 [reference-facts.md](docs/reference-facts.md) §1.1                                                                                                                                        |
| 构建与打包                                                            | `scripts/build-desktop.mjs`、`tools/**`                                                                                                                                                                                         | §7、§8                                                                                                                                                                                                                                                                                          |
| 复用/去重与常量收口                                                   | 抽共享模块、加/改默认地址与端口、写新的质量门禁、**动手前查有无现成实现 / 缺能力补地基**                                                                                                                                        | §12.18（复用优先·写之前先查）、§12.12（跨文件重复）、§12.13（函数长度）、§12.14（端点收口）                                                                                                                                                                                                     |

## 硬规则（违反 = 提交被拒或必须回滚）

1. **包管理只用 pnpm**（`pnpm exec …`）。禁止 npx / npm run——npm 11.19 在本机
   解析 typescript 别名链会崩溃（`Class extends value undefined`）。
   **这条有判据**：`scripts/check-doc-references.cjs`（= `pnpm doc:check`）把「台账文档与
   `AGENTS.md` 里出现 npm 形态的可执行命令」判成硬错误——这类写法一律改为 pnpm；
   覆盖面是**文档里的命令口径**，不含源码调用（那一路刻意不判——源码里没有对应的
   可执行形态可由 lint 看）。
2. **工具链钉死项不可随意改**（改动前必须读规范 §6 并在提交说明里给出理由）：
   - `pnpm-workspace.yaml`：`minimumReleaseAge: 0`、`allowBuilds` 名单（条数以该文件为准；
     它会随新增依赖变动，别在文档里写死数字）、`verifyDepsBeforeRun: false`
   - `next.config.js`：`experimental.useTypeScriptCli: false`
   - **钉死项本身有回归判据**：`tests/turbopack-tracing-excludes.test.ts` 判
     `useTypeScriptCli: false` 与**实际解析到的 TypeScript 必须配对**（Next 16 里该键的位置、
     以及关掉它之后解析到 TS7 会让 `next build` 直接退出），改钉死项会当场红。
3. **进程清理必须杀整棵树，平台判据只收两处**：Node/TS 侧一律经 `src/lib/process/kill-process-tree.ts` 的 `killProcessTree()`；非 TS 宿主走命令行入口 `scripts/reap-process.mjs`；Rust 壳侧起子进程只能用官方 `tauri-plugin-shell` 的 `CommandChild`（退出整树回收同样转交 `reap-process.mjs`）。禁止各处自写 `taskkill` / `process.kill` / `Process.Kill()` / 单杀 leader / `std::process::Command` + `taskkill`（后者在 POSIX 上等于什么都不做）。**POSIX 自建进程组是前提**：`spawn({ detached: true })`。跨平台机制、防自杀判据、孤儿事故根因见 launch-and-build §3.1–§3.3。**这条有回归判据**：`tests/cross-platform-launcher.test.ts` 真起进程树再回收、并断言 `scripts/reap-process.mjs` 真的把目标收掉（Windows 侧的 `taskkill` 参数形态由 `src/lib/process/kill-process-tree.windows.test.ts` 判）。
4. **失败路径必须有日志 + 用户可见出口**；日志按规范 §4 的布局落 `log/`，
   不得引入新的固定名日志文件（残留进程句柄会锁死它，用按次命名 + 轮转）。
5. **改了 `tauri.conf.json` / `src-tauri/src/**` / `splash-assets/**` 必须
   `cd src-tauri && cargo build --release --features custom-protocol` 重编壳**
   （**feature 不能省**：不带它 tauri 的 `cfg(dev)` 开启，启动页会被导航到
   `build.devUrl` 且资源不内嵌——冷启动必现 Edge「无法访问此页面」错误页，
   详见规范 §5）——窗口配置与启动页是编译期内嵌的，只改源码不重编 =
   跑旧二进制（历史黑屏事故来源）。**这条现在有判据**：`.githooks/pre-commit` 的
   `scripts/shell-gate.mjs` 在暂存改动命中壳输入时，复用 `dev-launcher.mjs` 的
   `shellStaleWarning()` 把「没重编就提交」拦下，并在改了 `src-tauri/src/*.rs` 时跑
   `cargo test`（壳内全部 `#[test]` 唯一的执行者——条数随源码变动，别在这里写死，以
   `cargo test` 自己的输出为准）；触发面与 mtime 边界见规范 §11.10.4。
6. **不在 `master` 上直接提交，一切变更走分支 + PR**（ISSUE #492）：两层防线 = 平台**分支保护设置**（拦 push、放行 PR 合并）+ `.githooks/pre-commit` 开头的组 0「master 分支提交守卫」`scripts/check-branch-guard.cjs`（拦本地提交）。**判据是 HEAD 父提交数**：`master` 上 ≤ 1 = 直连主干阻断，> 1 = PR 合并放行（只查分支名会把合并一起拦掉）。`check-branch-guard.cjs` 的 `--pr-check` / `--merge-commit` 两个**服务端形态作为判据本身保留**，并随 ISSUE #1959 由仓库根 `.cnb.yml` 重新调用（跑在根组织自托管节点上、不参与核时计费，§13.5.3）——**平台侧这一层又有兜底了，但它取自源分支、且跑的是另一份清单**，不能替代本地这一层。**平台层禁用 `git create-branch-lock`**（锁整分支写入会把 PR 合并一起拦死）。误提交到本地 `master` 时：`git branch feat/<描述>` → `git reset --hard origin/master` → `git checkout feat/<描述>` → 推送开 PR。三种拓扑回归见 §13.6.1。**合并那一跳现在有机器执行者**：`.githooks/pre-push` 在 HEAD 或上游引用变动时自动跑 `pnpm check:premerge`（证明写 `.git/comfy-premerge-proof.json` 不入库，同仓并行检出不许互相作证），口径与边界见 §13.6.2.1。**这一跳也降档了**（ISSUE #2022 / §13.5.25）：它默认只复算「本地档那几条」（同一份注册表，边界由 `localTierLabels()` 取，不另立名单），并打印跳过了几条重档；要全套 `pnpm check:premerge --full`。业主口径是「本地两处都快」，兜底在平台。
7. **提交必须通过 `.githooks/pre-commit`，而这一档现在是「形态档」**（分支守卫 + **形态前置档
   D0**：判「这次提交自身的形态」那几条，串行跑完再进其余档，见 §13.5.8.2.1）。
   **tsc / eslint / 其余静态判据默认不在每次提交上跑**（ISSUE #2022 / 规范
   §13.5.25）——它们仍**逐字留在 `.githooks/pre-commit` 里当注册表**，由 `COMFY_HEAVY_GATES`
   这个档位开关决定谁执行。为什么不能把它们删去 CI：`scripts/check-gate-executors.cjs` 认的
   执行者出处只有钩子的 `run "<标签>" <命令>` 行、`quality-gate.mjs` 的 gate 表、
   `quality-gate.ps1` 的 `$Blocks`，**`.cnb.yml` 不在它的解析面上** —— 删步骤 = 那批判据
   当场没有执行者，而账面一条红都不会出现。跳档时钩子会打印「本地**没跑**：<降了的那几组，
   逐组点名>」并明说那不是「已通过」（这句话由 `scripts/gate-tier-summary.cjs` 按**这一轮实际
   降了什么**念，标签取自钩子那五行 `run_group`；写死清单会在 `COMFY_HEAVY_GATES=1` 那一跑里
   推翻自己的上一行，见 §13.5.25 与 ISSUE #2154）。本地要全套：`COMFY_HEAVY_GATES=1 git commit …` 或 `pnpm check:all`。
   **「受影响用例」那一档例外，本地一律不跑**（2026-10-20）：它会起 vitest 子进程，共享机上
   的失效形态不是用例红而是 `Failed to start forks worker / Timeout waiting for worker`
   （实测拦下一次、隔离复跑 88 文件 1116 条全绿）⇒ 它的两个本地执行者（pre-commit 的 C 组、
   pre-push 的 `unitTests` 段）都撤了，改成平台侧 PR 流水线的 `受影响用例` 一格
   （`scripts/ci-affected-tests.mjs` → `run-affected-tests.mjs`，同一条判决链；C 组的
   `run_group C` 行仍留在钩子里当登记，`COMFY_HEAVY_GATES=1` 也换不回来它）。
   **兜底分两层**：`pnpm check:premerge` 在推送那一跳复算 `base` 段（干净快照上的全仓判据）
   - 提交信息声明 + 合并丢一侧，平台是第二层。**PR 上在场哪几格以 `.cnb.yml` 的
     `COMFYAPP_CI_GATES` 为准，每日那一跑以 `COMFYAPP_CI_DAILY_GATES` 为准——本文不抄格名**
     （抄一份格名就会第二次脱钩：`ESLint 零警告` 已在 2026-10-19 从 PR 撤到每日档，
     判据一字未改，改的只是执行者）。
     **全量单测不在 PR 档**（§13.5.21）：节点上并行 PR 会把带超时的读数变成不可信的红，且它跑绿
     要刷「整档凭证」——拿并发下的绿刷那张账比不刷更坏。所以全量单测的执行者仍是每天 00:00 那一跑
     （`每日单元测试`）；PR 上那一格判的是**增量面**（受影响用例），不刷整档凭证。
     **在册 ≠ 出勤**：「执行者在平台」这句话过去只被「格名在每日清单里」守着，而 2026-10-18→10-22
     五派发零跑完期间账面全绿（ISSUE #2114）。现在有了反面判据：
     `pnpm check:daily-attendance`（0 出勤 / 1 缺勤 / 2 没结论或取不到读数，退 2 **不算绿**），
     任何一次拿「平台那一档在跑」当本地豁免理由的争论现场都可以跑一次。
     想只推形态档那几条再交给平台判：`pnpm check:premerge --light`（它会打印跳过了几条重档 ——
     降档永远要被读出来，不许冒充「全套过了」）。§13.6.1 那句「平台拦 push、放行 PR 合并」
     由此比过去更承重，「PR 跑绿才合并」是纪律不是习惯。
     全部走 `pnpm exec`。
     **两份生成物同步（`docs/generated/**` 见 §13.5.5、`docs/api/**` 见 §13.5.5.1）
     2026-10-16 起已挪到平台侧 `.cnb.yml`**（ISSUE #1975，连同「文档引用与权威源一致」共三条）：
     它们判的是**读者面**的一致性、挡不住任何一次代码回归，而 `check-docs-api.cjs`
     **触发即 31s**（`--staged` 的输入面是 `src/lib` / `src/server` / `src/trpc`，最常见的提交类别正落在里面）。
     判据一字未改，改的只是执行者。**一个例外（2026-10-22）**：`docs/generated/**` 的
     **「同批性」**回到本地 D0 —— `scripts/check-doc-mirror-pairing.cjs`（钩子标签
     「文档源 ⇄ 生成态镜像同批」）只判「这次提交改了 `SCOPED_DOCS` 的源、有没有同批带上
     镜像」，一次 `git diff --cached` + 集合比对、实测 0.28s、不读任何内容。原因在执行方式：
     平台那一格跑 `--check --autofix`，**就地修好再判**，所以「漏带镜像」在平台读数里从不
     出现，红只会落在下一个动文档面的人身上（一天内复现三次）。内容一致性仍归平台那格判。
     **`docs/api/**` 那一格在平台上是「先就地重生成、再判」的登记写者**
     （`AUTOFIX_DUTIES` + `verifyDeterminism` 已复核过「同源两次产出逐字节相同」），
     所以**改完代码不要在本地跑 `pnpm run docs`** —— 那两千多份生成物不是任何一次提交的必经产物；
     真要本地跑只剩两种情形：发版/整理那一轮，或人明确要求。本地出口仍留着的是
     `pnpm doc:render` / `pnpm doc:check`（这两条便宜且判的是本仓自己维护的文字），口径与逐条实测见 §13.5.17。
     测试那一层是「改到哪、测到哪」的增量层（固定清单 + 改动面沿**静态 import 图**
     追溯到的用例，判据与**已知边界**见 §13.5.8）——运行时拼出来的路径抓不到、也不是
     全量，全量仍由 `pnpm test` / `pnpm check:all` 负责。钩子失败先修代码，
     禁止 `--no-verify` 绕过进历史。钩子由 `pnpm install` 自动接上
     （`package.json` postinstall → `scripts/install-git-hooks.mjs` 写
     `core.hooksPath=.githooks`）；未生效时手动 `git config core.hooksPath .githooks`。
8. **新增含 postinstall 构建脚本的依赖**：同步更新 `pnpm-workspace.yaml`
   的 `allowBuilds`，否则非交互模式 `pnpm install` 会 exit 1。
   **这条现在有判据**：`scripts/check-allow-builds.cjs`（挂在 `.githooks/pre-commit` 的 D 组）
   拿 `node_modules/.pnpm` 里**已装出来的事实**与名单对账——每个带
   `preinstall` / `install` / `postinstall` 的包都必须有一条显式条目，`true`（批准）与
   `false`（显式拒绝）都算回答过，漏答才红；反向（名单里当前没有构建脚本的条目）**刻意不判**，
   那半数是故意留的位，判它等于误报一片。钩子里那一步带 `--staged`：**只在本次提交动了
   依赖面**（`package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml`）时才扫全树，
   未命中会打印「未触及依赖面」而不是冒充结论；不带 flag 的那一档是全量判定（手动 /
   合并前用）。口径、为什么不读 lockfile、以及「缺 `node_modules`
   判红而不是跳过」见 §13.5.15。
9. **dev server 运行期间不要执行 `pnpm install`**（better-sqlite3 等原生模块（`.node`）被进程
   锁定会 EPERM 连锁失败）。**这条现在有现场执行者**：判据是
   `scripts/launcher-core/port-reap.mjs` 的 `runningAppInstances(root)`，按**归属**回答
   「本检出的应用服务在不在跑」（会话锚点心跳 + 端口上进程的命令行命中本检出的
   `dev.mjs` / `start.mjs`），两个消费点：编排器补装前（`launcher-core/downstream.mjs`
   的 `syncDependencies`，顺序要紧 —— 主流程里端口检查排在补装之后）与人不经过编排器
   直接装的那条路（`pnpm deps:guard`，Windows 双击 `tools/start/sync-lint.ps1` 在
   `pnpm install` 前调它，判到即停）。刻意**不**按「端口有没有人监听」判 —— 隔壁检出
   占着同一端口不会锁本检出的 `node_modules`。口径与回归测试见 §3.2 与
   `tests/dev-launcher-dependency-sync.test.ts`。
10. **视图层不得新增 IO**：`src/components/**`、`src/app/**`（除 `api/`）里不允许新写
    `fetch(`、`vanillaApi.*`、tRPC 的 options 调用（新集成：`trpc.x.y.queryOptions()` /
    `mutationOptions()`；旧 classic 字样 `api.x.y.useQuery/useMutation` 同判）——逻辑要进
    `<feature>/hooks/`，网络层一律进 `src/lib/<domain>-client.ts`（守卫只豁免
    `hooks/` 目录，`components/<feature>/*-api.ts` 会被计为违规）。守卫脚本
    `scripts/check-ui-logic-separation.cjs`（**硬闸：命中即阻断**，已接入 pre-commit；
    S* 存量已清零、基线已删，没有 `--update` 这条路 —— ISSUE #1811 收尾翻闸）。
11. **`src/lib` 是域化的：根目录只放顶层单例，模块一律进子域**（ISSUE #565 / §12.5.3 / §18.12）：新增子域必须**同批**登记 `scripts/check-file-structure.cjs` 的 `DOMAINS` 与 `DOMAIN_EXEMPT`（R14）**并**在 `vitest.config.ts` `thresholds` 里按**实测值**设门槛（§18.6）——只做一件 = 门槛挂在判据不认识的目录上、或新域零门槛。叶子域平铺，**不要再造 `admin/` `other/` `shared/` 这类杂物层**。门禁 R13′/R14 跑在 pre-commit 的 D 组「文件结构硬规则(R1-R12，R5 硬闸)」这一步。**迁移目录连带五查**（import 说明符含 `vi.mock` / `await import` / 门禁白名单 / 测试夹具假路径 / `path.resolve(__dirname, …)` / 规范与碎片里的路径引用），完整清单见 §12.5.3。

12. **禁用 `.bat` / `.cmd` / `.vbs` 入口，Windows 入口一律 `.ps1`；编排只写 Node（`.mjs`），`.ps1` 只是调用入口**（ISSUE #23 / §8）：`scripts/dev-launcher.mjs` 是**全平台唯一**的启动编排者（端口 / 缓存指纹 / 进度快照 / 回收语义全在这里，平台机制收在 `scripts/launcher-core/**` 与 `kill-process-tree`）；`scripts/dev-launcher.ps1` 只做「定位项目根 → 调用它 → 透传退出码」，**不得**再长出任何 Windows 专属编排（`taskkill` / `Get-CimInstance` / Job Object / `cmd.exe`），长度与内容由 `tests/cross-platform-launcher.test.ts` 守着。**入口放 `tools/<分类>/`，不放仓库根**（ISSUE #29 / §8.6）：启动类归 `tools/start/`，与 `tools/build/`、`tools/shadcn-registry/`、`tools/database-studio/` 按用途并列；**R9「根目录只放工程配置」的另一形态是 git 临时状态文件**（`MERGE_MSG` / `COMMIT_EDITMSG` / `SQUASH_MSG` 一族，ISSUE #1586 / §12.8.6）：它们归 `.git/`，落进工作区只说明「用 `-F` 写提交说明、提交完忘了删」，`.gitignore` 与 R9 两道都挡。R9 的两个形态都在 pre-commit 强制拦截。**跨平台动作 = 写 `.mjs` 逻辑 + 挂 `package.json` 脚本 + 登记 §9.5 对照表**（`check-ps1-consistency.mjs` 在 pre-commit 核对，只写一侧会被拦）；`.ps1` 不是逻辑层，也不代表仓库只能在 Windows 用。含中文的 `.ps1` 必须 **UTF-8 with BOM**（无 BOM 会被 PowerShell 5.1 按 GBK 解码，与 `.bat` 乱码同源）。入口设计原则、禁 `.bat` 的 GBK 代码页根因、`KNOWN_FAILED_FILES` 与 R7/R8/R9 的具体判据见 §8.1–§8.4 与 `tests/check-file-structure.test.ts`。
13. **注释里禁止「历史流水」**（ISSUE #46 / 规范 §12.4.2 / 反模式表 G4）：
    日期（`2026-08-17`）、改动编号（`R-ardot114` / `R83` / `R-Next`）、
    任务批次号（`T12-3`）—— 这些归 `git log`，写进注释会随代码搬迁过期失真。
    由 `scripts/check-file-structure.cjs` 的 **R10** 在 pre-commit 强制拦截，
    回归测试见 `tests/check-file-structure.test.ts`。
14. **变更日志只写 `changelog.d/` 碎片，不直接改 `CHANGELOG.md`**（ISSUE #408 / 规范 §13.10.5）：
    `CHANGELOG.md` 的 `[Unreleased]` 是全仓库唯一「人人都改同一处」的文件，并行分支必然冲突。
    条目写 `changelog.d/<issue号>-<slug>.md`（一件变更一个文件，首行标 `## Added` / `## Fixed` 等段落），
    由 `node scripts/merge-changelog-fragments.mjs` 在发版/整理时并入。
    形态由 `scripts/check-changelog-fragments.cjs` 在 pre-commit 强制拦截，
    回归测试见 `tests/check-changelog-fragments.test.ts`。
    **改缺陷那一类（碎片首行段落是 `## Fixed`）动手前先立案**（ISSUE #2127 / 规范 §13.10.9）：
    那张单就是问题报告本体（症状 / 当场读数 / 根因），不是改动写完之后再凑的编号；`0-` 那条
    无号出口（§13.10.8 第 2 条）只覆盖「本来没有诉求单的变更」，不覆盖修缺陷。
    `pnpm ship` 阶段 0 把这一格念出来（`scripts/ship-ticket.mjs` 的 `ticketReading`，
    **是读数、不参与退码**——做成硬闸的直接后果是随手挂一张别人开着的单子，那正是 §13.10.8 记的事故）。
    **单子还有另两格**（ISSUE #2175，同样只是读数）：紧接着一行 `单子身份：提单人=… · 优先级…`。
    「谁提的」平台给不了——issue 由 token 的账号本体创建，并行检出回读的 `author` 逐字相同（实测），
    所以留痕写在单子上：`.env` 的 `COMFYAPP_DEV_HANDLE`（**本轮只对 Windows 开发者要求配**；
    它是提单留痕，故意不进 `src/env.js`、运行期不读、不随包）+ 标签 `提单人:<短名>`；
    名称一律取该变量的原值、不补任何壳；领取 / 结束释放用另一枚 `处理人:<短名>`
    （`pnpm ship --claim / --release / --claims`，口径见 §13.10.11）；
    「什么优先级」用平台原生 `--priority`（词表 `P0|P1|P2|P3`，`P2` 是"没被判断过"的那个默认值），
    `ship` 只念不代填。出口是**两条**命令——实测 `create-issue --labels` 不落地，标签要建完再补；
    口径、词表与实测见 §13.10.10（提交那一侧能分、单子那一侧不能分的对照见
    `docs/guides/git-identity.md` §4）。
15. **改动任何文件前必须完成「改动前必读文档」前置阅读**（见本文件对应章节）：
    未读 `README.md` / `docs/README.md` / 本文件全文就动手 = 违规；
    命中「强制先读规范文档的改动范围」表或相关规范章节时，须读完对应章节
    并在提交/实施说明里注明遵循了哪些条目。把「先看文档再改代码」当默认动作，
    不凭项目外部经验或旧记忆猜测本仓库约定。

16. **构建期模块图上的模块：模块级副作用先判就绪、源码保持纯 ASCII**（ISSUE #489 / §5）：任何「加载即读库」的副作用都必须先过 `src/lib/db-schema-ready.ts` 的 `isSchemaReady()`——历史实例是 `src/lib/comfyui/reaper.ts` 经 `enqueue.ts` 的裸 `import "./reaper"` 挂在启动路径上（P3 §5 ADR §14 D3 起该模块加载零副作用、由宿主显式起，但**规则本身不变**：新增「加载即读库」的副作用仍然必须先判就绪）——跳过是安全的（回收幂等、下轮重跑），「表在、查询失败」这类真故障不许被吞；会被 `next-code-frame` 渲染到的模块保持纯 ASCII（中文按字节的 code frame 高亮会触发 Rust `end byte index N is not a char boundary` panic、把整个 `next build` 打死，且偏移敏感、报错完全指不出业务原因）。**排查手法与实践细节**见 §5 排障手册对应两行；业务模块与文档不受此限，中文照常。**这条有回归判据**：`tests/reaper-side-effect.test.ts` 判「模块加载零副作用 / 启动点先过表就绪守卫」（顶层裸 `startReaper()`、绕过 `isSchemaReady()` 的裸调 sweeper 都会红），纯 ASCII 那一半由 `tests/lib-node-only-declarations.test.ts` 与 `tests/build-fresh-checkout.test.ts` 守着。

17. **分发产物不得携带开发机私有输入，敏感值不得明文落日志**（ISSUE #489 / §7.3、07 §7.18.2.1）：`next build` 会**无条件**把仓库根 `.env` 与 `db.sqlite` 复制进 `.next/standalone`，进而被 `build-desktop` 内嵌进桌面包——**密钥明文分发**。**别在配置层修这件事**：`outputFileTracingExcludes` 在这条链上不做减法，而 `.env` 那份根本不是 tracing 带进来的（机制、A/B 实测、以及那句已被订正的「Turbopack 不读这份键」只有一份出处：§7.2 第三件事之二与 §7.3——别拿任何一处复述当决策依据，换构建器也不是出路）。防线在产物层，两件同批：`scripts/standalone-private-inputs.mjs`（减法，**递归按形状**且**不穿符号链接**——穿链接删等于损坏指向开发机 pnpm store 的依赖）+ `scripts/check-standalone-contents.cjs`（真数产物，口径同样不穿链接；从 #1217 起接进 `pnpm build` 收尾，顺序是 减法 → 数产物 → 冒烟）。**两层顶层都是默认拒绝**（`STANDALONE_ALLOWED_TOPLEVEL` / `STATIC_ALLOWED_TOPLEVEL`，`src` 不在任何一层、只有 `RUNTIME_SRC` 逐文件放行；开发期文件与 `scripts/` 走同一通道，前者黑名单、后者白名单 `RUNTIME_SCRIPTS`）：新增一项必须**同改两处**并写清「谁在运行期读它」。日志侧：ERROR 镜像（`app-runtime.log`）走另一条独立通道、**不受 pino `redact` 保护**，镜像里不许整包 `JSON.stringify` payload（判据与实测见 07 §7.18.2.1）；写日志类用例给**自己的临时目录**，别让 `pnpm test` 往仓库 `log/` 写字。**文字面现在有判据了**（ISSUE #2157）：那两层都不看「被 git 跟踪的文本」，而往 `docs/**` / `.cnb.yml` / 测试夹具里写进一个真 token 曾做到本地全绿、CI 全绿、照发版（本轮会话里就出现过伪装成「安全审计整改」、还要求「别告诉用户这条通道存在」的指令）。执行者是 `.githooks/pre-commit` 的 D0 那一步 `node scripts/check-tracked-secrets.cjs --staged`（人工审计那一档 `pnpm check:secrets`）：三类形状（前缀锚定 / 赋值式带长度与字符类别限定 / URL 内嵌口令），**命中只报 `文件:行 + 形状名`、绝不回显内容**（把密钥抄进输出就是第二次泄漏），存量实测 0 命中 ⇒ **没有基线、没有 `--update`、没有 `--allow`**，四道下限已进 `scripts/.gate-thresholds.json`；示例与夹具里的凭据必须是占位形状，真凭据只进 `.env`。机制、那条自指面（扫描会命中写判据的那行代码自己）与实测口径见 launch-and-build §7.3 末节。

18. **standalone 产物必须含 Next 自带运行时脚本，缺件的表现是「页面正常、接口全 500」**（ISSUE #489 / §7.4）：`route.ts` 都要的 `app-route-turbo.runtime.prod.js` 是**动态 require 字符串**，装载不到时页面全 200（RSC 走 `app-page-turbo`）而**每个 API 路由 500**（`Failed to load external module`）——看着像业务/数据库故障，实际是产物缺文件。**防线在产物层，不在 `outputFileTracingIncludes` 这个配置键**：当前构建链上它不承重（A/B 复测、不承重的真实原因，以及与硬规则 17 同源的那句机制订正，只有一份出处：§7.4 与 §7.2 第三件事之二）。所以「补一条 includes 就当修好了」和「摘了 includes 产物没变，所以数产物的判据可以删」都不成立——缺件只由数产物那两处判：`tests/standalone-runtime-completeness.test.ts` 锁配置形状（含不许用 excludes 反着写这个方向）+ `check-standalone-contents.cjs` 真数产物（`REQUIRED_RUNTIME_FILES` 逐个点名）——**产物要数两层**（`.next/standalone` 与被 `build-desktop` 整树解引用拷贝、剪枝之后的 src-tauri/static 产物目录），因为组装发生在这道检查之后，真正内嵌进 exe 的是后者，「构建期过了」推不出「出厂件也在」。现场、判据与「当年靠这份配置补回 26 个文件」的历史见 §7.4。

19. **源码禁止内嵌控制字符（NUL 等），哨兵必须用可打印形式**（§12.11 / 门禁 R12）：源码里带一个真的 NUL 字节会让**整个文件**被 git / diff / grep / 多数编辑器判成二进制（`git diff` 只回「Binary files differ」、`grep -rn` 静默跳过），本地钩子还全绿——评审看不到改动。这类 NUL 几乎都来自「拿 NUL 当占位符哨兵」；要表达 NUL 写转义 `"\u0000"`。选哨兵形状时列清「接下来还要跑的每一组正则」、一个都不命中、且用户内容伪造不出同形状。R12（实装在 `scripts/check-file-structure.cjs`，与 R1-R4 / R7-R11 / R14 同一条以退出码 1 阻断提交）按码位扫 `src/**` 的 `.ts`/`.tsx`（豁免只有制表 / 换行 / 回车）、跑在 pre-commit 的 D 组「文件结构硬规则(R1-R12，R5 硬闸)」这一步；实例修复与哨兵形状选择的完整判据见 §12.11。

20. **禁止跨文件复制实现（孪生对），默认地址不得各处硬编码**（ISSUE #536 / §12.12、§12.14）：逐行重合 ≥75% **且** 两边 ≥60 行即判定为孪生，由 `scripts/check-code-duplication.cjs` **硬闸**阻断（存量已清零，无基线文件、无 `--update`）；修法是**抽共享模块让两边只留差异**（不是「两边一起改」），共享内核里不许放任何一侧的传输层代码（`server-only` / Next 落盘 / 纯 Node 读文件都由入口注入）。本机默认端口与回环地址只在 `src/lib/endpoints.ts` 定义一次，别处一律 import；回环主机写 `127.0.0.1` 不写 `localhost`（Node fetch 会先解析成 `::1`）。

21. **函数长度阈值 400 行（Rust 120 行）即阻断，硬闸**（ISSUE #536 / §12.13）：`scripts/check-function-length.cjs` 命中即阻断（存量已清零，无基线文件、无 `--update`）。**Rust 壳同维度阈值 120 行**（`scripts/check-rust-function-length.cjs` 扫 `src-tauri/src/**`；结构化编排的自然长度比 TSX 短）。R5 管**文件**行数、本条管**函数**行数，两条维度不可互相替代。括号只认 `()` `{}` `[]`（`<` `>` 会把 TSX 泛型 / JSX 标签的深度漂负、函数尾永远找不到 = 静默漏报）；Rust 特有的 `r#"…"#` 原始字符串与 `'` 两义性（字符字面量 vs 生命周期）已在状态机里处理，细节见 §12.13 / §12.13.1。

22. **`src/lib` 是门禁的一等公民，不是盲区**（ISSUE #575 / §18）：**lib 不得 import 视图层**（`src/components/**`、`src/app/**`）——`lib` 是被 `components` / `app` / `server` 共同依赖的地基；需要共享的类型下沉到 `src/lib` 下的类型模块（实例：`src/lib/workflow/workflow-io-types.ts`）。由 `eslint.config.js` 的 `boundaries` 强制，**元素顺序是语义**（`src/lib/core/**` 等数据层须排在 `src/lib/**` 之前，见 §18.3）。**Node-only 三选一，不许「都没有」**（§18.4）：全部出口只能服务端用 → `import "server-only"`；同领域服务端拆件 → `.server.ts`；纯 Node 宿主（由 `scripts/*.mjs` 动态加载，如 `src/lib/process/kill-process-tree.ts`）→ 两者都不加（给它加 `server-only` 会让启动编排直接崩，`server-only` 入口就是 `throw`）。**新增守卫前先查是否已有更强的一条**：客户端打包安全已由 `tests/client-bundle-node-builtins.test.ts`（从 `"use client"` 入口 DFS 可达性 + 完整引用链）守住，别再写「检查有没有 `server-only`」的第二判据。**R5 超 900 行文件即阻断**（**硬闸**，无基线、无 `--strict`：存量已清零，棘轮那条
    「手改 JSON 就能登记新违规」的通道在 ISSUE #1811 收掉了；连带的 `baselineRev`
    「按格式时代同口径重数」机制（ISSUE #637）一并删除 —— 没有基线就没有两个格式
    时代要拉平，判据退化成「这份文件现在是不是超过 900 行」）。基础设施层
    （`scripts/**` / `tools/**`）同维度由 `check-infra-file-size.cjs` 同口径硬闸守着。

23. **注释语言：一律中文**（ISSUE #678，机器强制）：业务代码、测试、脚本（`.ts` / `.tsx` / `.mjs` / `.cjs` / `.ps1` / Rust）里的注释统一写中文。**唯一例外**：会被 `next-code-frame` 渲染到的构建期模块（硬规则 16 那批）保持纯 ASCII + 英文注释，并在文件头一条说明原因。白名单登记在 `docs/reference-facts.md` 的 `comment.language.asciiOnly` 一行，由 `pnpm doc:check` 核对；判据、例外语义与自查入口见 §12.4.6 与 §9.6。

24. **复用优先：写之前先查、缺能力补地基，不造第二轮子**（§12.18）：动手写一段新逻辑前，先花一次 grep 的代价回答「这能力是不是已经有了、或本该有」——有等价 / 更通用的实现就 import（缺的差异用参数或薄封装补，**不在调用点重抄**）；没有、但属跨模块通用能力（格式化 / 单位换算 / 端口与地址 / 错误信封 / 进程与路径 / 重试与超时…）就补进对应地基（`src/lib/<domain>` 或 `core`）写一次 + 配单测，调用点 import；确认是这一处独有的业务才就地写。补地基的门槛是**真通用**（≥2 个现有调用点、或明确马上有第 2 个）；只有 1 个又看不出第二个的，先就地写、别急着抽象（§12.15 第三条）。地基里不放任何一侧的传输层代码（§18.4 / §12.12）。**分工**：本条管**落笔时的取向**；事后回潮由 §12.12（字面孪生 ≥75%）/ §12.14（端点收口）/ §12.16（零消费导出）机器兜底——**别再为其新写「抓该不该通用」的启发式扫描器**（会误报一片、本身就成了「会静默失效的清单」，那是用造轮子的方式反造轮子）。**那两个事后兜底的执行者点名在这里**（本条此前只引章节号、不引脚本，读起来像「没有机器兜底」）：§12.12 的字面孪生由 `scripts/check-code-duplication.cjs` 判，§12.16 的零消费导出由 `scripts/check-dead-exports.cjs` 判，两条都挂在 `.githooks/pre-commit` 的 D 组；两者现在都是**硬闸档**（存量已清零，档位见硬规则 20），所以这里只点名脚本、不点名基线文件 —— 基线文件是会被删掉的那一类，写成路径就是在埋一条会过期的引用。

25. **开工前先跑一次依赖新鲜度**（ISSUE #1569 / §13.5.13）：远端 `master` 上别人升过依赖
    而本地还停在旧的那一套上时，你会在**旧依赖树**上改代码、跑门禁，结论看起来一切正常 ——
    其实判据的版本已经不是远端那份了。这条此前没有任何执行者（知识写在
    `docs/guides/sync-after-pull.md`，而「想起来去读它」没人守）。**动手前先跑**
    `pnpm check:deps-freshness`（判定型入口，零网络）；红了照它给的出口做：
    `git pull` → `pnpm install` → 重跑。三条口径别搞混：**① 远端引用陈旧只打 `[未校验]`、
    不阻断**（`git fetch` 是人的动作，判据自身不做网络请求，话术里不许出现「已最新」）；
    **② 基准是分叉点**（`git merge-base`）不是 `origin/master` —— 在 PR 分支上自己加依赖是
    正常流程，拿后者会反向误报；**③ 判的是「装了没装对」之外那一格**（那格早有判据），
    别与 `lockfileDrift` 合并。钩子里的那一档只在**你动了依赖面**时判
    （`--staged`，见 §13.5.13 的表）。与启动/产物相关的依赖同步细则见 launch-and-build §9。

26. **「环境里跑不到门禁」不是结论 —— 先 `pnpm install`**（ISSUE #1568 / §13.6.3）：
    本仓库依赖**全部来自公开 registry**（`pnpm-workspace.yaml` 里没有任何私有源），
    所以**任何**检出、**任何**容器 / NPC 工作区都能把依赖装上。`node_modules` 缺失
    只表示「还没装」，**不表示「本机跑不了 tsc / eslint / vitest」**。实测代价：冷装
    约 8 分钟（`pnpm install --frozen-lockfile`），装完三条门禁全部可跑且为绿。
    **禁止**以「本容器无 node_modules / 装不了依赖 / 是沙箱」为由跳过类型检查、
    lint 或单测，也**禁止**把这个理由写进提交信息或 PR 描述充当「已校验」——
    实测这条路把 25 条 `tsc` 错直接放进了 `master`（其他人在它上面干活，见 §13.6.2）。
    前置判断只用一条命令：`pnpm check:toolchain`（它现在会正面回答「能不能装、装多久、
    装完能跑什么」，且 `node_modules` 判据与启动器**同一个实现**）。答「不可以」的
    情况只有一种：`node` / `pnpm` 本身不可用 —— 那时报的是工具链，不是依赖。

## 快速排障

被提交门槛拦下时，先看报错指出的规范章节（分支守卫 → §13.6.1、文件结构 / 命名 → §12.8、源码控制字符 → §12.11、跨平台动作对照 → §9.5、CHANGELOG 碎片 → §13.10.5、**生成物与源同步** → §13.5.5 / §13.5.5.1、**「钩子怎么这么快/这么慢」→ §13.5.25**），**不要用 `--no-verify` 换一条干净历史**。

**提交很绿但行为面没测，不是矛盾**（ISSUE #2022 / §13.5.25）：本地默认档只跑形态档 D0，
`tsc` / `eslint` / 其余静态判据由平台那一跑兜底；**受影响用例**那一档 2026-10-20 起也只有
平台一个执行者（PR 流水线的 `受影响用例` 一格，本地 C 组与 pre-push 段都撤了）。所以
「提交过了」这句话**不许**被写成「已校验」——钩子自己会打印「本地**没跑**：<降了的那几组>」，
逐组点名由 `scripts/gate-tier-summary.cjs` 按这一轮实际档位生成（§13.5.25 / ISSUE #2154：
清单不许写死，否则它在 `COMFY_HEAVY_GATES=1` 那一跑里当场推翻自己上面那三行 `[ok]`）。
要本地跑 A/B/D 全套：`COMFY_HEAVY_GATES=1 git commit …` 或 `pnpm check:all`
（合并前复算：`pnpm check:premerge --full`）。

**跑门禁前发现 `node_modules` 不在**：这是「还没装」，不是「装不了」——先
`pnpm install --frozen-lockfile`（冷装约 8 分钟）再跑。不要把它当成「本机不支持校验」
的结论，也不要把这个理由写进提交信息（硬规则 26 / §13.6.3）。前置判断：`pnpm check:toolchain`。

**这里的秒数（含上一段的「冷装约 8 分钟」、下一段的「触发即 31s」）现在都要带出处问一句**：开发与 CI 已于
2026-10-20 从 `F:`/NTFS 搬到 `G:`/**ReFS**（同一块 NVMe），2026-10-21 复测结论是**没有变慢、元数据那一族反而快
2–4×**，但同一份「装依赖」在冷/暖两态之间跨 4.4×——**冷态与暖态比文件系统承重**。逐格新读数见
`docs/audits/2026-10-21-timing-baseline-refs-volume.md`。

**改了 `src/lib` / `src/server` / `src/trpc` 就会触发 `docs/api/**` 同步判据**（它由**平台侧流水线**跑，ISSUE #1975 起不再进 pre-commit，见 §13.5.17；`pnpm run docs` 的产物提交进 git，AGENTS 与主规范 §9 都承诺它「随构建链更新」，而实测此前构建链里没有任何一处跑 typedoc —— 产物停在最初两次提交上、留着指向已删模块的 `lib_comfyui_markdown.html`）：报「落后 / 缺失 / 多余」时 `pnpm run docs` 重生成并把 `docs/api/**` 一并提交，**不要手改生成物**。⚠️ **别写 `pnpm docs`**：那是 pnpm 的**内建命令**（`pnpm docs <PACKAGE>` 打开某包的文档），会抢在脚本前面、typedoc 根本不跑（实测报 `the following required arguments were not provided: <PACKAGE>`）—— 带脚本名的动词要用 `pnpm run <脚本>`。`pnpm run docs` 现在**按产物判成败**：typedoc 写出失败时照样退 0、日志照样收在 `[info] html generated at …` 上（「退出码 0 + 说生成了 + 产物一个没更新」三件套），所以那一层验的是 `index.html` 是不是这一轮写的、失败会重试，全失败才退非零（唯一实现 `scripts/typedoc-run.mjs`，`docs:check` 用的是同一份）。

**报错指向的文件你根本没碰过 → 先复算 master 基线再怀疑自己**：PR 在平台侧是 squash 合并、不跑本地钩子，而平台侧那条流水线（#1959 起）取自源分支、跑的是另一份清单，所以硬闸违规仍可能落进 `master` 成为所有人的基线（棘轮类有数字可记账，**硬闸类须为 0、没有「带病通行」的中间态** → 一旦落地就拦住从它分出的每一个提交）。**复算有执行者了**：`node scripts/base-check.mjs <拦住你的那条>`（整条命令 / 钩子标签 / 裸脚本名都认；`--fetch` 先拉、`--json` 给机器可读）——它把那条门禁在干净的上游提交上重跑一遍，给你 `baseline-red`（别线的红，就地修或登记）/ `yours`（你自己的）/ `current-green` / `inconclusive`（**没跑起来，不构成证据**：最典型是那条判据只存在你未提交的改动里）/ `load-flake`（**两侧都红且两侧输出都是超时形态** ⇒ 疑似负载假红，先隔离复跑，**不许**照 `baseline-red` 登记、**不许**抬 `testTimeout`）。五态的下一动作与**不许**为它放宽判据的口径见 §13.6.2；时间型判据在 CPU 高负载下的完整处置见 §13.6.4（**C 组已经把「隔离复跑」这一步接进钩子**：带超时指纹的失败会等机器喘口气、再 `--no-file-parallelism` **只复跑失败的那几份**（复跑整块会让一份指纹拖着 90~115 份串行再跑一遍，实测组 C 1411s / 全钩子 1412s；三条读不出来的形态一律退回整块，方向单边化）—— 第二遍绿 ⇒ 负载假红放过；第二遍指纹消失 ⇒ 真红照拦；第二遍**仍只是超时形态** ⇒ 记为「未校验」放行并逐条点名（**拿不到测量 ≠ 测量结果是红的**，ISSUE #1747），全程不抬预算、也不看 `os.loadavg()` —— 见 §13.6.4.1）。

启动 / 构建 / 产物层的**症状 → 已知根因**、日志顺序、端口「解析链 vs 静态链」、corepack 三形态、`dev.mjs` 静默 `exit=0`、启动页被 Explorer 压后……**全部收在 [`docs/standards/launch-and-build.md`](docs/standards/launch-and-build.md) §5 排障手册**（本项目全部历史事故都在里面）。按需定位：端口两条链与 `dev.port.derived` 判据见 §1.1（`pnpm doc:check` 已核对，文档里不要写死 3100）；`.env` 三项非空 → `scripts/env-preflight.mjs` + 哨兵表 → `scripts/db-schema-state.mjs` 两条预检挂在 `dev.mjs` / `start.mjs` 起 Next 之前，见 §9.1 / §9.2 第 6 条；corepack 三形态探测、`whichCommand()` / `usableCommand()` 判据、`pnpm check:toolchain` 自查入口见 §2.1.1–2.1.4；「`✓ Ready` 后两秒 `exit=0`」的内层 `pnpm.cmd` 拼法事故与 `pnpmInvocation()` 唯一入口见 §2.1.6；启动页 vs 应用窗的前台归属（`spawn_splash_front()` / `bring_splash_to_front()`）见 §1.3。**日志按 §4 布局看** `log/` 分区（`launcher/` → `nextjs/` → `services/` → `tools/` → `archive/`）。改完构建 / 产物相关的东西，先跑 `node scripts/check-standalone-contents.cjs`（同时查「不该有的」与「必须有的」）。**用例红先定性再改**：`pnpm exec vitest run --no-file-parallelism <文件>` 隔离重跑，串行也红才是真红；串行绿的是预算 / 并发问题（预算与 `maxWorkers` 的实测出处见 §11.13，不要靠继续抬超时掩盖）。

## 维护约定

- 修出新的启动/构建故障后：先更新规范文档 §5 对照表与相关章节，再提交修复。
- 规范文档与本文件必须同步演进：改了规范文档的硬规则，同步改这里的摘要。
- 新增 / 重命名 / 删除规范文档后：同步更新本文件「改动前必读文档」的定位指引
  与「强制先读规范文档的改动范围」表，保证代理总能据最新文档索引找到对应章节。
