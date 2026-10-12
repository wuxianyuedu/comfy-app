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

**处置状态（本轮之后）**：R1-01 / R1-02 已合并进 `master`（PR #1783，squash）；R4-01 已合并（PR #1787）；**R3-01 已合并（PR #1791）**——新增 `scripts/check-infra-file-size.cjs` + `.infra-file-size-baseline.json`，存量按实测入档（**订正**：本报告初稿记的 6 份含 `affected-tests.mjs`，该文件随后被拆分——固定清单外移成 `scripts/fixed-structural-tests.mjs`，其本体回落到 487 行、退出基线，基线现为 5 份），登记面（`D(55→56)`、§13.1 逐字行、`docs/standards/12` 的 R5 姊妹档一节、`RATCHETS` 沙箱行、`docs/generated/**`）同批改齐，并且新判据在它自己那笔提交的钩子里就跑到了（`[ok] ── check: 基础设施层文件长度棘轮…`）。R5-01 已实施但**被自己的日账正当拦下**，改动停在分支 `fix/desktop-payload-count-after-assembly`（未提交），前置是 `pnpm run build` 跑绿，而那又落在 R8-01 上。R2-01 不动（决策已由 `tests/no-platform-ci-config.test.ts` 守着）。

**审查中新撞出来的最要紧一条是 R8-01**：`pnpm build` 在今天合并后的 `master` 上红在最后一步冒烟，而 `R2-01` 描述的正是「这种红为什么能进来」。

1. **P0｜Workshop MCP HTTP 入口在局域网与任意网页面前可达**（无鉴权 + 通配 CORS + 未固定监听地址），而这组工具能改库、删会话、发起出图/出视频。—— **已修**。
2. **P0（决策已定且有判据，代价可量化）｜整层机器门禁只有一个执行者：开发者本机的 `git commit`**。
3. **P1｜债务门禁全部只扫 `src`，而判据自身（`scripts/**` 43k 行）在它自己的硬闸之外**：6 个文件超过 R5 给产品代码定的 900 行上限，最大一份是判据本身（`affected-tests.mjs` 随后被拆分出固定清单，现为 5 份）。—— **已修**（PR #1791）。
4. **P1｜覆盖率配置缺一条「每一项都要落到真实文件」的判据**（初稿的「40 条静默失效」被实测否证，订正为 3 条指向已删模块）。—— **已修**。
5. **P1｜出厂载荷（`src-tauri/static`）的数产物判据不在出厂链路上**。—— 代码与规范已写好，停在「等 `pnpm run build` 跑绿」这一格上（前置就是 R8-01）。
6. **P1（新增，本报告初稿曾误判为 P0/master 红，已订正）｜payload 的 `node_modules/.pnpm` 链接层对本机原生 Node 不可跟随（`stat` = `EPERM`）**：冒烟因此报「找不到 `promise-limit`」，而包其实在场。它同时暴露了「数得干净」与「跑得起来」之间的一格落差 —— 见 R8-01。

## 现状数字（审查当日实测）

| 维度                      | 数值                                                                            | 出处                                                       |
| ------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 产品代码（`src` 非测试）  | 184,855 行                                                                      | `find src … -not -name '*.test.*'`                         |
| 门禁/工具层（`scripts` 顶层） | 43,142 行 / 118 份 `.mjs`+`.cjs`                                            | `find scripts -maxdepth 1`                                 |
| 测试                      | 58,100 行 / 705 份用例（另有 19 份 Playwright 规格）                            | `find tests src e2e`                                       |
| 文档（`.md`）             | 57,969 行 / 82 份                                                              | `find docs -name '*.md'`                                   |
| 判据脚本                  | 68 份：判定型有执行者 65、按需召唤 2、报告型自称在跑 0                          | `node scripts/check-gate-executors.cjs`（本次实跑，退 0）  |
| `src` 侧棘轮存量          | 文件长度 0 / 函数长度 0 / Rust 函数长度 0 / 孪生对 0 / UI-逻辑分离 0 / 循环依赖 0 / 零消费导出 0 | `scripts/.<name>-baseline.json`                   |
| 仍带存量的棘轮            | 非空断言 167 处                                                                 | `scripts/.non-null-assertions-baseline.json`               |

**读法**：产品代码的结构性债务已被清零，因此「优化」的着力点不在业务代码内部，而在**判据覆盖不到的三处边界**（网络入口、合并点、判据自身）与**手改清单的同步面**。

## 发现清单

| ID    | 严重度 | 可能性 | 影响的架构属性        | 置信度 | 状态               |
| ----- | ------ | ------ | --------------------- | ------ | ------------------ |
| R1-01 | P0     | 中     | 安全 / 数据完整性 / 成本 | 高   | 已确认（代码 + 运行时） |
| R1-02 | P1     | 高     | 可维护性 / 可移植性   | 高     | 已确认（代码 + 全仓检索） |
| R2-01 | P0     | 高     | 交付质量 / 一致性     | 高     | 已确认（历史 + 现状），属有意取舍 |
| R3-01 | P1     | 中     | 可维护性 / 自证性     | 高     | 已确认（判据源码作用域） |
| R4-01 | P1     | 中     | 可测试性 / 静默失效   | 高     | 已确认（配置注释记录了既往现场） |
| R5-01 | P1     | 中     | 分发正确性 / 隐私     | 中-高  | 已确认链路顺序，缺一次实证复现 |
| R6-01 | P2     | 低     | 工具链一致性          | 低     | 待验证（未实测分叉） |
| R7-01 | P2     | 中     | 运行时可诊断性        | 中     | 记录为已知风险，非新发现 |
| R8-01 | P1     | 高     | 交付正确性 / 可发布性 | 高（机制已测到底） | 成因定位到本机 payload 链接层；是否兼有代码侧成因待一次干净重建来 disambiguate |
| R10-01 | **P1**  | 高     | 治理自证性 / 多检出一致性 | 高     | 已确认（今天在这一台机器上实测到两次，含一次我自己读错） |
| R9-01 | P2     | 高     | 治理自证性 / 代理可靠性 | 高     | 已确认（12 处逐条列过；我初稿的 19 已订正） |
| R9-02 | P2     | 高     | 文档准确性              | 高     | 已确认（15 对 17，两数当场数过） |
| R8-02 | P2     | 中     | 治理自证性            | 高     | 已确认（且这次它站在我对面挡住了我） |

---

### R1-01（P0）Workshop MCP HTTP 入口可达面超出本机回环

**证据**

- `tools/workshop-mcp-http.ts:15-18` — 对每个请求无条件设 `Access-Control-Allow-Origin: *`，并在 `OPTIONS` 上放行 `Content-Type`、`Accept`、`MCP-Protocol-Version`。
- `tools/workshop-mcp-http.ts:25` — `POST /mcp` 分支之前**没有任何鉴权、令牌、来源校验**。
- `tools/workshop-mcp-http.ts:52` — `httpServer.listen(PORT, cb)` 未传 host。本机实测 `require('net').createServer().listen(0)` 得到 `{"address":"::","family":"IPv6"}`，即绑定所有接口（Windows 双栈下同形暴露 IPv4）。
- `src/server/mcp/workshop-mcp.ts:95-395` — 该入口暴露的工具含 `setScript` / `setCharacters` / `setStoryboard`（整幅覆盖草稿）、`deleteSession`、`generateImage` / `submitVideo` / `composeFinal`（消耗算力与第三方额度）。写操作只要一个 `sessionId`，而 `workshop_create_session` / `workshop_list_sessions` 就在同一未鉴权入口上。
- `vitest.config.ts:267-270` 的注释本仓库自己的定性：这一层是「外部 AI 客户端可写的入口」。
- 反向证据（说明不是已识别项）：全仓检索 `Access-Control-Allow-Origin` 只命中 ComfyUI 内嵌探测逻辑；`scripts/doc-facts.cjs:164-167` 与 `scripts/check-app-port-vectors.cjs` 只核对端口**数值**，没有任何判据核对**绑定范围**；`docs/workshop-mcp.md` 写的是 `http://localhost:<mcp 端口>/mcp` —— 文档描述的是回环，代码执行的是全网卡。

**为什么是架构级**：这是产品唯一的「机器可写入口」，其信任边界（谁能改库、谁能花用户的钱）由一个 `listen()` 参数和一个响应头决定，且这一格落在现有 68 份判据的作用域之外。它同时违反仓库自己的硬规则 20（回环主机一律显式 `127.0.0.1`，`src/lib/endpoints.ts:22` 有唯一常量出处）。

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

1. 把 `pnpm check:all` 接进 `pre-push`——`.githooks/pre-push` 目前只有 19 行，且它是**本地钩子**、不违反上面那条决策（该判据只拦「平台一读就无条件跑」的配置文件形态）。
2. 或维持「本地纪律」但让它可记账：合并前必跑 `check:premerge` + `check:all`，证据落 `log/`，并由现有 `freshness-gate.mjs` 那类「每档都有主」的台账管这一格。
3. 无论选哪条，先量化一次钩子耗时（分步日志已落 `LOGD`），据此决定哪些档留在提交钩子、哪些移到推送前那一档——重档挂在 `commit` 上是负载假红的直接来源（`§13.6.4`）。

**验收**：能指出「一次变更在进入 `master` 前，由哪条命令、在哪个隔离环境里跑完这 68 份判据」并当场复现一次；`base-check.mjs` 的 `baseline-red` 出现频率下降（它是这条风险的直接症状）。

---

### R3-01（P1）债务门禁只扫 `src`，判据自身在其硬闸之外

**证据**

- 作用域：`check-file-structure.cjs:13` 对 R5 的定义即「**src/** 下超 900 行的文件」，根目录参数只有 `"src"`；`check-function-length.cjs:42` `SCAN_DIR = "src"`；`check-non-null-assertions.cjs:45` 同；`check-code-duplication.cjs:18,48` 只收 `src/**` 的 `.ts/.tsx`。
- 后果（实测，审查当日）：`scripts/` 顶层有 6 份文件超过 R5 给产品代码定的 900 行硬闸——`check-ui-primitives.cjs` 4,819、`dev-launcher.mjs` 1,575、`base-check.mjs` 1,381、`check-file-structure.cjs` 1,213、`check-theme-colors.cjs` 991、`affected-tests.mjs` 931。其中「判据自己违反自己的阈值」是最刺眼的一格。**订正（入库当日）**：其中 `affected-tests.mjs` 已把 `FIXED_STRUCTURAL_TESTS` 字面量外移成 `scripts/fixed-structural-tests.mjs`，本体 487 行、退出该档，基线因此为 **5 份**；这也是该判据上线后第一次响，响的是 #1777 往固定清单加注释把 931 顶过基线——处置是拆文件，不是抬基线。
- 非技术可行性问题：`check-comment-language.cjs:82` 的 `SCAN_DIRS = ["src","scripts","tests","e2e"]` 证明扩面做过。
- 维度缺口：`.cjs/.mjs/.ps1` 上的孪生对、超长函数、非空断言没有任何判据（`tools/**` 共 39 份 `.ps1`）。Rust 侧有独立 120 行阈值（`check-rust-function-length.cjs`），说明「按语言分档」的先例存在。

**修复**：给上述四份门禁加 `--root <dir>`（默认保持 `src`，行为不变），再为 `scripts/`、`tools/`、`tests/` 建**独立基线文件**并按实测值起档（棘轮只许降）。起步建议：阈值先取「当前最大值不升」，不追求一次清零；`.ps1` 的函数/长度维度可先只做长度棘轮。

**验收**：`--strict` 下新增超长门禁脚本即红；基线数字进入现有台账（`check-gate-executors.cjs` 已能证明它有执行者）。

---

### R4-01（P1）覆盖率配置缺一条「每一项都要落到真实文件」的判据

**订正（本报告初稿在这一条上给了错的结论，此处按实测改写）**：初稿推测「约 40 条 `thresholds` 条目不在 `coverage.include` 里，因此静默失效」。实跑否证了它：拿 `coverage/coverage-summary.json`（2026-10-10 那次，380 个文件）逐条比，**全部 380 个都能被 `include` 里的某一条命中**，且那 40 条里绝大多数确实出现在报告里。原因是 `include` 的语义是「额外把没被 import 的文件也拉进报告」，不是「只报告这些文件」——被用例真实 import 到的文件本来就在报告里。所以「`include` 由 `thresholds` 派生」这个初稿建议**不成立**：那样会把 `include` 里 180 个「零门槛但要在报告里」的条目丢掉，反而是收紧了判定面。

**真实存在的缺口是另一格**：153 条 `thresholds` 键里有 3 条在报告里查无对应文件，其中 2 条指向**已被删除的模块**——

- `vitest.config.ts:683` → `src/lib/comfyui/executor-scheduler.ts`（随 `90c627e3` 「两条派发循环收成一条 pull」删除）
- `vitest.config.ts:554`（`include`）与 `:1861`（`thresholds`）→ `src/server/api/routers/train.ts`（随 `a80d13ff` 「废弃炼丹功能」删除）
- `src/components/ui/select-chip.tsx`（文件在、也有同名用例）在报告里缺席，成因未查——它同时出现在 `include:389` 与 `thresholds:1552`，形状上是对的，所以更可能是那次运行的采样差异，不当结论用。

这两条本身无害（指向不存在的文件 = 不判），但它们说明**「coverage 配置里的键必须还能落到真实文件」这件事没有任何判据**：删模块的人清了路由、清了 `src/**`，没有清 `vitest.config.ts`，而 68 份判据里没有任何一份会因为「配置指向已删文件」变红。同族的既有先例是 `tests/rest-endpoint-targets.test.ts`（「客户端写的 REST 地址必须有落点」，台账 E3‴）——同一类「写得很像真的、其实查无此物」，只是那一格在 `src/**`、这一格在配置文件里。

**修复**：加一份全库级不变量用例（登记进固定清单 `FIXED_STRUCTURAL_TESTS`，其字面量现居 `scripts/fixed-structural-tests.mjs`），真 `require` `vitest.config.ts`（不解析源码文本，口径同 `tests/dist-artifact-hygiene.test.ts`），断言 `coverage.include` 的每个条目与 `coverage.thresholds` 的每个键都能匹配到 `src/**` 下至少一个真实文件；随本条一起删掉上面那两条已失效的条目（存量清零后再升硬闸）。**注意**：判据要按 §11.7 那条坑处理转义（`src/app/\(main\)/…` 这类键带反斜杠转义，与 `include` 的写法不同形，直接字符串比会造出假红）。

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

**验收**：往装配后的 `static` 里手动放一个 `db.sqlite` 或 `.env`，出厂命令必须红；跑一次完整出厂构建，`log/` 里能看到「standalone + static」两次计数记录。

---

### R6-01（P2，待验证）类型判决面是两套编译器

**证据**：`package.json:127` `@typescript/native: npm:typescript@^7.0.2`（`tsc --noEmit`，即 `check` / `typecheck` 走的那条）与 `:147` `typescript: npm:@typescript/typescript6@^6.0.2`（`eslint` / `typescript-eslint` 用的那套）并存；`AGENTS.md` 硬规则 2 钉住 `useTypeScriptCli: false`；已有 `check-tsc-diagnostic-executors.cjs`（§13.5.14）管「类型层声明 ⇄ 执行者」。

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

**对 R5-01 的直接后果**：`artifact` 档要求 `pnpm run build` 跑绿才认这笔改动，所以 R5-01 的提交停在
`fix/desktop-payload-count-after-assembly` 分支的暂存区里等账绿 —— 这是 §11.8 那本账在起作用，不是绕过去的理由。

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

| # | 位置 | 声称的内容 |
| --- | --- | --- |
| 1 | `README.md:193` | `check-ps1-consistency.mjs` 在 pre-commit 与 CI 核对两张入口表 |
| 2 | `03-样式与-tailwind.md:225` | `check-inline-style.cjs`（pre-commit 与 CI） |
| 3 | `03-样式与-tailwind.md:362` | 某判据已接入 `.githooks/pre-commit` 与 CI |
| 4 | `12-代码组织与文件结构.md:625` | `check-import-alias` 已接入 pre-commit 与 CI |
| 5 | `12:981` | `check-code-duplication.cjs` 在 pre-commit 与 CI 强制 |
| 6 | `12:1074` | 在 pre-commit 与 CI 强制（同族另一条） |
| 7 | `12:1358` | 在 pre-commit 与 CI 强制，基线 `.dead-exports-baseline.json` |
| 8 | `18-lib层规范.md:89` | `lib-node-only` 接入 pre-commit 与 CI |
| 9 | `Comfy-APP-T3-项目开发规范.md:132` | 17 章棘轮护栏已接入 pre-commit 与 CI |
| 10 | `launch-and-build.md:1507` | `check-comfyui-port-contract.cjs`（pre-commit 与 CI） |
| 11 | `launch-and-build.md:2649` | 同上那条端口契约判据（pre-commit 与 CI） |
| 12 | `launch-and-build.md:2778` | `check-ps1-consistency.mjs`（pre-commit 与 CI） |

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

**建议的修法（口径级，本笔不实施）**

1. 每条记录加一格**检出标识**（`git rev-parse --show-toplevel` 的哈希即可），判据读账时要求
   「今天 **且** 同一检出」才算绿；`--skip` / `--dirty` 的豁免同样带这一格。
2. 顺带一条更便宜的：**豁免不许跨提交存活**——`skippedReason` 只在「记它的那笔提交」有效，
   下一笔提交遇到同一档时必须重新表态（`b53c7b0a` 那次和今天这次都是栽在「豁免被合并带远」）。
   这条不需要新字段，改动面比 ① 小，先做它也够用。

**验收**：造一个反例——检出 A 跑绿并记账、A 为纯文档提交写一条豁免；在检出 B 立刻问 `freshness-gate`：
按 ① 必须报「不是这棵树跑的」，按 ② 必须让 A 的那条豁免在 B（或下一笔）失效，而不是当成今天的绿。

## 本次审查确认的强项（不是套话，是防止优化方向跑偏的基线）

- `src` 侧 7 项结构棘轮全为 0，且 `check-gate-executors.cjs` 实跑绿（65 判定型有执行者）——产品代码这一层没有「写着没人跑」的门禁。
- 产物层是**默认拒绝**白名单（顶层两闸 + 递归按形状减法 + 不穿符号链接），且 `tests/dist-artifact-hygiene.test.ts` 真 `require` 判据导出面，不是解析文本。
- 端口/地址有唯一出处（`src/lib/endpoints.ts`），且 `check-app-port-vectors.cjs` + `doc-facts.cjs` 跨语言核对数值。
- 失败路径规范（硬规则 4）+ 文档即判据（`doc:check` 核对生成物与权威源），治理密度在同规模仓库里属罕见。

## 未验证 / 假设

| 项 | 说明 | 下一步取证方式 |
| --- | --- | --- |
| MCP 入口的实际使用频率 | 若外部客户端接入是主推路径，R1-01 的可能性上调 | 看用户文档入口与 `docs/workshop-mcp.md` 的定位；问业主 |
| 提交钩子的实测耗时 | 影响 R2-01 的分档方案 | 从 `LOGD` 的分步日志聚合一次 |
| 本地单用户下 better-auth 的实际作用 | 存在 `login/page.tsx` + `authedProcedure` + 4 张认证表，桌面场景下的信任模型值得单独写清 | 读 `src/server/api/trpc.ts:180-220` 的兜底开关语义并确认默认档位 |
| 两编译器诊断差集 | R6-01 | 一次全量双跑对比 |
| 本报告自身的门禁影响 | 未跑 `pnpm doc:check` / pre-commit 的 D 组 | 提交前按 §13.1 自查清单核对 |

## 建议的动手顺序

1. R1-01 + R1-02 一起做（一个分支，含用例与门禁）——唯一不可逆后果那条。
2. R2-01 只在**本地链路**内找隔离执行者（`pre-push` 挂 `check:all` 是最小一步）；提「恢复平台 CI」会被 `tests/no-platform-ci-config.test.ts` 当场拦下，别往那个方向走。先量化钩子耗时再决定分档。
3. R3-01 与 R4-01 属「让判据覆盖判据自己」，可并行，风险低。
4. R5-01 一次小改动（装配后补一次计数）+ 一条人为投毒的验收。
5. R6-01 / R7-01 待取证后再排。

## 阅读顺序与再生成

- 先读本文件的「结论摘要」与发现清单表；需要图时读同目录 `2026-10-12-architecture-risk-map.dot`（Graphviz，`rankdir=TB`）。
- 再生成：审查基线为 `master` @ `b4705c3d`；所有 file:line 引用按该修订号成立，后续代码搬迁会让行号漂移，重跑时以「证据」小节的检索式为准（例如 `grep -rn "Access-Control-Allow-Origin" src tools`、`grep -n SCAN_DIR scripts/check-*.cjs`）。
