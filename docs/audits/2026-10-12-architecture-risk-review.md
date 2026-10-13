# 2026-10-12 架构风险与质量审查（risk-quality-reviewer）

> 产出方式：`architecture-visualization:explore` 路由 → `risk-quality-reviewer` 主场景，
> 风险网络图由 `graphviz` 基础层产出（`2026-10-12-architecture-risk-map.dot`）。
> 本次审查**不改代码**，只出证据支撑的清单、优先级与验收判据。

## 审查目标与范围

- 目标：判断当前架构是否足以支撑「本地桌面包 + 外部 AI 客户端接入 + 提交级机器门禁」这三个意图，找出值得优化的点。
- 范围：`src/**`、`scripts/**`、`tools/**`、`src-tauri/**`、`.githooks/**`、构建与产物链路、网络入口、治理判据自身。
- 不含：单条业务功能对错、UI 观感、`docs/audits/2026-09-26-performance-audit.md` 已闭环的微性能项。
- 证据基线：`master` @ `b4705c3d`，工作树干净。
- 风险容忍度假设（未与业主确认）：产品为单机桌面应用，数据只在本地；外部 AI 客户端接入是刻意能力。

## 结论摘要

**处置状态（本轮之后）**：R1-01 / R1-02 已合并进 `master`（PR #1783，squash）；R4-01 已合并（PR #1787）；**R3-01 已合并（PR #1791）**——新增 `scripts/check-infra-file-size.cjs` + `.infra-file-size-baseline.json`，登记面（`D(55→56)`、§13.1 逐字行、`docs/standards/12` 的 R5 姊妹档一节、`RATCHETS` 沙箱行、`docs/generated/**`）同批改齐，并且新判据在它自己那笔提交的钩子里就跑到了（`[ok] ── check: 基础设施层文件长度棘轮…`）。**它上线后第一次响，响的是别人的合并**（#1777 往固定清单加了 7 行注释，把 `scripts/affected-tests.mjs` 顶过基线 952）；这一格**随后由 #1793 以更好的方式解决**——把整张清单连注释搬到 `scripts/fixed-structural-tests.mjs`，那份从 963 → 487 行、退出超限名单、基线 6 → 5 收紧。本报告初稿准备的处置（压缩我自己那两条注释的行数）**因此作废、没有提交**——记录在这儿，是因为「先补自己那笔的形状」和「把长出来的理由文本搬出去」是两个方向的修法，后者才对：登记一条守卫的成本不该算进判据自身的长度。R2-01 已被 #1793 那半推进了一格（push 时有复算 + 归属），详见该节。R5-01 已实施但**被自己的日账正当拦下**，改动停在 stash（`wip-r5-desktop-count-*`，分支
`fix/desktop-payload-count-after-assembly` 上没有提交），前置是 `pnpm run build` 跑绿（今晚量清：**两道红排在它前面** —— R13-01 的体积预算与 R8-01 的冒烟，见那两节）。
**这里要订正我自己的一句**：初稿说「它落地时还会撞刚上线那道 infra 棘轮 —— `build-desktop.mjs` 记的基线就是它
当前的 1576 行，任何净增长都拦，所以那 33 行必须先做成独立模块」。**那句不成立**：
`wc -l scripts/build-desktop.mjs` 实测 **495 行**，而 1576 那一格记的是 `scripts/dev-launcher.mjs`
—— 两个数在同一份 `.infra-file-size-baseline.json` 里相邻两行，我把行对错了文件。
所以那道棘轮**管不着这笔改动**，「拆分」也不是它的前置；R5-01 卡住的那一格从头到尾只有产物日账一个。

**审查中新撞出来、且至今没定性完的一条是 R8-01**：本检出的 `pnpm build` 红在冒烟那一步（清空产物从零重跑仍红）。
机制已量到「**沿 payload 里的符号链接走 = `EPERM`，而直接指到同一个目标 = 没事**」这一层 —— 链接在场、
目标在场且可 `stat`、开发树同类链接正常，所以它既不是「产物缺件」（`check-standalone-contents.cjs` 数得干净是对的）
也不是「包没装」。初稿那句「`pnpm build` 在合并后的 master 上红」**归因过强，已订正**；本轮我另加的第三个候选
「本检出依赖树半态」**已由 20:12 的健康树重建否证**（`next build` 112 秒从零编成，冒烟仍在同一格红），
详见 R8-01 —— 留这段是因为它演示同一条纪律的**反方向**：一个看着完全同形的解释也得做一次实验把它踢掉，
不能因为「形状一样」就当它是已定的。

1. **P0｜Workshop MCP HTTP 入口在局域网与任意网页面前可达**（无鉴权 + 通配 CORS + 未固定监听地址），而这组工具能改库、删会话、发起出图/出视频。—— **已修**（PR #1783）。
2. **P0 → 本轮已被别人推进一半｜「合并那一跳没有机器执行者」**：`.githooks/pre-push`（现 34 行）在 HEAD / 上游引用变动时把 refs 交给 `scripts/premerge-proof.mjs`，后者**在干净的上游快照上复算钩子里那批全仓判据**，按 `yours / baseline-red / load-flake / inconclusive` 决定拦不拦（§13.6.2.1）——这正是 R2-01 要的那个「隔离执行者」的本地版本。仍剩它自己声明的两格：`不替代 pnpm check:all`（全量单测 + 覆盖率 + 依赖审计那一档仍无人敲），以及 push 是本地事件（不 push 就不跑）。详见 R2-01 的更新。
3. **P1｜债务门禁全部只扫 `src`，而判据自身（`scripts/**` 约 43k 行）在它自己的硬闸之外**：审查当时 6 个文件超过 R5 给产品代码定的 900 行上限，最大一份是判据本身。—— 判据已上线（PR #1791），存量随后由 #1793 以「搬家」方式收到 5 份（见 R3-01 的落地情况）。
4. **P1｜覆盖率配置缺一条「每一项都要落到真实文件」的判据**（初稿的「40 条静默失效」被实测否证，订正为 3 条指向已删模块）。—— **已修**。
5. **P1｜出厂载荷（`src-tauri/static`）的数产物判据不在出厂链路上**。—— 代码与规范已写好，停在「等 `pnpm run build` 跑绿」这一格上（前置就是 R8-01）。
6. **P1（新增，本报告初稿曾误判为 P0/master 红，已订正）｜payload 的 `node_modules/.pnpm` 链接层对本机原生 Node 不可跟随（`stat` = `EPERM`）**：冒烟因此报「找不到 `promise-limit`」，而包其实在场。它同时暴露了「数得干净」与「跑得起来」之间的一格落差 —— 见 R8-01。
7. **P2（入库过程中新撞出）｜D 组那步「四语言端口一致性」把 `ETIMEDOUT` 报成内容红**，而 C 组早就有「隔离复跑 + 未校验」那套 —— 见 R11-01。
8. **P2（同族，且本条的一半已在本轮修掉）｜两份判据把远端名写死成 `origin`**，而本仓的远端叫 `cnb` ⇒
   `pre-push` 那道复算在这份检出上**挡住了每一次 topic push**（已由 #1814 修），
   `check-deps-freshness` 则**恒报「未校验」**（未动，要先拍「远端叫什么由谁给」）—— 见 R12-01。
   这一对合起来给出本轮最可复用的一句结论：**判据不许假定读者的 git 配置**；
   同一条判据在 A 检出绿、在 B 检出行为不同 ⇒ 「我这边跑过一次是绿的」不构成证据。
9. **P2（今晚实测）｜体积预算的执行者恰好是产物账的唯一凭证入口** —— `check-bundle-budget.cjs` 既不在
   `.githooks/pre-commit`、也不在 `premerge-check` 的全仓复算名单里，只在 `pnpm build` 收尾兜底；
   于是 #1781（18:12 生成基线）落地两小时后，`master` 上的 `pnpm build` 已经是红的（gzip +471 B，
   **不是本笔造成的**），而「跑一次 build」正是 `artifact` 档唯一的记账通道 ⇒ 下一个需要产物账的人
   会被一道与自己无关的红锁死 —— 见 R13-01。

## 现状数字（审查当日实测）

> ⚠️ **这张表是审查当日（`master` @ `b4705c3d`）的快照，不是现值** —— 尤其最后两行：
> 它们列的棘轮存量**已随 ISSUE #1811 的收尾整体清零并翻成硬闸**（那 8 份基线文件
> 今天一份都不在，`--update` / `--strict` 也从对应脚本里删了）。要看现值请跑
> `node scripts/check-gate-executors.cjs` 与 `tests/ratchet-update-guards.test.ts`
> 现算的那两张表（`HARD_GATE_FLIPS` / 四张归类表），**不要引用本表的数字**。
> 这条注记是 2026-10-13 复审时补的：本文件不在 `doc:check` 的 `SCOPED_DOC_DIRS`
> 里，所以它自己的引用漂移没有任何判据会红（见本节末「台账自身的门禁影响」）。

| 维度                          | 数值                                                                                             | 出处                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 产品代码（`src` 非测试）      | 184,855 行                                                                                       | `find src … -not -name '*.test.*'`                        |
| 门禁/工具层（`scripts` 顶层） | 43,142 行 / 118 份 `.mjs`+`.cjs`                                                                 | `find scripts -maxdepth 1`                                |
| 测试                          | 58,100 行 / 705 份用例（另有 19 份 Playwright 规格）                                             | `find tests src e2e`                                      |
| 文档（`.md`）                 | 57,969 行 / 82 份                                                                                | `find docs -name '*.md'`                                  |
| 判据脚本                      | 68 份：判定型有执行者 65、按需召唤 2、报告型自称在跑 0                                           | `node scripts/check-gate-executors.cjs`（本次实跑，退 0） |
| `src` 侧棘轮存量（**当日快照**） | 文件长度 0 / 函数长度 0 / Rust 函数长度 0 / 孪生对 0 / UI-逻辑分离 0 / 循环依赖 0 / 零消费导出 0 | 当日各 `scripts/.<name>-baseline.json`（**均已删**）      |
| 仍带存量的棘轮（**当日快照**）   | 非空断言 167 处                                                                                  | 当日 `scripts/.non-null-assertions-baseline.json`（**已删**） |

**读法**：产品代码的结构性债务已被清零，因此「优化」的着力点不在业务代码内部，而在**判据覆盖不到的三处边界**（网络入口、合并点、判据自身）与**手改清单的同步面**。

## 发现清单

| ID     | 严重度 | 可能性 | 影响的架构属性            | 置信度                                 | 状态                                                                                                      |
| ------ | ------ | ------ | ------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| R1-01  | P0     | 中     | 安全 / 数据完整性 / 成本  | 高                                     | 已确认（代码 + 运行时）                                                                                   |
| R1-02  | P1     | 高     | 可维护性 / 可移植性       | 高                                     | 已确认（代码 + 全仓检索）                                                                                 |
| R2-01  | P0     | 高     | 交付质量 / 一致性         | 高                                     | 已确认（历史 + 现状），属有意取舍                                                                         |
| R3-01  | P1     | 中     | 可维护性 / 自证性         | 高                                     | 已确认（判据源码作用域）                                                                                  |
| R4-01  | P1     | 中     | 可测试性 / 静默失效       | 高                                     | 已确认（配置注释记录了既往现场）                                                                          |
| R5-01  | P1     | 中     | 分发正确性 / 隐私         | 中-高                                  | 已实施并投毒验收；停在 stash（`wip-r5-desktop-count-*`）等产物日账绿                                      |
| R6-01  | P2     | 低     | 工具链一致性              | 低                                     | 待验证（未实测分叉）                                                                                      |
| R7-01  | P2     | 中     | 运行时可诊断性            | 中                                     | 记录为已知风险，非新发现                                                                                  |
| R8-01  | P1     | 高     | 交付正确性 / 可发布性     | 高（机制已测到底）                     | 剩两个候选：本机 payload 链接层 / #1777 改了 import 图；「本检出依赖半态」已由 20:12 的健康树重建**否证** |
| R10-01 | **P1** | 高     | 治理自证性 / 多检出一致性 | 高                                     | 已确认（今天在这一台机器上实测到两次，含一次我自己读错）                                                  |
| R9-01  | P2     | 高     | 治理自证性 / 代理可靠性   | 高                                     | 已确认（12 处逐条列过；我初稿的 19 已订正）                                                               |
| R9-02  | P2     | 高     | 文档准确性                | 高                                     | 已确认（15 对 17，两数当场数过）                                                                          |
| R8-02  | P2     | 中     | 治理自证性                | 高                                     | 已确认（且这次它站在我对面挡住了我）                                                                      |
| R11-01 | P2     | 高     | 治理自证性 / 提交体验     | 高（本笔提交实测撞到，就地复跑退 0）   | 新发现，未处置                                                                                            |
| R12-01 | P2     | 高     | 治理自证性 / 判据可移植性 | 高（两处都在本检出当场量到）           | 一半已修（#1814）；`check-deps-freshness` 那一格未动                                                      |
| R13-01 | P2     | 高     | 交付正确性 / 治理自证性   | 高（#1781 落地两小时内即测得体积漂移） | 新发现，未处置：修法给了三条，需这条线拍口径                                                              |

---

### R1-01（P0）Workshop MCP HTTP 入口可达面超出本机回环

**证据**（这组行号是**修复前**的，按本文件开头的证据基线 `master` @ `b4705c3d` 逐条核过；
R1-01 已随 #1783 合并，同一份文件里这些行现在是别的内容）

- `tools/workshop-mcp-http.ts:15-18` — 对每个请求无条件设 `Access-Control-Allow-Origin: *`，并在 `OPTIONS` 上放行 `Content-Type`、`Accept`、`MCP-Protocol-Version`。
- `tools/workshop-mcp-http.ts:25` — `POST /mcp` 分支之前**没有任何鉴权、令牌、来源校验**。
- `tools/workshop-mcp-http.ts:52` — `httpServer.listen(PORT, cb)` 未传 host。本机实测 `require('net').createServer().listen(0)` 得到 `{"address":"::","family":"IPv6"}`，即绑定所有接口（Windows 双栈下同形暴露 IPv4）。
- `src/server/mcp/workshop-mcp.ts:95-395` — 该入口暴露的工具含 `setScript` / `setCharacters` / `setStoryboard`（整幅覆盖草稿）、`deleteSession`、`generateImage` / `submitVideo` / `composeFinal`（消耗算力与第三方额度）。写操作只要一个 `sessionId`，而 `workshop_create_session` / `workshop_list_sessions` 就在同一未鉴权入口上。
- `vitest.config.ts:267-270` 的注释本仓库自己的定性：这一层是「外部 AI 客户端可写的入口」。
- 反向证据（说明不是已识别项）：全仓检索 `Access-Control-Allow-Origin` 只命中 ComfyUI 内嵌探测逻辑；`scripts/doc-facts.cjs:164-167` 与 `scripts/check-app-port-vectors.cjs` 只核对端口**数值**，没有任何判据核对**绑定范围**；`docs/workshop-mcp.md` 写的是 `http://localhost:<mcp 端口>/mcp` —— 文档描述的是回环，代码执行的是全网卡。

**为什么是架构级**：这是产品唯一的「机器可写入口」，其信任边界（谁能改库、谁能花用户的钱）由一个 `listen()` 参数和一个响应头决定，且这一格落在现有 68 份判据的作用域之外。它同时违反仓库自己的硬规则 20（回环主机一律显式 `127.0.0.1`，`src/lib/endpoints.ts:21` 有唯一常量出处）。

**修复（按代价从小到大）**

1. `listen(PORT, LOOPBACK_HOST)`，`LOOPBACK_HOST` 从 `~/lib/endpoints` 引入（复用既有单源，不新增常量）。
2. 去掉通配 CORS：本机原生 MCP 客户端不需要跨源；若确有浏览器客户端，改为显式 origin 白名单（env 配置），并保留「无配置即不发出 CORS 头」。
3. 可选：`MCP_HTTP_TOKEN` + 缺失/不符即 401，把「本机能连」与「这个调用方可以写」分开。
4. 补一条判据：断言该入口的监听地址为回环常量、且源码中不存在 `Access-Control-Allow-Origin: "*"`——挂进 `.githooks/pre-commit` 的 F 组，并按 §9.5 登记跨平台动作对照表。

**验收**：新增用例红/绿可复现；`netstat -ano | findstr <mcp 端口>` 显示 `127.0.0.1:<port>`；从局域网另一台机器访问该端点得到拒绝连接。

**不修的条件**：若该入口只在本机受控环境使用且明确接受「同网段可写」，需要把该接受写成 `docs/reference-facts.md` 的一行事实并加反向门禁（禁止改回通配），而不是留在沉默状态。

---

### R1-02（P1）MCP 入口没有任何测试覆盖，且 `tools/**` 不在债务门禁作用域内

**证据**：`src/server/mcp/workshop-mcp.test.ts` 覆盖工具定义，全仓无一处测试触及 `tools/workshop-mcp-http.ts`（`listen` 参数、CORS 头、状态码）；`scripts/check-code-duplication.cjs:18,48`（只扫 `src/**` 的 `.ts/.tsx`）、`check-function-length.cjs:42`、`check-non-null-assertions.cjs:45`、`check-file-structure.cjs:685` 同样不收 `tools/**` 与 `.cjs/.mjs/.ps1`。

**修复**：为 transport 入口加一份最小用例（起服务、断言地址族与响应头），并把它列入 `vitest.config.ts` 的 `coverage.include`；R3-01 的作用域扩面同时收编 `tools/`。

---

### R2-01（P0，属有意取舍）质量门禁只有「本地提交」这一个执行者

**证据**

- `git log`：`748f1c3d` "ci(cnb): 删除平台侧流水线 .cnb.yml，门禁只留本地提交门槛"、`a4635ec8` "删掉匹配不到任何事件的 .cnb.yml"。仓库现状无任何 CI 描述文件（无 `.cnb.yml`、无 `.github/`）。
- `AGENTS.md` 硬规则 6 自述：`--pr-check` / `--merge-commit` 两个服务端判据随 #623 失去调用方，「**目前不再有 CI 兜底**」；快速排障一节自述：平台侧 squash 合并不跑本地钩子，硬闸违规可直接落进 `master` 成为所有人的基线。
- 事故已发生并被写进规范：`§13.6.3` 记录「这条路把 25 条 `tsc` 错直接放进 `master`」。
- 补偿成本实测（本次审查计量）：`base-check.mjs` 1,381 + `check-commit-claims.mjs` 715 + `check-known-failed-stale.mjs` 410 + `premerge-check.mjs` 406 + `freshness-gate.mjs` 332 + `check-merged-side-loss.mjs` 256 + `known-failed-selftest-gate.mjs` 161 = **3,993 行**。这些判据的作用是「事后证明合并点上本该有的那道闸没被跳过」，而它们本身也只在本地跑。
- `pnpm check:all`（`quality-gate.mjs`，332 行）存在，但除人工召唤外没有任何调用方。

**这不是「没人想过」——决策有判据**（订正本节初稿的证据缺口）：`tests/no-platform-ci-config.test.ts` 明确禁止仓库里出现任何自动触发型 CI 配置文件，并把它登记为**一致性判据**（要恢复平台侧必须先改 `§13.5.3`/`§13.5.4`，"改不动就说明还没想清楚"）。其文件头记录的理由是本仓库用不起平台流水线（免费额度撑不起每次提交都跑），且 `ISSUE #1229` 曾被重新加回一份写错的 `.cnb.yml`（顶层直接 `stages:`/`jobs:`，CNB 的形态是 `分支: { 事件: [流水线] }`，匹配不到任何事件），据此删除并立此判据。所以「有配置文件」与「配置在跑」是两件事这条已被他们自己核过。

**判断**：架构上缺的不是判据，也不是决策，是**隔离的执行者**。当前所有质量结论都建立在「每个开发者本机的一次 `git commit`」上，因此衍生出负载假红、不可归因、共享检出竞争这一整族问题（`§13.6.4` 与 `base-check.mjs` 的五态判定就是为它们写的）。

**修复方向（须与既有判据共存，不能提「恢复平台 CI」这种会被 `no-platform-ci-config.test.ts` 当场拦下的方案）**

**已落地一半（#1793，写在最前面）**：`.githooks/pre-push` 现在把待推送 refs 交给 `scripts/premerge-proof.mjs`，后者在**干净的上游快照**上复算钩子里那批全仓判据，并按归属决定拦不拦（`yours` / `load-flake` / `inconclusive` 拦，逐条都是 `baseline-red` 则放行且逐条念出）。这既是「合并那一跳的执行者」，也正是下面第 1 条当年想要的那个东西——只是它选了本地 push 时点而非平台流水线，与 §13.5.3 的额度结论不冲突。剩下的两格是它自己在文件头声明的：**不替代 `pnpm check:all`**（全量单测 + 覆盖率 + 依赖审计那一档仍无人敲），以及 push 仍是本地事件（`--no-verify` 之外的另一条静默路径是「不 push」）。

1. 把 `pnpm check:all` 接进同一跳（`pre-push` 里已有复算那一档，缺的是更宽那档）——它存在但除人工召唤外没有调用方；接上时要按 §11.13 的实测预算分档，别把 32 分钟塞进 push。
2. 量化一次钩子耗时（分步日志已落 `LOGD`），据此决定哪些档留在提交钩子、哪些移到 push 那一档——重档挂在 `commit` 上是负载假红的直接来源（`§13.6.4`）。
3. 已随 #1793 一并改善的一点：`base-check` 的归属判定现在有了 push 侧调用方，`baseline-red` 不再是「只能人工去跑」的取证。

**验收**：能指出「一次变更在进入 `master` 前，由哪条命令、在哪个隔离环境里跑完这 68 份判据」并当场复现一次；`base-check.mjs` 的 `baseline-red` 出现频率下降（它是这条风险的直接症状）。

---

### R3-01（P1）债务门禁只扫 `src`，判据自身在其硬闸之外

**证据**

- 作用域：`check-file-structure.cjs:13` 对 R5 的定义即「**src/** 下超 900 行的文件」，根目录参数只有 `"src"`；`check-function-length.cjs:42` `SCAN_DIR = "src"`；`check-non-null-assertions.cjs:45` 同；`check-code-duplication.cjs:18,48` 只收 `src/**` 的 `.ts/.tsx`。
- 后果（实测）：`scripts/` 顶层有 6 份文件超过 R5 给产品代码定的 900 行硬闸——`check-ui-primitives.cjs` 4,819、`dev-launcher.mjs` 1,575、`base-check.mjs` 1,381、`check-file-structure.cjs` 1,213、`check-theme-colors.cjs` 991、`affected-tests.mjs` 931。其中「判据自己违反自己的阈值」是最刺眼的一格。
- **落地情况（本条已闭合并被他人收口）**：判据以「另立脚本 + 另立基线」上线（PR #1791，登记面见 §13.1 / `D(56)` / `RATCHETS`）。上线后第一次响的是 #1777 加进固定清单的 7 行注释；随后 **#1793 把整张清单连注释搬进 `scripts/fixed-structural-tests.mjs`**，`affected-tests.mjs` 从 963 → 487 行、退出超限名单，基线 **6 → 5** 收紧。修法比本报告初稿准备的「压缩我自己那两条注释的行数」更对：登记一条守卫的**理由文本成本不该算进判据自身的长度**——否则「写清楚为什么」这件事会被长度判据反向惩罚。
- 非技术可行性问题：`check-comment-language.cjs:82` 的 `SCAN_DIRS = ["src","scripts","tests","e2e"]` 证明扩面做过。
- 维度缺口：`.cjs/.mjs/.ps1` 上的孪生对、超长函数、非空断言没有任何判据（`tools/**` 共 39 份 `.ps1`）。Rust 侧有独立 120 行阈值（`check-rust-function-length.cjs`），说明「按语言分档」的先例存在。

**修复**：给上述四份门禁加 `--root <dir>`（默认保持 `src`，行为不变），再为 `scripts/`、`tools/`、`tests/` 建**独立基线文件**并按实测值起档（棘轮只许降）。起步建议：阈值先取「当前最大值不升」，不追求一次清零；`.ps1` 的函数/长度维度可先只做长度棘轮。

**验收**：`--strict` 下新增超长门禁脚本即红；基线数字进入现有台账（`check-gate-executors.cjs` 已能证明它有执行者）。

---

### R4-01（P1）覆盖率配置缺一条「每一项都要落到真实文件」的判据

**订正（本报告初稿在这一条上给了错的结论，此处按实测改写）**：初稿推测「约 40 条 `thresholds` 条目不在 `coverage.include` 里，因此静默失效」。实跑否证了它：拿 `coverage/coverage-summary.json`（2026-10-10 那次，380 个文件）逐条比，**全部 380 个都能被 `include` 里的某一条命中**，且那 40 条里绝大多数确实出现在报告里。原因是 `include` 的语义是「额外把没被 import 的文件也拉进报告」，不是「只报告这些文件」——被用例真实 import 到的文件本来就在报告里。所以「`include` 由 `thresholds` 派生」这个初稿建议**不成立**：那样会把 `include` 里 180 个「零门槛但要在报告里」的条目丢掉，反而是收紧了判定面。

**真实存在的缺口是另一格**：153 条 `thresholds` 键里有 3 条在报告里查无对应文件，其中 2 条指向**已被删除的模块**
（下面三个 `vitest.config.ts` 行号是**修复前**的，随 #1787 删除后已漂移，今天按模块名 grep 才是入口）——

- `vitest.config.ts:683` → `src/lib/comfyui/executor-scheduler.ts`（随 `90c627e3` 「两条派发循环收成一条 pull」删除）
- `vitest.config.ts:554`（`include`）与 `:1861`（`thresholds`）→ `src/server/api/routers/train.ts`（随 `a80d13ff` 「废弃炼丹功能」删除）
- `src/components/ui/select-chip.tsx`（文件在、也有同名用例）在报告里缺席，成因未查——它同时出现在 `include:389` 与 `thresholds:1552`，形状上是对的，所以更可能是那次运行的采样差异，不当结论用。

这两条本身无害（指向不存在的文件 = 不判），但它们说明**「coverage 配置里的键必须还能落到真实文件」这件事没有任何判据**：删模块的人清了路由、清了 `src/**`，没有清 `vitest.config.ts`，而 68 份判据里没有任何一份会因为「配置指向已删文件」变红。同族的既有先例是 `tests/rest-endpoint-targets.test.ts`（「客户端写的 REST 地址必须有落点」，台账 E3‴）——同一类「写得很像真的、其实查无此物」，只是那一格在 `src/**`、这一格在配置文件里。

**修复（已落地，PR #1787）**：加一份全库级不变量用例（登记在 `scripts/fixed-structural-tests.mjs` 的固定清单——审查当时它还在 `scripts/affected-tests.mjs` 里，#1793 搬了家），真 `require` `vitest.config.ts`（不解析源码文本，口径同 `tests/dist-artifact-hygiene.test.ts`），断言 `coverage.include` 的每个条目与 `coverage.thresholds` 的每个键都能匹配到 `src/**` 下至少一个真实文件；随本条一起删掉那三条已失效的条目（`include` 里的 `routers/train.ts` + 两条指向已删模块的档）。**注意**：判据要按 §11.7 那条坑处理转义（`src/app/\(main\)/…` 这类键带反斜杠转义，与 `include` 的写法不同形，直接字符串比会造出假红）。

**验收**：新增一条指向不存在文件的门槛键时用例必须红；本次两条失效条目删除后转绿。

---

### R5-01（P1）出厂载荷那一层的数产物判据不在出厂链路上

**证据**

- `AGENTS.md` 硬规则 18 自述：「产物要数两层……真正内嵌进 exe 的是后者（`src-tauri/static`）」，并强调组装发生在检查之后。
- 链路顺序（实测）：`package.json:7` 的 `build` = `next build && build-executor-host && standalone-private-inputs && check-standalone-contents && smoke`；`scripts/build-desktop.mjs:122/155/221/244` 是「跑 `pnpm build` → 组装 `static` → 装配期剔除顶层条目 → 剔除私有输入」；`build-desktop.mjs` 全文只有两次 `spawnSync`（134、280），装配后**不再调用** `check-standalone-contents.cjs`。
- 判据自身会主动沉默：`check-standalone-contents.cjs:394-395、416`——`static` 里没有 `server.js` 就按「半成品目录」处理、不提缺件；`:517-520` 仅在目录存在时数它。也就是说：**跑在装配之前的那次检查数到的是上一轮的 `static`**，本轮装配结果从未被数过。
- `tools/build/*.ps1` 那三份入口（`build-all` / `build-standalone` / `rebuild-static`）是转发壳，逻辑在 `tools/scripts/*.ps1`；转发链里同样没有这一步。

**风险形态**：整树解引用拷贝（`dereference: true`）+ 剪枝之后带进来的私有输入（`data/`、`log/`、`db.sqlite`、`.env`）在出厂那一次没有任何计数；防线退回到「装配步自己别漏」。

**修复**：在 `build-desktop.mjs` 剪枝完成后、`tauri build` 之前，同批调用一次 `check-standalone-contents.cjs`（它已支持数 `static` 层）；`§9.5` 跨平台对照表与 `check-ps1-consistency.mjs` 同批登记，避免只写一侧。

**验收**：① 判据那一半**已做**——往装配后的 `static` 里放一个 `db.sqlite`，`check-standalone-contents.cjs`
点名两条违规并退 1 ⇒ 「真数产物」这一层有牙。② **接线那一半还没有被执行者跑到**：2.6 步要在一次完整出厂构建的日志里看到「standalone + static」两次计数，才算「装配之后确实数过一次」；而那要求
`pnpm run build` 先跑绿。**今晚量清了挡着它的到底是两格，不是一格**：链路里
`check-bundle-budget.cjs` 排在冒烟**之前**（`package.json:7`），所以现在是 R13-01 那道体积红先响，
R8-01 那道冒烟红排在它后面 —— 两个都要有人处置，R5-01 才拿得到凭证。**别把 ① 当成 ② 的证据**——① 只证明判据认得出投毒，
不证明出厂链路真的敲了它。

---

### R6-01（P2，待验证）类型判决面是两套编译器

**证据**：`package.json` 的 devDependencies 里 **两个别名指向两个不同编译器**——
`"@typescript/native": "npm:typescript@^7.0.2"`（`tsc --noEmit`，即 `check` / `typecheck` 走的那条）与 `"typescript": "npm:@typescript/typescript6@^6.0.2"`（`eslint` / `typescript-eslint` 用的那套）并存；`AGENTS.md` 硬规则 2 钉住 `useTypeScriptCli: false`；已有 `check-tsc-diagnostic-executors.cjs`（§13.5.14）管「类型层声明 ⇄ 执行者」。

**为什么仍列为待验证**：本次没有构造出两编译器判定分叉的实例，因此不写成已确认风险。需要的一条判据是：**同一份代码在两套编译器下的诊断差集是否为零**（一次全量对比即可回答）。若长期并存，则「`tsc` 绿」这句话在规范里需要限定是哪一套。

---

### R7-01（P2，记录为已知风险，非新发现）陈旧实例与壳重编耦合靠人工动作 + mtime 判据

**证据**：`AGENTS.md` 硬规则 5 与 `scripts/shell-gate.mjs`（复用 `dev-launcher.mjs` 的 `shellStaleWarning()`）、`docs/guide-stale-code.md`、launch-and-build §4.3。规范自身已把「不重编 = 跑旧二进制」定性为历史黑屏事故来源，且 `tools/scripts/build-tauri-release.ps1:62-64` 记录了「`/api/update-check` 的脏检测指纹只看 mtime+size（无内容 hash）」，并为此专门改成内容相同不写盘。

**可优化点（低优先）**：既然 mtime+size 已被识别为不足以判脏，`shellStaleWarning()` 与 `/api/update-check` 这两处可换成内容指纹（哈希），把「时间型判据」从判据面上摘掉——这一类判据在本仓库还有别的实例（`§13.6.4` 的负载假红同源）。

---

### R8-01（P1，本报告初稿曾误判为 P0/master 红 —— 已订正）产物 payload 的符号链接层对本机原生 Node 不可解析

**订正说明**：本节初稿写的是「`pnpm build` 在合并后的 `master` 上红」。继续往下挖之后，这个归因**站不住**：
红是真的、可复现，但它落在**本机这份 payload 的链接层**上，不是某笔代码改动把它改红的。留这条订正记录是因为
它正好演示了本仓库规范反复强调的那一格 —— 「红指向我没碰的文件时，先当场复现、再复算基线，最后才动结论」。

**机制（实测到不能再往下的一层）**

- 冒烟报的是 `Cannot find package 'promise-limit' imported from .next/standalone/node_modules/.pnpm/@libsql+client@0.18.0/node_modules/@libsql/client/lib-esm/ws.js`。
- 但包**在**：`.pnpm/promise-limit@2.7.0/node_modules/promise-limit` 是真目录，`index.js` + 完整 `package.json`（`main: index.js`）都在，`@libsql/client` 也把它列在自己的 `dependencies` 里（不是 peer/optional）。
- 起决定性形状的是链接本身：从 `ws.js` 那条路径出发，`fs.readlinkSync('…/node_modules/promise-limit')` 给出 `..\..\promise-limit@2.7.0\node_modules\promise-limit`（目标存在），而对**同一个链接**做 `fs.statSync` 报 **`EPERM: operation not permitted`**；同一时刻 `.pnpm/libsql`、`.pnpm/@libsql/core` 这些兄弟链接也都是 `EPERM`。
- 也就是说：不是「缺包」，是**这份被拷贝出来的 `node_modules/.pnpm` 链接层，对本机原生 Node 不可跟随**（Git Bash 那侧能穿，所以 `ls` 一切正常 —— 这正是最容易骗过排查的地方）。任何从 payload 内部发起的 `require` 都会以「找不到包」收场。
- 对照：仓库自己的 `node_modules/next`、`node_modules/@libsql/client` 这些链接 `realpath` 一切正常 ⇒ 问题限定在 **`next build` 拷出来的那一份**。

**为什么这件事仍然值得留在台账里**

1. `scripts/check-standalone-contents.cjs` 的计数口径**刻意不穿符号链接**（硬规则 17：穿链接删会损坏依赖）。于是一份「链接层根本没法被运行期解析」的 payload，在它眼里照样是 `[standalone] ✓ 产物干净`。这一格「数得干净」与「跑得起来」之间的落差，正好是 `R5-01` 想收的那一类，只是维度不同（它管缺件/多件，这一格管可解析性）。
2. `build-desktop.mjs` 的 §载荷实体化（上提 + 删 `.pnpm`）存在的全部理由就是「链接语义搬不过去」（ISSUE #1216 实测的 `@swc/helpers` 那一族）。而 `smoke-executor-host-standalone` 跑在 **实体化之前** 的 `.next/standalone` 上 —— 所以它对「链接能不能被原生 Node 跟随」是敏感的，这条敏感这次确实把它响了。

**已做掉的那一步：干净重建（原「待定性」项）**

- `rm -rf .next`（`git ls-files .next` = 0，无入库内容；删后 `git status` 无 `D`）后重跑 `pnpm run build`，
  **仍然红在同一个位置**：`[standalone] ✓ 2506 / [static] ✓ 12149` 两层都数得干净，
  随后 `[executor-host-smoke] externals ok (3 recorded, 314 bundled inputs, 1490 KB)` →
  `packaged host exited 1 … Cannot find package 'promise-limit' imported from …/lib-esm/ws.js`，`BUILD_EXIT=1`。
  ⇒ **「上一轮留下的脏产物」这个候选被排掉**。
- 过程中还排掉一个我自己的操作错误：第一次「后台构建」压根没跑（我把命令写成 `(( … ))`，被 bash
  当算术展开吃了，日志文件根本没生成）。那条不能算任何结论，已换成不加套的写法重跑才是上面这个数。
- 顺带查清「谁的 dev server」：这台机器上唯一在跑的 next server 属于**另一份检出**
  `F:\AI\Other\comfy-app-t3-branch3`（pid 274212），本检出没有 dev server（`run.json` 的 `pids` 是空的）。
  所以本节的复现与那份检出无关，也没去动它。

**还差最后一步才能定性（本审查未做）**：在**干净的上游提交快照**里跑同一条判据
（`node scripts/base-check.mjs`），才能把「本机链接层」与「#1777 改了 import 图」这两个候选彻底分开。
它需要在那份快照里重跑一次全量 build（很重，且 base-check 的快照链的是本检出的 `node_modules`，
有可能直接给 `inconclusive`），所以按口径交给这条线的人处置，别拿本节的复现当「master 红了」的结论。

**这个候选已经被当晚的实验否证（原话留在下面是为了记账「怎么错的」）**：本检出的 `node_modules` 在 18:33 前后
进入过**半态** —— `node_modules/.bin` 与 `node_modules/.modules.yaml` 整层不见了，
根级符号链接仍在但目标缺失（`node_modules/typescript` → `.pnpm/@typescript+typescript6@6.0.2/node_modules/@typescript/typescript6`，
实测该目标目录 `No such file or directory`，于是门禁直接 `Cannot find module 'typescript'`）。
这与 R8-01 的形状看着是**同一个**（链接在场、`stat` 失败），所以我当时把它排到最前面。
20:12 做的实验否证了它：`pnpm install --frozen-lockfile` 跑绿（18:52）之后，
`next build` 从零重建（`✓ Compiled successfully in 112s`）→ 冒烟**仍在同一格红**
（`Cannot find package 'promise-limit' imported from …\.next\standalone\node_modules\.pnpm\@libsql+client@0.18.0\...\lib-esm\ws.js`）。
⇒ 「坏依赖树被拷进产物」这条**不成立**；剩下的候选还是那两条（本机 payload 链接层 / #1777 改了 import 图）。

**否证过程中把机制量得更细了一层**（这一段是本节现在真正的结论）：
冒烟红的时候，那条缺失的包**并不缺** —— 链接与目标都在场，且目标是可 `stat` 的：

```
client 的 node_modules/promise-limit 链接: symlink  stat ERR EPERM
  link = ..\..\promise-limit@2.7.0\node_modules\promise-limit
  解析出的绝对路径: …\.next\standalone\node_modules\.pnpm\promise-limit@2.7.0\node_modules\promise-limit  [可 stat]
promise-limit 目标目录: dir stat=dir      ← 目标本身完全正常
core 目标目录:          dir stat=dir
开发树同类链接:         OK dir             ← 同一个 Node 走开发树的链接没事
```

也就是说：**沿着 payload 里的符号链接走 = EPERM，直接指到同一个目标 = 没事**。
所以 R8-01 不是「产物缺件」（`check-standalone-contents.cjs` 数得干净是**对的**），
也不是「包没装」，而是**这份被拷出来的 `.pnpm` 链接层不可被本机 Node 跟随**。
两件事因此被连起来：① `build-desktop.mjs` 的 §载荷实体化（上提 + 删 `.pnpm`）存在的理由正是「链接语义搬不过去」，
而 `smoke-executor-host-standalone` 跑在**实体化之前**的 payload 上 ⇒ 它测的恰好是这个已知不成立的形状；
② 「数得干净」与「跑得起来」之间那一格落差（本报告初稿就写了这句），现在有了具体的落点：
**冒烟这一步在本机对「链接可跟随性」敏感，而对出厂件（实体化之后）不敏感。**

**没量到的一层（别当成已解释）**：链接类型本身（Windows 的 symlink 与 junction 之别）没测出来 ——
`fsutil reparsepoint query` 与 `dir /a L` 在 Git Bash 这一侧都拿不到输出（编码 / 权限），
所以「为什么开发树的链接能走、`next build` 拷出来的不能走」还差这一格。它决定修法站在哪一边：
类型不同 ⇒ 该修拷贝（让产物用可跟随的形状）；类型相同而只是跟随权限差异 ⇒ 该修冒烟（跑在实体化之后）。

**顺带订正一处推理**：我曾把「这台机器上有 dev server 在跑」当成暂缓修依赖的理由。那条**不成立** ——
硬规则 9 说的是**本检出**的 dev server 会锁住本检出的原生 `.node`；别的检出里的 server 链的是自己的
`node_modules`，与本目录的安装没有因果关系。核对本检出有没有人占用的正确做法是看进程命令行归属，
实测那批 `node.exe` 全在 `comfy-app-t3-branch3` / `branch4` 两个目录里。

**对 R5-01 的直接后果**：`artifact` 档要求 `pnpm run build` 跑绿才认这笔改动，所以 R5-01 的提交停在
stash 里等账绿 —— 这是 §11.8 那本账在起作用，不是绕过去的理由。

### R8-02（P2，正面对照）新鲜度账这次是站在我对面的

- 事实：我给 `scripts/build-desktop.mjs` 加那一步之后，`pre-commit` 的「每档都有主」把这 **笔提交拦下**了（`产物级护栏（artifact）今天的提交动过这一档的输入面…而它还没有自证`，退出 1）。同一档在改动前报「今天」，改动后就要求重跑 —— 因为 `dirty` 输入面与 `verifiedAt` 比的是「早于当天的第一次改动」。
- 这条记进台账有两个用途：① `§11.8` 那本账**确实有牙**，不是摆设（R2-01 的「补偿型元判据」里这一格是有效的）；② 也因此「先跑一轮 `pnpm run build` 记账再说」绕不过去 —— 修 R8-01 是 R5-01 落地的前置条件，这个顺序本身就是判据在起作用的证据。

### R9-01（P2）规范正文里还留着 12 处「pre-commit 与 CI」——承诺了一个不存在的执行者

**先记一处我自己的错**：本节初稿写的是「19 处」。那个数**不成立** —— 它来自宽松正则，把
`CI 门禁` / `接入 CI` 这类词形，以及 `docs/standards/13` §13.5 里**正当在讨论「CI 已随 #623 删除」**
的小节标题一起算了进去。我要判的是「有多少地方**承诺了一个不存在的执行者**」这个语义问题，
却拿词形正则去代理它，而正则对「批评这种承诺」和「记录它曾经存在」两类都不回绝。
**这类计数下次必须先取候选行、再逐行分档（现在时承诺 / 元叙述 / 历史记录），并把剔除了哪几条写在结论里。**

**订正后的数（逐条分类）**：`grep -rn "与 CI" README.md docs/standards/*.md` 排除
`docs/generated/`（那 30 份是渲染副本，数进去等于同一句话计两遍）得 **13 行**；
其中 `docs/standards/12:240` 是**元叙述** —— 它写的正是「脚本头部自称供
`.githooks/pre-commit` 与 CI 调用」这件事曾经骗过人、而 CI 已随 #623 删除 —— 剔掉，
余下 **12 处现在时声称**：

| #   | 文件                                                                                   | 检索式（拿去 grep 的那半句）                                                  | 承诺的执行者                             |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | `README.md`                                                                            | `check-ps1-consistency.mjs` 在 pre-commit 与 CI                               | 两张入口表的核对                         |
| 2   | `docs/standards/03-样式与-tailwind.md`                                                 | `scripts/check-inline-style.cjs`（pre-commit 与 CI）                          | 写死内联样式判据                         |
| 3   | `docs/standards/03-样式与-tailwind.md`                                                 | 已接入 `.githooks/pre-commit` 与 CI                                           | `check-theme-colors.cjs` 的写死色值棘轮  |
| 4   | `docs/standards/12-代码组织与文件结构.md`                                              | `tests/check-import-alias.test.ts`；已接入 pre-commit 与 CI                   | import 别名判据                          |
| 5   | 同上                                                                                   | 由 `scripts/check-code-duplication.cjs` 在 pre-commit 与 CI 强制              | 孪生对棘轮                               |
| 6   | 同上（§12.13 末句）                                                                    | 在 pre-commit 与 CI 强制。                                                    | `check-function-length.cjs` 函数长度棘轮 |
| 7   | 同上                                                                                   | 在 pre-commit 与 CI 强制，基线 `scripts/.dead-exports-baseline.json`          | 零消费导出棘轮                           |

> 第 3 / 5 / 6 / 7 行记的是**审查当日**的编号与「棘轮」字样，今天都变了
> （ISSUE #1811 收尾）：`check-theme-colors` → 硬闸、`check-code-duplication` → 硬闸、
> `check-function-length` → 硬闸、`check-dead-exports` → 硬闸（**基线已删，
> 第 7 行点名的 `scripts/.dead-exports-baseline.json` 已不存在**）。
> 本表要记的是「这几处文档**声称有执行者**」这件事本身（那才是 R9-01 的靶子），
> 与判据是棘轮还是硬闸无关 —— 但按上面的规矩，说法与事实不符就得当场写明，
> 否则下一个人 grep 那份基线会 grep 到空。
| 8   | `docs/standards/18-lib层规范.md`                                                       | `tests/lib-node-only-declarations.test.ts`，接入 pre-commit 与 CI             | Node-only 声明判据                       |
| 9   | `docs/standards/Comfy-APP-T3-项目开发规范.md`                                          | 全库推进计划与棘轮护栏（已接入 pre-commit 与 CI）                             | 17 章那批棘轮                            |
| 10  | `docs/standards/launch-and-build.md`（§5 排障表「配置了 ComfyUI 端口却像没配」那一行） | `check-comfyui-port-contract.cjs`                                             | 端口契约判据                             |
| 11  | 同上                                                                                   | `scripts/check-comfyui-port-contract.cjs`（pre-commit 与 CI）把这条变成可失败 | 同上                                     |
| 12  | 同上                                                                                   | **门禁**：`scripts/check-ps1-consistency.mjs`（pre-commit 与 CI               | 入口清单三向对齐                         |

**为什么这一版把行号换成了检索式**：初稿那 12 个行号里，`docs/standards/12` 的三条（原 `:981 / :1074 / :1358`）
与 `launch-and-build.md` 的两条（原 `:2649 / :2778`）在本次审查收尾时已经**因为我自己合并的 #1791 / #1783 而漂移**
（前者 +10 行、后者 +1 行）。这件事正落在本节要修的病上：一份「带日期的审查台账」里最脆的东西，
就是它引用别人正在改的文件时用的绝对行号 —— 台账不入库核对（`doc:check` 的 `SCOPED_DOC_DIRS` 不含 `docs/audits/`），
所以漂移时没有任何判据会红，而下一个人按行号去读会读到别的内容。留检索式而不是行号，
代价是要多打一次 grep，换来的是这条记录不会因为一次无关的合并而变成假信息。

**为什么这条值得单独一行而不是一次 sed**：`AGENTS.md` 硬规则 6 与 §13.5.3 写的是**相反**的事实
（「目前不再有 CI 兜底」「本仓库用不起平台侧流水线」），而且那一格还有判据守着
（`tests/no-platform-ci-config.test.ts` 禁止平台侧配置文件入库）。也就是说**规范正文与判据在说两件
相反的事，而两者都不会红**：读正文的人（或代理）会以为存在第二道闸，从而把自己的那次提交当成
「已经有人兜过了」。修法不是换词，是**逐条判断那句话当初想说什么**：
有的该改成「只在 pre-commit」，有的该保留历史语气并写明「当时还有 CI（现已删）」。

### R9-02（P2）`docs/workshop-mcp.md` 的工具计数与代码不符

`docs/workshop-mcp.md:56` 写「工具清单（15 个）」，`src/server/mcp/workshop-mcp.ts` 里去重后的
`workshop_*` 名实测 **17** 条。与 R9-01 同一族：`doc:check` 核的是端口 / 路径 / 值这类**事实锚**，
「条目计数」与「执行者是否在场」不在它的判据形状里，所以这类过期不会让任何东西变红。

### R10-01（P1）三本新鲜度账是**入库文件**：一次豁免会被别的检出继承成「今天已自证」

**证据（今天在这一台机器上连测到两次，第一次的解读我还写错过一次）**

- `git ls-files` 确认三本账都提交进库：`scripts/.artifact-freshness.json`、`scripts/.e2e-freshness.json`、
  `scripts/.full-suite-freshness.json`（单槽位、一档一笔）。
- 中午我跑 `node scripts/freshness-gate.mjs`：**e2e 档红**（`上一次跑绿在 2026-10-11T07:06Z，不是今天`）。
- 之后我 `git fetch` + 快进到 `9d502aaa`（拉进来的是别人的合并，含 `6bdc116c`），**同一条判据立刻报三档全绿**，
  而我这边一个 e2e 都没跑。翻开账本看原因：
  ```
  "e2e": { "verifiedAt": "2026-10-12T03:54:48.347Z", "who": "yuedu", "how": "pnpm test:e2e",
           "skippedReason": "本次提交只改 AGENTS.md 与 project Skill 两处文档、
                            并把 .workbuddy/memory 移出 git 索引，未触碰任何运行时代码与 e2e 链路" }
  ```
  ⇒ 那句「e2e：今天」的来源是**一条为纯文档提交写的豁免**，而且是**另一笔提交、另一棵工作树**记的账。
- 这不是新病：`b53c7b0a`（ISSUE #1727）的标题就是「账上那条豁免换成实跑凭证 —— **合并时被误留的
  skippedReason**」。同一个机制一个月内第二次咬人，说明它是**结构性的**，不是谁手滑。

**订正我自己在初稿里的一句推断**：初稿写「artifact 那本账是另一份检出记下的凭证」——这条**没证**，
账本里没有「哪棵树」这一格，我没法这么说。成立的是更朴素的那句：**账本记 `who` / `how` / `verifiedAt`，
唯独记不下「在哪儿跑的」**，所以任何检出 pull 之后都会把别人那一条读成自己今天的绿。

**要紧在哪**：`§11.8` 这本账的设计意图是「每一档都有人**实跑过**」。对 e2e / 全量单测，跨检出继承尚可讨论
（代码同源，跑绿那次至少验的是同一份源码）；对 **artifact 档**不成立——它承诺的是「**这份**产物链
build + 数产物跑绿」，而产物是本地文件树 + 本地 `node_modules` 状态造出来的。本次审查就是活例：
我这台检出的 `pnpm run build` 从零重建后仍红在冒烟（R8-01），而 `freshness-gate` 在我 pull 之后
照样判我 artifact「今天」通过——**它引用的绿不是这棵树跑出来的**。

**也别读成「判据写错了」**：单槽位 + 入库共享是刻意的省事形态（账要能被 review 看见、要能跨会话交接），
而且它确实拦住过我（我改 `build-desktop.mjs` 那笔被它挡下，见 R8-02）。要补的只有语义那一格。
**而且本仓库已经有过正确答案**：#1793 给 push 那一跳写的证明刻意**不入库**（`.git/comfy-premerge-proof.json`），
理由就写着「同仓并行检出不许互相作证」（§13.6.2.1）。同一句话反过来读就是本条：既然**合并证明**不能跨检出继承，
那**每天那三档实跑凭证**凭什么可以。

**建议的修法（口径级，本笔不实施）**

1. 每条记录加一格**检出标识**（`git rev-parse --show-toplevel` 的哈希即可），判据读账时要求
   「今天 **且** 同一检出」才算绿；`--skip` / `--dirty` 的豁免同样带这一格。
2. 顺带一条更便宜的：**豁免不许跨提交存活**——`skippedReason` 只在「记它的那笔提交」有效，
   下一笔提交遇到同一档时必须重新表态（`b53c7b0a` 那次和今天这次都是栽在「豁免被合并带远」）。
   这条不需要新字段，改动面比 ① 小，先做它也够用。

**验收**：造一个反例——检出 A 跑绿并记账、A 为纯文档提交写一条豁免；在检出 B 立刻问 `freshness-gate`：
按 ① 必须报「不是这棵树跑的」，按 ② 必须让 A 的那条豁免在 B（或下一笔）失效，而不是当成今天的绿。

### R11-01（P2，就在本笔台账的第三次提交上撞到的）D 组那步「四语言端口一致性」把超时当成内容红报

**实测**：`.githooks/pre-commit` 把这笔**纯文档**提交拦下，报
`[app-port-vectors] 四语言端口推导一致性失败：- Python 侧自检失败：spawnSync python3 ETIMEDOUT`。
同一条判据在钩子结束后**就地复跑退 0**（`node scripts/check-app-port-vectors.cjs` ⇒ `四语言端口推导一致性 OK ✓`）。
⇒ 那不是「四侧推导不一致」，是**没拿到测量**。

**形状**：`scripts/check-app-port-vectors.cjs:119-127` 把 Python 侧真跑包在 `try/catch` 里，
`timeout: 30_000`（`:122`）到点抛的 `ETIMEDOUT` 与「内容不一致」进的是**同一个 `problems` 数组**，
所以那句「四语言端口推导一致性失败」在纯超时时也说得出嘴。同一份文件里 `hasCommand()`（`:34-41`）
更安静：10 秒预算探测 `python3 --version`、把一切异常吞成 `false` ⇒ 负载高时它判成「这台机器没有 Python」，
这一侧**既不参与比对也不报红**（两种失败方向相反，都拿不到结论）。

**为什么单独一行**：本仓库已经承认「拿不到测量 ≠ 测量结果是红的」（§13.6.4.1，ISSUE #1747），
并把「隔离复跑」接到了 **C 组**（vitest 那一步）。但 D 组这批 shell 型判据里的时间预算型条目不在那套里 ——
一次 flake 吃掉的是**整笔提交**（实测：A/B/C 组跑完约 4 分钟后被拦，代价只能整份重付）。
同一格还捎上硬规则 4 要求的「失败路径必须有用户可见出口」：这里那个出口给出的是**错误的原因**。

**修法（口径级，本笔不实施）**：与 C 组同形 —— 超时形态单独报「未校验」并逐条点名；
最省事的第一步是只改 `:124-127` 那个 `catch` 的分类，把 `ETIMEDOUT` 与真不一致拆成两句话术，
`hasCommand()` 那条则区分「这台机器没有 Python」与「Python 没在预算内回答」。

### R12-01（P2）两份判据把远端名写死成 `origin`，而本仓的远端叫 `cnb` ⇒ 同一判据跨检出行为不同

**同一个根因、两种失效方向**，都在本检出当场量到：

| 位置                                              | 写死的东西                                                              | 在本检出的表现                                                                                                                                  | 严重度差别                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `scripts/premerge-proof.mjs` 的 `readRevisions()` | `--verify refs/remotes/origin/master`                                   | `upstreamSha` 恒 `null` → 走「取不到上游引用」那一支 → **退 2 拦下每一次 topic 分支的 push**（`git fetch` 刚跑过、`cnb/master` 就在场上也一样） | 高：一个刚为「别把红带进 `master`」立的执行者，从落地起在这份检出上是**反作用**的      |
| `scripts/check-deps-freshness.mjs`                | `DEFAULT_REMOTE_REV = "origin/master"`，且 reflog 路径里写死 `"origin"` | 跑它退 **0** + `[未校验] 没有可用的远端引用 … 这一行不许被读成「远端就是最新」` ⇒ AGENTS 硬规则 25 的执行者在这份检出里**恒不判**               | 中：降级话术是诚实的（不阻断、也明说没核对过），所以不是假绿 —— 但承诺的能力在这里为空 |

**为什么这算架构级而不是「本机环境麻烦」**：判据的结论应当只依赖仓库里的事实。远端名是**每台克隆机器**
的属性（`git clone` 默认给 `origin`，本仓配成了 `cnb`），于是同一份 `master` 上的同一条判据，在 A 检出绿、
在 B 检出恒不判或恒拦人。这条正好是 R10-01 的镜像面：R10-01 是「入库的凭证被别的检出继承成已自证」（太宽），
本条是「判据读了一个不入库、也不声明的环境输入」（太窄 / 随机）。两句合起来是同一个结论——
**判据的输入要么入库，要么当场可探测，不能假定读者的 git 配置。**

**旁证（说明这不是新认识，是没被贯彻）**：`scripts/base-check.mjs` 里早就为同一件事写了
「remote 名随克隆方式变；本地实测是 `origin`」，并逐档实现「分支上游 / 各 remote 的 `master` / 本地 `master`」。
也就是说仓里**已经有正确答案**，只是新写判据时没去拿 —— 与硬规则 24「写之前先查有没有现成实现」同一条病。

**已处置的一半（#1814）**：`premerge-proof.mjs` 改为复用 `base-check.mjs` 的 `resolveMergeBaseRef()`，
但**只收它 `<remote>/master` 那一档**：第三档「本地 `master`」对 `base-check --base` 是对的（浅检出 / 单机仓库），
对这一跳不对 —— 这里要的是**会被 `git fetch` 移动**的引用；`@{u}` 也不收，推送后它就是你自己的分支，
拿它当上游等于「自己跟自己比」。回归用例三档（远端命名为 `cnb` / `@{u}` 指向自己的分支 / 只有本地 `master`），
其中第一档改前必红。

**未动的一半与它的口径问题**：`check-deps-freshness.mjs` 不能同样一行换掉就完事 —— 它问的是
「远端在依赖面上前进过吗」，所以先得回答**「远端叫什么」这一档该由谁给**：读 `git remote` 逐个试、
还是在 `docs/reference-facts.md` 登记一个权威名、还是让调用方显式传。图省事把所有 remote 都遍历一遍，
会把「未校验」变成「拿任意一个远端的陈旧程度当结论」，那是另一种假绿。

**验收（给未动那一格）**：在本检出跑 `node scripts/check-deps-freshness.mjs` 必须**不再**报
「没有可用的远端引用」，而是报出它实际比对了哪条引用（例如 `cnb/master`）与那条引用自己的取证时间；
再造一个反例：该引用落后于本地分叉点时必须判「远端没动过」，而不是回落到「未校验」。

### R13-01（P2，今晚实测）体积预算没有「漂移当场暴露」的执行者 ⇒ 红落在下一个需要产物账的人身上

**实测两档读数**（同一台机器、同一次 `pnpm build`，工作树相对 `master` 只多了
`scripts/build-desktop.mjs` 的一步与两份 `docs/**` —— 三者都进不了客户端 bundle）：

```
[bundle-budget] 当前：文件数 215 · raw 9545.1 KB · gzip 2226.8 KB
  基线：文件数 215 · raw 9544.0 KB · gzip 2226.4 KB（生成于 2026-10-12）
[bundle-budget] 违规（阻断）：gzip 总量上升：2226.4 KB → 2226.8 KB（+471 B）
```

基线由 `086e16a0`（#1781，**18:12**）生成；这次构建是 **20:12**。也就是说
**#1781 落地不到两小时，`master` 上的 `pnpm build` 就已经是红的了**。

**执行者地图（当场核过，不是推测）**：`check-bundle-budget.cjs` 只在三处被敲 ——
按需召唤 `pnpm check:bundle` / `check:all --mode bundleBudget`（`scripts/.on-demand-duties.json:85-92`）、
以及 `pnpm build` 收尾兜底（`package.json:7`，位于数产物之后、冒烟之前）。
它在 `.githooks/pre-commit` 里**没有**，也在 `scripts/premerge-check.mjs` 的全仓复算名单里**没有**
（两处各自 grep 过）。所以那批让体积涨了的 UI 改动**没有任何一档会当场报红**，
它们合进 `master` 时这道预算是静默的。

**为什么这件事值得单独一行**：后果不是「+471 B 要解释」，而是**它把产物日账那一档锁住了**。
`pnpm build` 是 `artifact` 档唯一的凭证来源（`scripts/artifact-run.mjs` 的语义是「绿了才记」，
这次它照实说了 `✗ 产物级护栏未通过（退出码 1）—— 不记账`）。于是接下来**任何**碰
`build-desktop.mjs` / `tauri.conf.json` / `next.config.js` 的改动，都会被 freshness 判据要求
「这一档今天还没自证」，而它**无论重跑多少次都跑不绿** —— 除非有人先替那批 UI 改动做一次体积确认。
本报告的 R5-01 正是被这一格 + R8-01 一起停住的（顺序：预算这道红在冒烟之前，所以它先响）。

这条与 R2-01 / R10-01 同族而形状不同：那道病是「判据没有执行者」，这条是
**「预算型判据（只许降）与新鲜度日账（每天要有绿凭证）两个机制没有联动」** ——
判据自己有执行者（`pnpm build`），只是那个执行者恰好又是别人取凭证的唯一入口，
于是「一次没人看的漂移」变成了「下一个人的阻塞」。

**我核到哪一步、没核到哪一步**：`+471 B` 归给谁**没有做成实验** —— 那要两次全量构建做 A/B。
文件级论据是：本笔工作树改的是 `scripts/build-desktop.mjs` + `docs/**`（装配与规范文本，不参与客户端打包），
而基线之后落地的 `aee843b5`（顶栏问号位置）与 `50c1845f`（模型库骨架屏）动的正是 `src/**` 视图层。
这句按「论据」记，不按「结论」用。

**修法（口径级，本笔不实施；三选一或组合，需要这条线的人拍）**：

1. 把 `check-bundle-budget.cjs` 纳进 `premerge-check` 的全仓复算名单 —— 让「体积涨了」在**造成它的那条 PR**
   的 push 上就报红，而不是在下一个需要产物账的人身上。代价：它读 `.next/static`，而复算跑在干净快照里
   **没有构建产物** ⇒ 需要先回答「快照里没产物时这一档算不算数」（答案不能是「静默绿」）。
2. 把这道预算并入 `artifact` 档的 `dirty` 输入面 —— 谁动体积相关面谁当天就得跑一次 build，
   与「改产物链要重新数一遍」同口径。
3. 就地做一次确认：`+471 B` 换骨架屏与顶栏改动值不值，值就按判据自己给的出口
   `--allow-increase` 重跑 `--update`（并把两档读数贴在 PR 里）。**本笔没有这么做** ——
   那批增长不是我造成的，由我需要凭证就去替它确认体积，等于让阻塞的人给自己开后门。

**验收**：造一个反例 —— 一条只改 `src/**` 视图、让 gzip 上涨的 PR，在它自己的 push 上必须看到体积报红
（而不是等到下一个跑 `pnpm build` 的人）。

## 本次审查确认的强项（不是套话，是防止优化方向跑偏的基线）

- `src` 侧 7 项结构棘轮全为 0，且 `check-gate-executors.cjs` 实跑绿（65 判定型有执行者）——产品代码这一层没有「写着没人跑」的门禁。
- 产物层是**默认拒绝**白名单（顶层两闸 + 递归按形状减法 + 不穿符号链接），且 `tests/dist-artifact-hygiene.test.ts` 真 `require` 判据导出面，不是解析文本。
- 端口/地址有唯一出处（`src/lib/endpoints.ts`），且 `check-app-port-vectors.cjs` + `doc-facts.cjs` 跨语言核对数值。
- 失败路径规范（硬规则 4）+ 文档即判据（`doc:check` 核对生成物与权威源），治理密度在同规模仓库里属罕见。

## 未验证 / 假设

| 项                                  | 说明                                                                                                                                                                                                     | 下一步取证方式                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP 入口的实际使用频率              | 若外部客户端接入是主推路径，R1-01 的可能性上调                                                                                                                                                           | 看用户文档入口与 `docs/workshop-mcp.md` 的定位；问业主                                                                                         |
| 提交钩子的实测耗时                  | 影响 R2-01 的分档方案                                                                                                                                                                                    | 从 `LOGD` 的分步日志聚合一次                                                                                                                   |
| 本地单用户下 better-auth 的实际作用 | 存在 `login/page.tsx` + `authedProcedure` + 4 张认证表，桌面场景下的信任模型值得单独写清                                                                                                                 | 读 `src/server/api/trpc.ts:180-220` 的兜底开关语义并确认默认档位                                                                               |
| 两编译器诊断差集                    | R6-01                                                                                                                                                                                                    | 一次全量双跑对比                                                                                                                               |
| 本报告自身的门禁影响                | 入库时已跑：`doc:check`、`check-file-structure --strict`、`check-format`、pre-commit 全四组（每笔提交各一遍）。**不吃**这一档的：`docs/generated/**`（`docs/audits/*` 不在渲染源清单里）、e2e 与产物两档 | 无待办。真待办是另一格：`docs/audits/**` 不在 `doc:check` 的核对面里，所以这份台账自己的引用漂移没有判据会红（本笔的第二条提交就是在补这件事）。**2026-10-13 复审确认这一格是真的**：ISSUE #1811 收尾翻闸后，本文件里那张「现状数字」表的最后两行与「判据覆盖 ⇄ 证据」表的第 3 / 5 / 6 / 7 行**已整体过期**（8 份基线文件一份都不在、4 条判据早已升硬闸），而没有任何判据会红 —— 两处已就地改写并加注记 |

## 建议的动手顺序

1. ~~R1-01 + R1-02~~ —— 已做（#1783：回环绑定 + origin 白名单，用例 `tests/mcp-http-entry-loopback.test.ts` 进固定清单）。
2. R2-01 剩两格（**已推进一格**：#1793 给 push 那一跳补了「干净上游快照复算 + 按归属决定拦不拦」）：
   `check:premerge` 不替代 `check:all`（全量单测 + 覆盖率 + 依赖审计那一档仍无人敲），以及 push 仍是本地事件。
   这一格是**决策**不是代码，要业主拍口径；「恢复平台 CI」会被 `tests/no-platform-ci-config.test.ts` 当场拦下，别往那个方向走。
3. ~~R3-01 与 R4-01~~ —— 已做（#1791 / #1787）。
4. R5-01 代码与投毒验收都做完了，**只差产物日账那一格**：前置是本检出 `pnpm run build` 跑绿，而它现在红在冒烟（R8-01）。
   ⚠️ 别照本条初稿的说法去找「记在 infra 基线 1576 行上的 `build-desktop.mjs`」——那份实测 495 行，
   1576 那一格是 `dev-launcher.mjs`；infra 棘轮管不到这笔改动（见结论摘要里的订正）。
5. R8-01 按它自己那节的顺序走：先在**健康依赖树**上重跑一次 `pnpm run build`（依赖已于今天装回，这是最便宜的一步），
   仍红才去做上游快照对比。
6. R11-01 是这份清单里**改动面最小的一条**（一个 `catch` 里的分类），而它每次咬人吃掉的是整笔提交的四组门禁 —— 排在最前面做也不为过。
7. R12-01 剩一半：`premerge-proof.mjs` 那格已由 #1814 修掉（它当时的形态是「挡住本检出每一次 topic push」），
   `check-deps-freshness.mjs` 那格未动，动之前要先拍「远端叫什么由谁给」的口径（见该条的验收段）。
8. R13-01 与 R11-01 是同一族里**最便宜的两条**（各自只是分类/接线），但 R13-01 需要先拍一个口径：
   体积漂移该在**造成它的 PR** 上红（并入复算名单，但要回答「干净快照里没有构建产物算不算数」），
   还是并入 `artifact` 档的输入面，还是由这条线现在做一次「+471 B 可接受」的确认去追基线。
   在它拍之前，`master` 上每一次 `pnpm build` 都是红的，而那是产物账的唯一通道。
9. R6-01 / R7-01 待取证后再排；R9-01 / R9-02 / R10-01 属「话术与账本形状」，可并行、风险低。

## 阅读顺序与再生成

- 先读本文件的「结论摘要」与发现清单表；需要图时读同目录 `2026-10-12-architecture-risk-map.dot`（Graphviz，`rankdir=TB`）。
- 再生成：审查基线为 `master` @ `b4705c3d`；所有 file:line 引用按该修订号成立，后续代码搬迁会让行号漂移，重跑时以「证据」小节的检索式为准（例如 `grep -rn "Access-Control-Allow-Origin" src tools`、`grep -n SCAN_DIR scripts/check-*.cjs`）。
