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
> 每条含优先级、证据路径与建议路径；完成一项划掉一项。上轮巡检：2026-09-27；
> A 系列逐条复算：2026-09-30（见 P1 段首）。

### P0 — 缺了就不算「已发布产品」（阻塞发布）

- [ ] **P0-1 CI 流水线**：缺口不是「没写配置」，而是**免费额度用不起**（#623 实测：`cpus: 8` 下一次 PR 近 1 核时，160 核时/月几十次 PR 就见底）。`76275841` 曾补回一份缩水版 `.cnb.yml` 充当「第二执行者」，但它**匹配不到任何事件**（顶层缺分支键与事件键，CNB 的形态是 `分支: { 事件: [流水线] }`）——构建历史里 `push` / `pull_request` 一条都没有，比删除前更彻底地静默失效，已按 ISSUE #1229 删除。出路不是把配置贴回去，而是 13.5.4 的**按需召唤**：在 PR / Issue 里 `@` 评审 NPC 跑一轮全量单测 / 产物护栏 / E2E，不 `@` 就不花核时。「补回一份看起来在守门的配置」这件事此前只有文档口径、没有判据（加回文件不会让任何现有门禁变红），现由 `tests/no-platform-ci-config.test.ts` 守住三头一致：仓库根没有自动触发型 CI 配置 + 规范确实这么写着 + `doc-facts` 不把它登记成 path 类事实；该用例登记在提交前的固定守护清单里，每次提交都跑。证据：`changelog.d/1229-remove-dead-cnb-yml.md`；规范 13.5.3 / 13.5.4；`tests/no-platform-ci-config.test.ts`。
- [ ] **P0-2 自动更新未接通**：`tauri.conf.json` `updater.endpoints:[]` / `pubkey:""` / 未开 `createUpdaterArtifacts`；能力已开校验全无（填端点即变未验签更新）。需：生成 keypair、配端点、开产物。证据：`src-tauri/tauri.conf.json:34-41,43-67`；`src-tauri/capabilities/remote.json:19`。
- [ ] **P0-3 客户端崩溃零上报**：缺 `src/sentry.client.config.ts`，`instrumentation.ts` 仅 nodejs/edge 分支；ErrorBoundary 仅 `console.error`。证据：`src/instrumentation.ts:8-24`；`src/components/ui/error-boundary.tsx:31-35`。
- [ ] **P0-4 无 release / source map 关联**：`next.config.js` 无 `withSentryConfig` / sourceMap 上传，堆栈无法符号化。证据：`next.config.js`（grep sentry/Sentry/sourceMap = 0）。
- [ ] **P0-5 无版本化 DB 迁移**：`drizzle/` 不存在，主推 `db:push`（无 TTY 可「报错 + exit 0 + 留 0 字节库」）。需：`drizzle-kit generate` 落地 + 禁用无 TTY push。证据：`package.json:13`；`src/server/db.ts:41-52`。
- [ ] **P0-6 无代码签名 / 公证**：缺 `certificateThumbprint` / `macOS.signingIdentity` / `publisher` / `licenseFile`。证据：`src-tauri/tauri.conf.json:43-67`；`src-tauri/Cargo.toml:6`。

### P1 — 安全正确性与运维可见性

> **A 系列逐条复算（2026-09-30）**：本批给闸门类端点补用例时，把 A1–A10 每一条都
> 对着当前代码重读了一遍。结论是**这个表在 2026-09-27 就写错了**：`8740948 fix(security): batch1 hardening`
> 一次改了 8 个源文件（A2 / A3 / A6 / A7 / A10 的修复全在里面），而**同一次提交**把这 5 条
> 登记成「待办」—— 修了的东西留在待办栏里，表现是「证据行号还在、内容早就不是那样」
> （A2 当时写的 `task.ts:179-194` 如今指的是别的过程）。
>
> 这不是文档瑕疵，它比没修更危险：待办栏里有一条「IDOR 未修」，后来人就会按它去设计
> 防线、或在评审时据此认为这块没有判据。所以本轮的口径是 **勾销必须与判据同批** ——
> 一条安全项被关闭时，必须能指出「哪条用例在钉它」（下面每条 `[x]` 都写了判据文件名）。
> 复算没找到能机器判的形式（「这条已经修了但没勾」是语义判断，写个启发式扫描器
> 只会误报一片、本身就成了会静默失效的清单 —— 见 §12.18 末段），因此只落这一条口径。
>
> **第二批（同月）接着复算了 A4 / A5**：A4 同样属于「早修了、没勾、判据是弱断言」，
> 已勾销并把判据加强；A5 的口径本身是对的，但**漏了第四个落点**（`setting.openExternal`），
> 而且四份实现里三份是前缀正则、实测两个方向都错 —— 已收成 `src/lib/url-scheme.ts` 一处。
> 顺带照出 A4 那次脱敏的**副作用**，另立 **A11**（远端模型密钥被「保存一次设置」清掉，
> 同日已修）。这条是本轮唯一「修一个洞的同时挖出一个洞」的记录，值得留着：
> **脱敏与回写必须一起设计** —— 出口把某个字段抹掉时，「这条没值」与「这次不覆盖」
> 就从两态变成三态，而覆盖式写入（`replaceAll` 这类）读不出第三种意图就会变成数据丢失。
>
> **⑨ 第一刀（同日）把这同一族判据推到素材库**：A12（scope 不判归属）当场修掉并配 36 条
> 判据；顺带把同一条链上更靠外的那一环记成 **A13** —— `/api/generated` 只判路径包含、
> 不判会话与归属，A12 把列表收紧之后「直接猜路径读」仍然敞开。留着它是为了不让
> 「素材库测过了」被读成「产物读取也安全了」。**下一刀就按这个名字把它修掉了**（见 A13 条目）。
>
> **⑨ 第二刀（同日）把「router 没有执行者」变成了一件已经发生的事**：给 `film` / `train` /
> `model` / `llm` 补 52 条判据时，照出的不是弱断言，而是**一个从 Prisma→Drizzle 迁移那天起
> 就没跑通过的 procedure** —— `train.cancel` 每次都 500，根因是仓储那个
> `select?: unknown` + `db.select(select as never)` 把调用点的形状错误整个咽掉（见 F13）。
> 「闸门坏了没人红」是这一族一直以来的说法；这一刀给它补了一个不是闸门的实例：
> **没有执行者的地方，烂掉的不只是判据，还有功能本身**。

- [ ] **A1 鉴权默认关闭**：无会话回落演示用户，`loginRequired` 默认 false，约 20 个 router 可写。证据：`src/lib/auth-server.ts:99-106`；`src/lib/app-settings/index.ts:96`。需评估默认强鉴权或显式化。
      ⚠️ 它同时是 A2/A3/A6/A7/A8 那一批「越权」的实际可达性前提：单用户本机部署下这些
      洞打不到别人，但**多用户开了登录就是真洞**，所以判据一律按「越不过去」写，不按
      「当前部署形不形得成」写。
- [x] **A2 IDOR：`task.workflow` 无归属校验（已修 + 本批补判据）**：`8740948 fix(security): batch1 hardening`
      已把快照读取挡在归属判定之后（他人 id 与不存在的 id 走同一句 `NOT_FOUND`，不给探测用），
      但**台账没勾、也没有任何用例判它** —— 判据现在在 `src/server/api/routers/task.test.ts`
      「他人任务 → NOT_FOUND」，且 `task.ts` 首次进覆盖率门槛。
      证据：`src/server/api/routers/task.ts`（`workflow` 段）、`src/server/api/routers/task.test.ts`。
- [x] **A3 IDOR：`project.outputs` 无归属校验（已修）+ 同族 `project.upsert` 越权写（本批新照出并修复）**：
      `8740948` 给 `get` / `patch` / `outputs` 三个读出口加了 owner 判定，同样没勾、没判据。
      本批写 `project.router` 的第一批用例时照出**同一族里漏掉的那一个**：`upsert` 的 id 由
      客户端生成（画布 localStorage 的 `proj_*`，每次自动保存原样送上来），而
      `projectRepository.upsertForUser` 的 update 分支**只按 id 定位行** —— 任何人把一个别人的
      项目 id 写进请求，就能把对方的 `name/nodes/edges` 整幅覆盖掉。现在 `upsert` 与 `get`/`patch`
      同口径先判归属，他人 id → `FORBIDDEN` 且**一行都不改**，并在服务端留一行 warn
      （这一路的客户端是「尽力而为的镜像」，失败被前端吞掉，warn 是唯一痕迹）。
      判据：`src/server/api/routers/project.test.ts`（17 条，含越权写 / 越权读 / 跨用户删三态）。
      证据：`src/server/api/routers/project.ts`、`src/lib/core/repository-project.ts`（update 分支
      仍只按 id —— 归属判定在 router 层，与 `get`/`patch` 同一处口径）。
      **同族第二段（客户端那一半）已补**：那句「warn 是唯一痕迹」原本是缺陷的自白 ——
      归属闸装上之后，`FORBIDDEN` 成了一格**新真实存在**的失败，而
      `canvas-store.persistProjectToServer` 的 `catch {}` 把它和「dev server 正在重启」
      压成同一种静默：界面显示已保存、换端口 / 换设备一看画布是空的，用户毫无线索，
      而再试一万次也不会成功。现在按「重试有没有用」分两档
      （`src/lib/project-canvas/sync-notice`：确定被拒 → 可查的登记表 + 广播 →
      `use-project-persistence` 弹一条带画布名字的提示；暂时拿不到 → 只留一行日志），
      提示正文**按码翻成人话**（`BAD_REQUEST` 的服务端 message 是 zod 的 JSON 形状，
      直接进 toast 等于把内部结构甩给用户 —— 「有出口」的那一半是读得懂；
      原文与 `code=` 另走一行日志，界面上看不见码就得能查回来），
      删除侧同一条判据（原先是 `.catch(() => undefined)` —— 「本机已经删了、
      服务端没删掉」的后果是换端口时它再冒出来，说的是那一句而不是笼统的「同步失败」）。
      ⚠️ 这一族的日志在浏览器侧只能走 `console`（pino 是服务端通道，打进浏览器包
      既跑不起来也会点着 `client-bundle-node-builtins` 那条判据），而
      「日志唯一通道」默认禁止 `src/lib` 直写 console —— 正解是按
      `tests/single-logger-channel.test.ts` 自己的机制把**这一个文件**登记进
      `CLIENT_ONLY`（首行 `"use client"` + 那三条判据逐条答得出），
      不是放宽判据、更不是整目录免检。
      判据：`sync-notice.test.ts` 26 条（分类两档各 6+8 态、去重、成功撤销，
      「zod 原文不进界面」与「日志里查得回码」各一条）+
      `canvas-store.test.ts` 新增 5 条（含「本地索引照常写入」这句不许回归的语义）+
      `use-project-persistence.test.ts` 3 条（**挂载时先读表**那一格单独立一条：
      写镜像的入口不止画布那一页 —— 工作区首页新建、画廊删除都会发镜像，而那些页面
      没有提示器，广播发出去没人接且不排队重放，所以只订阅必然漏）。
      证据：`src/lib/project-canvas/{sync-notice,canvas-store}.ts`、
      `src/components/studio/project-canvas/hooks/use-project-persistence.ts`。
- [x] **A4 LLM `apiKey` 明文回传客户端（已修 + 本批把判据加强到「整个出口序列化后一个字都不带」）**：
      `8740948` 就把 `configGet` / `configSave` 的出口改成脱敏形状了（顶层 `apiKey` 剥掉、
      改发 `hasApiKey`，远端条目逐条 `apiKey: undefined`），台账同样没勾。
      原有判据（`src/lib/llm/server.test.ts`）只断「那两个键是 undefined」—— 而这一族故障的表现是
      「密钥跟着配置接口一起发到浏览器、再跟着日志一起落盘」，所以本批把它换成**整个出口对象
      序列化后两把密钥（顶层与远端条目各一把）一个字都不出现**，并显式种进库里（不再是 null）。
      ⚠️ 那次脱敏带来一条新的副作用（**A11**，同日已修）：脱敏后的清单被覆盖式回写，
      「没带密钥」与「清空密钥」在旧形状里是同一个 `null`。
      证据：`src/lib/llm/server.ts`（`getConfigForClient`）、`src/lib/llm/server.test.ts`。
- [x] **A5 SSRF / 协议白名单（已修复；本批复算出「同一个口径漏了第四个落点」并补上）**：
      `llm.configSave` 的 `baseUrl` 与 `setting.comfyEmbeddable` 的 `base`/`hostOrigin` 输入层加
      `^https?://` 校验（与 `trainerUrl` 同口径），挡 `file://` 等非 http 协议；
      `comfy-embed.ts` 的 `probeComfyEmbeddable` 已有 `isHttpOrigin` 运行时防护。
      **复算照出两件事**：
      ① 同一句话在库里写了四遍（一份 `new URL()` 解析 + 三份前缀正则），而前缀正则实测**两个方向都错**
      —— 误拒合法的 `HTTPS://x`（大小写敏感）、误放行 `http://␣␣` 与 `http://x y`（不是合法 URL，
      存进设置后每次连它都换回一句难查的连接错误）；
      ② 覆盖面漏了**危害最大的那条**：`setting.openExternal` 的目标地址由请求方给，而它只过
      `z.string().url()` —— 那道闸管「是不是一个 URL」，`file:` / `javascript:` / 自定义协议
      （Windows 的 `search-ms:`、`ms-msdt:`，本应用的 `comfyapp:`）全都算「是」，
      而 `cmd /c start "" <协议>:…` 会**直接拉起协议处理器对应的本机程序**。
      修法：判据收成 `src/lib/url-scheme.ts` 的 `isHttpUrl()`（按 `new URL()` 解析、一处定义），
      四条出口全部改吃它，并在 `openUrlInBrowser()` 里**发起 IO 之前**拦 —— 内部那两条
      （`comfyOpen` / `dbStudioOpen`）给的本来就是 http 地址，加闸不改行为。
      判据：`src/lib/url-scheme.test.ts`（12 条）、`src/lib/shell/open-in-browser.test.ts`（12 条，
      含「拒绝时一次都不 spawn」与「URL 必须是独立 argv 元素」）、
      `src/server/api/routers/setting.test.ts`（34 条，端到端不 mock 地基）。
      证据：`src/lib/url-scheme.ts`、`src/lib/shell/open-in-browser.ts`、
      `src/server/api/routers/setting.ts`、`src/server/api/routers/llm.ts`。
- [x] **A6 `/api/custom-nodes` 参数注入 → 任意文件覆写（已修 + 本批补 35 条判据）**：
      `8740948` 加了 `safeSpawnArg()`（拒 flag 形态 / 空 / 超长 / shell 元字符），此前无执行者。
      判据现在分两层：坏形状必须在 **spawn 之前**就被拒（`expect(spawn).not.toHaveBeenCalled()`
      —— 只在响应码上打勾等于没拦住），合法包名则钉住 argv 的形状（`--only-pkgs` 永远是
      **一个**值、`--out` / `--report-out` 的位置与内容不许被客户端挪动）。
      顺带修掉同一条路径上的浪费：`parents` 为空批时 `runDiscover([])` 照样按
      python3 → python → py 轮三遍（各带一次超时与一次进程启动），现在空批直接回空结果。
      证据：`src/app/api/custom-nodes/route.ts`、`src/app/api/custom-nodes/route.test.ts`；
      GET 侧（manifest / report 读取）仍无执行者，门槛按实测登记在 E7。
- [x] **A7 `workflow.create.sourcePath` 读本机任意文件 + 路径回显（已修 + 判据已在）**：
      `8740948` 加了 `isWithinAllowedLocalWorkflowRoot()` —— 只允许配置目录
      （`LOCAL_WORKFLOWS_PATH` / ComfyUI `workflows`）下的文件，闸在 `importFromLocalPath`
      **之前**（用例断言它没被调用）。判据：`src/server/api/routers/workflow.test.ts`
      「根目录之外的路径在导入闸上被拦下，且不碰磁盘导入」。
      证据：`src/server/api/routers/workflow.ts`（`create` 段）、`src/lib/comfyui/localWorkflows.ts`。
- [x] **A8 `task.delete` 缺路径包含校验（已修，并查出两处真缺陷）**：
      这条与 `openFolder` 白名单「不自洽」的根因是**同一个布局被三处各拼一遍**，而三处已经分叉：1. `task.delete` 只拼 `public/generated/<taskId>`，可 `executor-finalize` 对**项目任务**落的是
      `projects/<projectId>/<taskId>` —— 在画布里删任务永远删不到产物目录，磁盘单调增长；2. 同函数里逐张 `unlink` 时把 `TaskImage.localPath`（`/api/generated/...`）解析成
      `public/api/generated/...`（多了一段 `api`）→ 每次 ENOENT，一张图都没删掉过；3. 两条失败都被 `.catch(() => undefined)` 吞掉 —— 既没有日志、也没有任何数字会动。
      落盘侧还反向缺判据：`projectId` 由客户端生成，一个 `../../x` 形状过去能把产物写到
      产物根之外（而 `/api/generated` 的白名单只认根内，写出去等于文件永远读不到）。
      修法是让布局只有一处定义：`src/lib/media/output-paths.ts`（`taskOutputDir` 同时算目录
      与判越界，`taskOutputUrl` 与它同源），落盘 / 打开 / 删除三个调用点全部改吃它；
      逐张 unlink 那条删掉（每张产物都在目录内，整体删除才是这一层该做的，
      逐张删反而可能碰目录外的文件）。越界处置留在调用点：打开 → `FORBIDDEN`、
      删除 → 只删库行并 warn、落盘 → 硬失败由 `complete()` 收口成任务失败。
      判据：`src/lib/media/output-paths.test.ts`（16 条，含「解析结果就是根本身」→ null）+
      `task.test.ts` 的三条 delete 用例（项目目录按 `projects/<pid>/<tid>` 删 / 越界不动磁盘 /
      rm 失败不阻塞删库但原因可见）。证据：`src/lib/media/output-paths.ts`、
      `src/server/api/routers/task.ts`、`src/lib/comfyui/executor-finalize.ts`。
      **A8 第二段（本批）：同一条错在另一处活了下来 —— 「合成成片」每条镜头必败。**
      复算「谁在自己拼这份布局」得到的不是当年那三处，而是**七处**：`materials.ts`
      （还自带第二份包含判据）、`workshop/media-source.server.ts`（模块级常量 + 第二份地址
      解析，而那份越界判据少了 `path.sep` 边界 —— 同级 `generatedX` 会被算作根内）、
      `film/compose-film.ts` 四处 join 外加自己写一遍 `/api/generated/films/…`、
      `film/compose-steps.ts` 的 `clipPathOf`、`api/film/bgm/route.ts`、
      `comfyui/firstframe.ts`，第七份**在全部 TS 检索面之外**：
      `scripts/comfyapp-open-folder.ps1` 把 `comfyapp://open` 的允许根写死成
      `..\public\generated`。其中两处的结论**互相相反** —— `firstframe.ts` 剥了 `api/` 段
      （所以首帧一直是好的），`clipPathOf` 只剥前导斜杠，于是库里 `filmShot.videoPath`
      （= `TaskImage.localPath` = `taskOutputUrl()` 写的 `/api/generated/…`）被解析成
      `<cwd>/public/api/generated/…`：那个目录不存在，ffmpeg 报找不到输入，去字幕重试仍失败，
      最后 `markFailed` 收口成一句「镜头 N 归一化失败」。
      ⚠️ **而这条曾经被断言反过来背书**：`compose-steps.test.ts` 旧的一条写
      `expect(...).toBe("/proj/public/api/generated/films/x.mp4")` —— 用例在替 bug 签名。
      这是 A8 那句「修了一处不等于修完」的第二次实证，也是为什么这一段的判据要扫**全部** src。
      修法：`output-paths.ts` 补「地址 → 磁盘」的唯一解析（`artifactDiskPath`：两种形状同答案、
      坏百分号编码判成「不是产物地址」而不是抛 `URIError`、越界返回 `null` 让调用点处置 ——
      口径同 `taskOutputDir`），七处全改吃它 + `generatedRoot()`；子层与地址前缀也收到同一处
      （`materialsRoot` / `filmsRoot` / `filmBgmRoot` / `ARTIFACT_URL_PREFIX` / `artifactUrl`）。
      **前缀那句断言是对外承诺**：磁盘根将来搬到哪，`/api/generated` 都不能变 ——
      它写在库里那些 `localPath` 里，改了等于历史产物全部读不到（这也是 A13 残留那条
      「搬出 public/」可行的前提）。
      判据：`tests/artifact-layout-single-source.test.ts`（固定清单 14 → 15）四条 ——
      src 里零第二处（五种被禁形状，先剥注释再扫）、扫描面非空且唯一出处确实在面里、
      五种形状各有一个实例真能被照出来（照不出就是装饰，不是判据）、**跨语言成对**：
      ps1 的允许根按 `$PSScriptRoot` 实解析一次必须等于 `generatedRoot()`
      （比绝对路径而不是比「去掉 `..` 之后的段数」—— 写成 `..\..\public\generated` 段数一样）。
      反向验证：往任一模块塞回 `path.join(process.cwd(), "public", "generated")` → 判据点名
      那份文件；把 ps1 改成 `..\..\` → 只有成对那条红。
      已知边界（写在判据头部，不冒充「全收」）：三处**给人看的 UI 文案**
      （`ProjectOutputs.tsx` / `ProjectOutputsMetadataSheet.tsx` / `MaterialLibraryPanel.tsx`
      里的 `public/generated/…`）不是路径构造、不在扫描面内 —— 视图层引不到这份纯 Node
      地基（`node:path` 会被客户端打包判据拦），所以它们只能跟着「搬根」那天一起改，
      已挂进 A13 残留那条。
- [ ] **A9 无 `middleware.ts`、better-auth 未配 `trustedOrigins`；限流仅 1 个 mutation**。证据：`src/server/better-auth/config.ts:8-39`；`src/server/api/routers/task.ts`（`rateLimitedProcedure` 只用在 delete 上）。
- [x] **A10 脚手架残留 `post.getSecretMessage` 不在路由表（已移除，本批复算勾销）**：
      `8740948` 一并删掉了它，`src/server/api/routers/post.ts` 现只剩 `getLatest` / `create`
      两条且都在 `authedProcedure` 后。（台账当时把「修了什么」写进了代码注释，
      却没改这张表 —— 见上方 P1 段首的复算说明。）
- [x] **A11 远端模型密钥被「保存一次设置」清掉（A4 那次脱敏的副作用，本批照出并修复）**：
      `getConfigForClient` 下发的远端条目**不带 `apiKey`**（A4 要求的脱敏），而
      `llm.configSave` 走 `remoteModelRepository.replaceAll(...)` —— 那一条批量语句是
      「整份覆盖」：入参里没有 `apiKey` 就写 `null`，`onConflictDoUpdate` 也照传值覆盖。
      于是设置页把**刚拿到的那份清单**原样回写一次，每条远端模型的密钥就被写成 `null`。
      用户表现：填过一次密钥的远端模型，隔一次设置保存就 401，而界面没有任何地方说过「密钥没了」。
      同一条语句里 `workshopAdapters` 是**从既有行继承**的，`apiKey` 却没有 ——
      一个函数内两种语义，正是「覆盖 vs 合并」没收口的形态。客户端那条路也给不出信号：
      `updateRemoteModel` 在「用户没重填」时写 `(existing?.apiKey ?? null)`，
      与「显式清空」（`clearApiKey`）到服务端**长成同一个样子**，所以必须两端一起改。
      **修法（三态，一次改到四个位置）**：
      · `~/lib/llm/types.ts` 新增 `normalizeEntryApiKey()` —— 非空串 = 写新值 /
      `null` 或空白串 = 显式清空 / 缺键与 `undefined` = **不提供意见**；
      `normalizeExtraModels` 与 `splitExtraModels` 都改吃它（这两处此前各写一份
      「不是非空串就折成 null」，正是把三态压成两态的地方）；
      · `replaceAll` 缺键时从既有行继承（与 `workshopAdapters` 同一处理，且不二次加密 ——
      继承的是库里那份密文原样）；
      · `getConfigForClient` 逐条下发 `hasApiKey`（密钥照旧不出门，但「这条配过」出门，
      客户端才有办法表达「我没重填」）；
      · `updateRemoteModel` 未重填也未清除时**省略该键**（草稿不揣测保留值）。
      顺带修掉同一条写入路径上的另一半问题：`replaceAll` 此前把远端密钥**明文落库**
      （`llmConfig` 那条路径一直是 AES-GCM 加密的），而 `db.sqlite` 会被 `next build`
      整份复制进 standalone 产物 —— 正是硬规则 17 说的那条「密钥明文分发」通道。
      读取侧 `decryptLlmKey` 对历史明文值原样透传，老数据不受影响。
      判据：`src/lib/llm/types.test.ts`（三态 + 两个归一器同源）、
      `src/lib/core/repository.test.ts`（「全量同步」那条现在验「缺键=继承、密文原样搬运、
      明文不落盘」，另有一条专测三态）、`src/lib/llm/server.test.ts`（出口带 `hasApiKey`
      且整个序列化结果一个字密钥都不出现）、
      `src/app/(main)/settings/hooks/use-settings-page.test.ts`（客户端三态表达）。
      证据：`src/lib/llm/types.ts`、`src/lib/core/repository-user.ts`、
      `src/lib/llm/server.ts`、`src/app/(main)/settings/hooks/use-settings-page.ts`。
- [x] **A12 素材库的 scope 不判归属：能把别人的项目 id 填进参数读写删（本批修复 + 判据）**：
      素材库是文件系统支撑的，分片方式就是**把画布项目 id 直接当目录名**
      （`public/generated/materials/<projectId>/<folder>/<file>`），所以「scope」这个参数
      同时是路径片段与权限边界。旧代码只判了前者（`sanitizeScope` / `sanitizeFileName` /
      `folderDir` 的包含断言），没判后者，于是两条越权路都通着：
      ① `scope=cross` 直接返回 `listScopes()` —— 等于把「本机都有哪些项目」当成一份
      可枚举清单交出去，再顺着它翻每个项目的素材；② 把别人的 `proj_*` 填进任意参数，
      读得到别人的文件、写进别人的面板、删得掉别人的文件。
      两个入口（tRPC `material.*` 与 REST `/api/materials`）**各写一份** `resolveScopes`，
      两份都漏了同一条判据 —— 正是 §12.12 说的形态。
      修法：判据收成 `~/lib/media/materials.ts` 一处（`materialScopeOwnership` /
      `visibleMaterialScopes` / `canWriteMaterialScope`），两个入口都吃它。三态而不是两态：
      `mine` / `foreign`（一律看不见、不可写）/ `unclaimed`（共享区，或库里还没这一行 ——
      画布 id 由客户端生成、镜像是尽力而为，把「还没同步上来的新项目」判成不可写会
      直接堵死上传素材这条路）。处置口径照搬 A2 / A3：**越权与不存在同形**
      （REST 404、tRPC `NOT_FOUND`），且写 / 删的拒绝发生在 `writeFile` / `rm` / `unlink` 之前。
      判据：`src/app/api/materials/route.test.ts` 18 条（含「一次都没落盘」的断言）；
      反向验证两处：写闸短路 → 恰好 4 条红，读侧收窄摘掉 → 恰好 3 条红。
      证据：`src/lib/media/materials.ts`、`src/app/api/materials/route.ts`。
      （这条当初登记时是**两个门各 18 条**：tRPC 的 `material.*` 也有一套。那一扇门后来
      因零消费方删掉了 —— 判据不减、面收成一条，见 E3′。）
- [x] **A13 产物与素材的读取口是纯路径静态流：`/api/generated/[...path]` 没有会话校验、也没有归属（本批修复 + 判据）**：
      这个端点原先只做「解析后仍在 `public/generated` 之内」那一条路径判据（那条有判据，
      #1260 补的），于是任何能访问该端口的一方都能按路径读走**所有人**的任务产物与素材
      —— 落点命名里就写着主人的身份：`projects/<项目 id>/<任务 id>`、`materials/<项目 id>/…`、
      `<任务 id>/…`、`films/<成片 id>.mp4`。A12 把「列表」收紧之后，这一环是同一族的
      最后一公里：列表看不见 ≠ 猜不到路径就读不到。
      修法分三层，各判各的：
      ① **会话** —— 入口改吃 REST 面唯一闸门 `requireRequestUser()`，无会话 401；
      ② **归属** —— 新增 `src/lib/media/output-access.ts` 作唯一判据，回答的是
      「这条产物**能否被确定属于别人**」（三态里保守的那一半）：项目两族直接吃 A12 那份
      `materialScopeOwnership`（**不再写第二份**「目录名是谁的」），`films` 查出成片行，
      其余按 `<任务 id>` 查任务行。库里查不到一律不算别人的 —— 判成别人的会把用户自己的
      历史产物打成 404 且毫无线索，判成自己的最多是被读到，代价不对称。
      拒绝发生在 `fs.readFile` **之前**，状态给 **404 而不是 403**（与「文件不存在」同形，
      这个端点不顺带回答「某个 id 存不存在」；口径同 A2 / A3 / A12）。
      ③ **接线**（这一层是写到一半才发现缺的，也是本条最值钱的部份）—— 上面两件做完
      自评已经是「修好了」，实测却当场推翻：产物根是 `public/generated/`，而 `public/**`
      由 Next **按静态文件直接发出、不经过任何 route handler**。同一个文件、两个 URL：
      `/generated/<taskId>/img_0.png` → 200 带出 1154930 字节原图（`Cache-Control: public, max-age=0`），
      `/api/generated/<taskId>/img_0.png` → 401。把 URL 里的 `api/` 去掉就整条绕过，
      而且桌包（standalone 起的服务）与 dev 两处一致。修法落在 `src/proxy.ts`
      （Next 16 的 `middleware` 继任者，本仓库原本是一份空转的落点）：把 `/generated/**`
      rewrite 进 `/api/generated/**`，让两种形状过同一道闸 —— 旧数据里 `/generated/...`
      形状的 URL（`workshop/media-source.server.ts` 历史上两种都收）因此继续可用，
      只是也得过闸。**配置层做不到这件事**：`next.config.js` 的 `rewrites()` 返回扁平数组
      时属于 `afterFiles`，实测压不过 `public/` 里的真文件（另起一份最小 Next 应用验过）。
      这一层自己还藏着一档更静默的：沿用下来的那条 `matcher` 通配把**带点的路径整个排除**
      （为了不动静态资源），而产物 URL 个个带扩展名 —— 只删 `matcher` 里产物前缀那两条、
      `proxy()` 一行代码不动，`/generated/<taskId>/img_0.png` 立刻回到 200、`/api/…` 仍 401，
      且**零报错**。「规则写了」与「规则跑到了」是两件事。
      折完之后在**桌包 standalone 形态**上按四档实测（`loginRequired` 打开、会话来自临时隔离库，
      两种 URL 形状逐档同答案）：无会话 → 401；有会话但那一行任务属于别人 → **404**；
      属于自己 → 200；库里查不到这一行 → 200（保守侧）。第四档就是「历史产物不误伤」这句
      话在真机上的形状，前三档是「挡得住」在真机上的形状。
      另注：`src/middleware.ts` 与 `src/proxy.ts` **不能并存** —— 实测 Next 16.3.5 在
      `next dev` 期抛 `Both middleware file and proxy file are detected` 的
      unhandledRejection，新加的那条一个字都不生效。加规则一律改 `src/proxy.ts`。
      两处刻意留下的边界，写在这里而不是被 `return false` 吸收：
      · **只在 `loginRequired` 打开时启用归属判定** —— 关掉时每个请求都解析成同一个演示
      用户，判定在数学上不可能有不同结果，只会因历史行的 `userId` 漂移把用户自己的产物打裂；
      · **`films/bgm` 是无主内容**（上传口 `api/film/bgm/route.ts` 落在全局单一目录、
      不记归属），判不了就明写在 `UNSCOPED_PREFIXES` 里 —— 新增落点时先问「它属于某个用户吗」，
      属于却没进这张表的，就是漏了一条判据。
      顺带一处**只有加了归属之后才成立的**收紧：`Cache-Control` 从 `public` 改 `private`
      （长缓存与 `immutable` 保留）。产物按任务目录一次性写入所以敢长缓存，但标 `public`
      等于允许共享缓存把 A 的产物回给 B —— 那会让上面那道闸只剩形式。
      判据：`src/lib/media/output-access.test.ts` 19 条（内存 SQLite + 真 Drizzle，
      逐族钉「我的 / 别人的 / 查不到」三档，并断言无主前缀**根本不去查库**）+
      `src/app/api/generated/[...path]/route.test.ts` 11 条（401、403 两种形状、
      他人产物 404 且一次都不读盘、单用户跳过判定、`private` + `immutable`）+
      `src/proxy.test.ts` 9 条（改写只动 pathname、查询串保留、`/api/generated` 不二次改写、
      以及直接断言 `config.matcher` 里有产物前缀那两条）。
      反向验证八处，每处只红该管的那几条：归属闸整块摘掉 → 2 红；不分单/多用户无条件判定 → 1 红；
      缓存退回 `public` → 1 红；无主前缀豁免摘掉 → 2 红；「查不到」改判成别人的 → 1 红；
      `projects` 一族漏判（落到任务查询）→ 1 红；`matcher` 漏掉产物前缀 → 真机 200/401 分叉
      （单测里断言 `config.matcher` 那两条即在位）；只留静态口不设 rewrite → 同一份图两处答案不同。
      代价与残留：每次读取多一次按主键的行查询（产物一文件一次，浏览器侧另有 `private`
      长缓存，本机 SQLite 上不构成瓶颈）；产物请求现在多过一层 proxy（dev 实测该层 ~0.3s
      含首次编译，稳态为亚毫秒级 rewrite）；**逐条按路径前缀判归属仍是「命名即权限」这一族
      的根本形状** —— 盘上文件本身没有属主记录，哪天落点命名换了形状，这张判据表就得同步，
      所以布局与判据两份都在 `src/lib/media/`（`output-paths` 管形状、`output-access` 管属主）
      并要求新增落点同批改。**另一条残留同源于此，本批关掉了**：产物以前住在 `public/` 下，
      而 `public/**` 由 Next 按静态文件直接发出、不经过任何 handler —— 那条旁路只能靠
      `src/proxy.ts` 的 `matcher` 记得写全来堵，漏一个形状就是「一行代码不动、判据零执行、
      零报错」。现在根搬到仓库根的 `generated/`（`generatedRoot()` 一个表达式），
      静态通道**不再存在**，判据只剩 route 一处。这一刀能做起来，靠的是上一刀
      （A8 第二段）把七份副本收成唯一出处 —— 于是「搬」真的只是一处改：
      · **URL 一个字都没动**：`/api/generated/…` 是写进库里的值，也是 `ARTIFACT_URL_PREFIX`
      这条对外承诺；搬的是磁盘位置，历史行照常读得到（判据在 `output-paths.test.ts`）。
      · **`src/proxy.ts` 那条 rewrite 留着，但职责降级**：它从「安全上的必须」变成
      「让老数据里 `/generated/…` 那种形状仍然走闸」的兼容层。漏配 `matcher` 的表现
      也随之从「绕过闸门拿到原图」变成「这条路 404」—— fail 的方向从泄漏变成读不到。
      这个取舍写进 `proxy.test.ts` 与 `proxy.ts` 的注释，别按旧理由理解这一层。
      · **历史盘上文件一次性搬**（`artifact-root-migration.server.ts`，接在
      `src/instrumentation.ts` 的 nodejs 分支、排在会读镜头视频的成片恢复之前）：
      三条硬约束各有用例 —— 新根已有同名条目时**留在原地绝不覆盖**（这条优先于
      「搬干净」）、Windows 上被占用（EPERM）时**不抛**但写一条说清「哪个条目、留在哪」的
      面板错误（硬规则 4）、第二次调用是空转（幂等靠「旧根还在不在」，不靠额外状态）。
      反向验证：把「同名就跳过」短路掉 → 恰好那条「绝不覆盖」的用例红。
      · **三处 UI 文案不再自己抄路径**：组件里那句 `public/generated/projects/…` 之前是
      布局的第二份字面量，而抄的那一份不会随搬迁而红，表现就是「界面让人去翻一个
      已经不存在的目录」。现在形状在浏览器安全的 `output-layout.ts`（不引 `node:path`，
      所以视图层能引；`output-paths.ts` 反过来 import 它并原样再导出，避免「有两个地方
      可以抄」），界面用 `artifactDirDisplay()` / `ARTIFACT_ROOT_DIR`。
      · **顺手关掉一条分发卫生账**：`build-desktop.mjs` 无 filter 整树拷 `public/**`，
      而 `standalone-private-inputs.mjs` / `check-standalone-contents.cjs` 两道清单
      放行 `public` 的理由写的正是「静态资源与**生成图落地目录**」—— 也就是构建机上
      攒的产物会跟着桌包分发（硬规则 17 禁的是「开发机私有输入」，本机图片算不算
      私有输入不替用户定性，形状先记下）。新根 `generated` **不在任何一层顶层白名单里**，
      默认拒绝直接把它挡在包外，无需新增条目；两处注释同步改成「产物不在这里」。
      **已知窗口（不当缺陷修，但要说清）**：`src/instrumentation.ts` 在 dev 下懒编译
      （实测 `✓ Ready` 之后约 40s 才跑这一支），所以升级到本版的开发机，头 40 秒里读
      历史产物会拿到 404；桌包（standalone）是进程起来就跑，用户侧没有这个窗口。
      要关掉得在 `scripts/dev-launcher.mjs` 的预检里加一步 —— 那是「全平台唯一编排」，
      动它前须完整读 launch-and-build §1–§3，本批没为这 40 秒去碰启动链路。
      **一处欠同步的注释（改名不改行为，但留给下一次碰壳的那批一起做）**：
      `src-tauri/src/lib.rs:1051` 那段「运行期目录都按 `process.cwd()` 解析」的清单里
      还写着 `public/generated/`，应为 `generated/`。不在本批改的理由是实的：
      暂存里出现 `src-tauri/src/*.rs` 就会付 `cargo test`（本机冷 430s）并触发
      「改了壳必须重编 release」那道时效判据（`scripts/shell-gate.mjs`），
      为一条注释让整个 PR 背上一次完整壳编译不值 —— 但**这条不是「以后再说」**：
      下一次任何动到壳的 PR，把这一行捎上一起改。
      ~~搬家之外还欠一件：静态口原本支持 `Range`，折进 route 之后 `Range` 被忽略~~
      **（已关，本批）**：形状判据收成 `src/server/lib/range-request.ts` 一处（RFC 7233 的单档，
      三种结论：整份 / 一段 / 满足不了），route 只把它翻成状态码 —— 一处补、两种 URL
      形状（`/api/generated/…` 与兼容层的 `/generated/…`）都吃到。读法也一起换了：
      原来是 `fs.readFile` 整份读进内存再切，现在按窗口 `fs.open` + `read(buf, 0, len, start)`
      只读那一段（否则「拖一下进度条」= 整份成片进内存，这条支持就白做）。
      实测（`next dev` 起服务，打一份 1 154 930 字节的真产物）：无 `Range` → 200 全量；
      `bytes=0-99` → **206** + `Content-Range: bytes 0-99/1154930` 且 body 恰好 100 字节；
      `bytes=200-` → body 1 154 730；`bytes=-50` → `bytes 1154880-1154929/1154930`；
      `bytes=99999999-` → **416** + `Content-Range: bytes */1154930`；
      `bytes=0-1,2-3` 与 `bytes=500-100` → 200（按 RFC 这两条是语法无效，**不许判成 416**）。
      顺带两条只有跑起来才看得见的口径：`Accept-Ranges: bytes` 必须在场（缺了它，
      浏览器第一次 seek 才会想起发 `Range`）；短读（同名产物被重新生成、文件在请求内变短）
      要把 `Content-Range` 一起收窄 —— 承诺 6 个字节而 body 只有 2 个比回 404 更坏。
      证据：`src/lib/media/output-access.ts`、`src/app/api/generated/[...path]/route.ts`
      （32 条用例，含「带 Range 也不许绕过会话与归属闸」那组）、`src/server/lib/range-request.ts`
      （18 条形状判据，四项门槛满档）、`src/proxy.ts`（接线与 matcher）、
      `src/app/api/film/bgm/route.ts`（无主前缀的来源）、`src/server/film/compose-film.ts`
      （`films/_tmp_<id>` 中间目录与 `films/<id>.mp4` 收口 —— 判据里那条 `_tmp_` 还原就是为它写的）。
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

- [ ] **E1 提交时只跑一小撮用例**：原记「pre-commit 仅跑 7 测试文件（1.6%）」的形态已
      变过一次——现在是**固定 9 份结构守护 + 沿静态 import 图解析出的受影响用例**
      （`scripts/affected-tests.mjs`，规范 §13.5.8），改到哪测到哪这条已落地。仍未解决
      的两点：① 靠运行时 `readdir` 自扫扫描面的判据不会被「改了某份 check 脚本」拉进
      这一层（实测撞到过一次：那条红在 master 静置到全量复跑才看见）；② `check:all` 只有
      4 项、不含棘轮/E2E/覆盖率。证据：`.githooks/pre-commit:63-70`；`scripts/quality-gate.mjs:39-65`。
- [x] **E2 覆盖率门槛是死配置**：根因比「test 门无 `--coverage`」还深一层 —— 即使加上，
      v8 在任何用例红时默认**清数据、不产出报告**，门槛照样一条都不判（实测全量 464 文件 /
      2 败 → `coverage/` 是空的，终端只看得见那两条红）。两处一起修：两侧门禁
      （`scripts/quality-gate.mjs` 的 `GATES.test` 与 `scripts/quality-gate.ps1` 的 `$Blocks`）
      的 test 门带 `--coverage`；`vitest.config.ts` 补 `coverage.reportOnFailure`。
      两条约束记在规范 §11.7：覆盖率只在**全量**这一档判（单文件跑 `--coverage` 会把其余
      路径按 0% 汇总、`thresholds` 每条都刷红），别挪进钩子的增量层。§11.13 补了
      「带 coverage」这个预算维度（`LogPanel.test.tsx` 45s → 120s，单跑实测 25.0s / 34.4s）。
      开门那一次抓到的 21 条真回退已按实测重基线，**欠的课转 E7**。
      证据：`scripts/quality-gate.mjs`、`scripts/quality-gate.ps1`、`vitest.config.ts`。
- [ ] **E7 覆盖率棘轮开门即抓到的真回退（补用例清单）**：E2 把门打开的那一次全量跑
      （465 文件全绿）当场报出 21 条不达标，已按 §18.6 逐条降到「实测向下取整到 5 的倍数」，
      旧值与原因留在 `vitest.config.ts` 的 `coverage.thresholds` 注释块里。这不是并行档抖动：
      同一批文件**单跑**带 `--coverage` 得到一模一样的数字。欠的课按大头排 ——
      `src/lib/process/process-launch.ts` 行 17.9%、`src/lib/process/kill-process-tree.ts`
      行 29.1%（执行宿主那批新代码 + 平台相关分支）、`src/lib/log/log-file-client.ts` 行 23.5%、
      `src/lib/core/repository-task.ts` 行 70.6%、`src/lib/browser-storage.ts` 行 81.8%。
      补上对应用例后**同批**把门槛抬回旧值（只升不降）。
      · **process 那两项已清（这一格从「欠账」改成「还掉的方式」）**：低覆盖的原因不是缺用例，
      而是**用例只有在另一台机器上才跑** —— POSIX 判据组整组 `runIf(!win32)`，
      而 `process-launch.ts` 的 `spawnManaged` 四条拉起路径从来没被任何用例调过。
      补的是**判决面**：`ps` 报什么组号、`process.kill` 接不接受这个目标、该发哪条命令行，
      三件事全部注入，于是同一张表在两端机器上判同一个结论（真起进程数残留那组照旧留着）。
      本批两份文件实测：`process-launch.ts` 100/100/100/100（原 19.35/24.07/45.45/17.85）、
      `kill-process-tree.ts` 100/96.05/100/100（原 31.39/25/47.61/29.11）。门槛按**整目录**登记
      （这个 glob 里还有 #1327 下沉进来的 `executable-resolve.ts`，它的欠账是台账 E12 那一批的事），
      目录级实测 93.65/87.08/96.49/94.87 → 从 25/20/45/20 抬到 93/87/96/94。
      这一趟顺手照出并修掉三处「只有落笔时才知道」的事：
      ① `waitForDetachMediator` 的超时兜底**在调用那一刻就算好了**，于是超时那一路永远读回
      空 stderr —— 而「中介没退出」恰恰只在超时时发生，`Start-Process` 被拒的原因就只有这一路
      拿得到（`withTimeoutResult` 的口径写明 fallback 是值不是工厂，本处按口径改成超时后再算）；
      ② POSIX keepAlive 开重定向文件时，**第二个 `openSync` 抛错就漏掉第一个 fd**：
      父进程长期持有日志文件句柄（Windows 上表现为轮转与删除全失败），而调用方拿到的只是一句
      error；现在两条失败路径都关掉已开出来的那些；
      ③ 「目标的 PGID 与调用者相同 → 禁走组路径」这条防自杀判据，`readOwnPgid()` 的注释承诺
      「自身组读不到时视同为自身组」，**代码两处都没实现**（ownPgid 为 null 直接放行组信号）——
      异步版与同步版各抄了一遍这张表，所以一处修好另一处仍是旧的；现在收成
      `planPosixKill` + `executePosixPlan` 一份定义，两条入口只剩「拿结论发信号」。
      另记一笔：`killProcessTreeSync` 的 `mode:"image"` 凑出来的是 `/IM <pid>`
      （这张签名里根本没有映像名），现在明确拒绝并把该走的入口说清楚。
      余下的欠账：`src/lib/log/log-file-client.ts` 行 23.5%、`src/lib/core/repository-task.ts`
      行 70.6%、`src/lib/browser-storage.ts` 行 81.8%，以及全库覆盖表里**唯一一个 0% 且有人在调**
      的 `src/lib/media/video-queue-client.ts`（60 行，消费方是 `VideoQueueModal`）。
      同批新增的已知欠账（本批按实测登记，不是回退）：`src/app/api/custom-nodes/route.ts`
      —— POST 的 argv 闸门 35 条已逐分支钉住，**GET 侧**（manifest / report 读取 +
      按 (size, mtime) 指纹的摘要缓存）仍无执行者，门槛登记在 35/35/45/40。
- [x] **E13 Storybook 落地时自带的两条红：夹具在普通权限下必 EPERM + 一条 high 传递依赖（本批修复）**：
      发现路径与 E12 同一条 —— 另一批 rebase 之后跑 `check:all` 才看见：`tests/storybook-check-script.test.ts`
      七条**全红**，而红的不是判据是夹具：`symlinkSync(<仓库>/node_modules, <临时目录>/node_modules, "dir")`
      在 Windows 上需要开发者模式或管理员令牌，实测 `EPERM: operation not permitted, symlink …`。
      门禁本体完全能跑，红的只是「测试夹具搭不起来」——这一族本仓已经处理过两次
      （`tests/check-reformat-only.test.ts` 的 `symlinkSafe`、`tests/dist-artifact-hygiene.test.ts` 的
      `symlinkDir`，两处各自写了「为什么要分平台」的注释），**但第三份没抄到**，于是同一个理由
      散在三处、第三处漏了。收成 `tests/helpers/symlink-dir.ts` 一处（Windows 走 NTFS junction，
      不需特权且不跨机跨卷；POSIX 忽略 type 参数，行为不变），三处一起改吃它。
      第二条是 `webpack-dev-middleware` 的 high 路径穿越（advisory #1240027，`publicPath` 不以 `/`
      结尾时），经 `@storybook/nextjs > @storybook/builder-webpack5` 传递进来，而 Storybook 10.6.1
      把自己的 range 钉在 6.x —— 不动到它，审计判据就一直红。走 audit 自己给的出路 ①
      （`pnpm-workspace.yaml` 的 overrides 到修复版 7.4.5）而不是 ②（登记进基线 = 棘轮的后门）。
      这是 overrides 块里**唯一一条跨 major**，理由与代价都写在那一行旁边：受影响面只有组件工作台的
      dev server（本地预览、不对外提供服务）。验证走的是它真正干活的那一面而不是「装得上」——
      `pnpm storybook:build` 出件，`pnpm storybook` 起 dev server 后 `/`、`/iframe.html`、
      `/index.json` 全 200（后两个正是 wdm 从内存文件系统 serve 的），`pnpm why` 只剩 7.4.5 一个版本；
      收摊用 `scripts/reap-process.mjs` 杀整棵树。
      证据：`tests/helpers/symlink-dir.ts`、`pnpm-workspace.yaml`（overrides）、
      `changelog.d/0-storybook-check-junction-and-wdm.md`。
- [x] **E12 新落地的跨平台判据在开发机上「只能为不可能红而绿」：`executable-resolve` 的 POSIX 那几档（本批修复）**：
      发现路径是台账 E7 那一批 rebase 时撞上的 —— `99323be7`（ISSUE #1327，控制台起进程前先解析可执行形态）
      落进 master 时带着**它自己的 5 条红**：`executable-resolve.test.ts` 4 条 + `console-run.test.ts` 1 条，
      在 Windows 开发机上单跑也红（先按 §13.6.2 用 `git stash` 复算过干净基线，确认不是从我的改动来的）。
      根因不是业务错，是**判据的输入没能全部注入**：模块把 `platform` 做成了参数（于是可以「假装是 linux」），
      但「这个候选起不起得来」那一步仍然问真机器。实测本机：`fs.accessSync(X_OK)` 对
      0o755 / 0o644 / 0o444 / 0o000 **一律通过**（Windows 不参与判断执行位），而把真 `.exe` 改名成
      无扩展名再 spawn 得到 `ENOENT`（CreateProcess 不认）—— 于是「有执行位的脚本跑得起来」
      「文件在但没有执行位」这两档在本机只有两个下场：整组 `runIf(!win32)`（这台机器上零执行者，
      正是台账 E7 记的形状），或者**为它本来就不可能红而通过**（更糟：绿灯是假的，
      「候选存在但不可执行 → null」那一条当时就是这样绿的 —— 它跑的是 ENOENT 那条完全不同的路径）。
      修法是补上缺的那一个注入点（口径同 `kill-process-tree.ts` 的 `COMFYAPP_TASKKILL`）：
      `UsabilityProbe { access, spawn }` 进 `WhichCommandOptions`，默认值就是原来那两句真调用，
      生产侧两个消费方（`console-run.ts`、`scripts/launcher-core/shell.mjs`）零改动；
      Windows 那几档**不注入** —— 批处理不起、`.ps1` 落宿主、MZ 头当二进制在本机是真造得出来的，照旧问真机器。
      顺带修掉那条大小写：候选名是拿 `PATHEXT` 拼的，而系统那份默认大写（`.COM;.EXE;…`），
      于是解析结果可能是 `node.EXE` —— spawn 无所谓，但这一份路径会回显在控制台、也会写进日志，
      而用户拿它去比对与点开时对不上；现在命中后向目录本身要一次真实大小写（POSIX 大小写要紧，原样返回）。
      证据：`src/lib/process/executable-resolve.ts`（`UsabilityProbe` / `onDiskName`）、
      `src/lib/process/executable-resolve.test.ts`（`posixHost`）、`src/lib/console/console-run.test.ts`。
      变异检过两刀：让注入的探针失效（恒问真机器）→ POSIX 那 4 条红；去掉大小写归一 → 控制台那条红。
- [x] **E11 `check-format.cjs` 的 fail-open：prettier 没跑成时被读成「全库干净」（本批修复 + 判据）**：
      发现路径不是「有人投诉格式」，而是另一条批次的提交门槛红了 —— `tests/check-format.test.ts`
      里三条「期望门禁拦住」的用例在钩子的多 worker 批次里稳定红，而**串行单跑全绿**。
      用一次性沙箱探针量到底（按用例的方式搭临时仓、直接打印子进程的 status/stdout/stderr）：
      沙箱里 `pnpm exec prettier` 报
      `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL — Command "prettier" not found`，**退出码 1、stdout 为空**；
      而脚本的判读是 `const code = res.status ?? 1; if (code !== 0 && code !== 1) exit 2;`
      —— 1 是「有差异，清单在 stdout」的合法码，于是空清单被读成
      `未过 prettier 0 个文件（基线 0 个）` + `[format] OK` + **exit 0**。
      后果：依赖没装 / pnpm 形态选错 / 任何让 prettier 起不来的机器上，这道棘轮**静默放行**，
      而钩子那行 `[ok] ── check: prettier 格式棘轮` 一个字都没说。与台账 E10
      （清单顶穿命令行上限，「组 C 红但零执行」）是同一族：**门禁的失败表现必须与
      「跑过了且没问题」不同形**；本条更糟的一面是它连红都不红。
      修法（三条出路全部 fail-closed）：入口解析不到 → exit 2；被信号终止（`status === null`）→ exit 2；
      **退出 1 却一行都没列出来** → exit 2 并附 stderr。取 prettier 不再经 pnpm 层
      （`node <本地 node_modules/prettier/bin/prettier.cjs>`，取不到才报错），
      缓存从机器全局 `os.tmpdir()/comfyapp-prettier-cache` 换成本检出的
      `node_modules/.cache/prettier-gate.json`（用例并发搭沙箱会共用同一份缓存；
      实测那条路径最后是一份 1.6 MB 的 JSON 文件 —— prettier 3.9 的 `--cache-location`
      本来就是**文件**语义，我第一版按「它该是目录」写的检查因此是错的，已撤）。
      判据：`tests/check-format.test.ts` 加两条（21 → 23）——「入口取不到 → exit 2 且输出里
      不许有 `[format] OK`」「假入口退 1 不落一行 → exit 2」；用例改由
      `COMFYAPP_PRETTIER_ENTRY` 这条接缝借真实仓的 prettier（沙箱里没有 node_modules），
      夹具里那份 `launcher-core/` 拷贝随之删除（脚本不再动态 import 它）。
      变异实测：把「退 1 且空清单」那条规则短路 → 恰好新用例红，其余 22 条绿。
      同族两处**已核、形态本来就安全**（写在这里免得下批再找）：`check-reformat-only.cjs`
      用 `if (res.error || res.status !== 0) → 失败`，且批量失败时退回逐文件 stdin 兜底；
      `run-tests.mjs` 判 `result.error` 并透传退出码。
      证据：`scripts/check-format.cjs`、`tests/check-format.test.ts`、规范 §13.5.1。
- [x] **E8 router 层 19 处裸 `throw new Error` —— 业务分支在客户端表现成 500（本批清零 + 升成硬闸）**：
      tRPC 对**非 `TRPCError`** 的抛出按内部错误归码，所以「分类不合法」「项目没生产数据」
      「slug 重复」这些本来该是 4xx 的分支，到 caller 边界是 `INTERNAL_SERVER_ERROR`
      （实测：修前的 `film.detail` 拿到 `TRPCError: Film not found { code: 'INTERNAL_SERVER_ERROR' }`）。
      后果三条：① A2 / A3 / A12 的「越权与不存在同形」在**状态码这一层没成立** ——
      别人的资源与不存在的都回 500，看着一样纯属巧合，任一侧改动就分叉；
      ② 客户端拿不到能分支的码，界面只能显示「出错了」（硬规则 4 的「用户可见出口」缺半句）；
      ③ 一次正常点击进 `trpc_error` 警告日志，把业务分支当故障报。
      **逐处判意图，没有机械替换**（19 处 / 7 个文件）：
      | 分支 | 码 | 为什么 |
      | --- | --- | --- |
      | 那一行不存在 / 别人的行（`project` 3、`task` 2、`generate` 1、`workflow-model.rename` 1、`run` 写回 1） | `NOT_FOUND` | 越权与不存在同形，不给探测 id 用 |
      | 输入形状不合法（`material` 6：分类不在枚举 / 文件名清洗后为空 / 路径越界） | `BAD_REQUEST` | 是请求方的错，与服务端故障必须分开 |
      | 名字撞车（`skill` slug、`workflow-model` 重命名目标） | `CONFLICT` | 「与现存数据冲突」既不是不存在也不是故障 |
      | 前置数据没准备好（`run.start` 无生产数据、`generate` 空 rawJson） | `PRECONDITION_FAILED` | 文案是**下一步该做什么**，归到 404 就把可行动的提示判没了 |
      同形的两半都要判到：别人的行与不存在的行必须**同一个码 + 同一句文案**，
      所以判据取整个信封（`tests/helpers/trpc.ts` 的 `errorEnvelope()` 把码与消息一起取出再比），
      不是 `rejects.toThrow(原文)` —— 只比消息时 500 与 404 可以同文案，那条口径就成了
      一句没有判据的话（⑨ 第一刀的 `material` 用例正是这样漏的：**覆盖率满档不等于每个维度都被判过**）。
      **防线是 lint 而不是新的 `check-*.cjs`**：`eslint.config.js` 给
      `src/server/api/routers/**/*.ts` 上了 `no-restricted-syntax`
      （selector `ThrowStatement > NewExpression[callee.name!="TRPCError"]`，自定义错误名也在拦），
      B 组每次提交都跑、直接指到行号。它自己的用例 `tests/router-error-envelope.test.ts`（已进固定清单）
      判三层：**存量为零**（扫真源码、先过 `stripComments`）、**扫描面非空**（路径写错时「零命中」
      长得像「都修好了」）、**selector 真的会响**（拿 eslint 自带的 `Linter` 在两段片段上验：
      裸 Error 与 `new TypeError` 报、`new TRPCError` 不报）—— 「配置写在」与「配置在跑」是两件事，§11.7 同源。
      判据：新增 `skill.test.ts` 8 条 + `workflow-model.test.ts` 11 条（这两个 router 第一次有执行者，
      三个码各不相同 + 幂等早退不该抛错 + 不越权改别人的行），另有 `generate` / `run` / `material` /
      `project` / `task` 五处原有用例从「比消息」升级成「比信封」。反向验证：把任一码改回裸 Error
      → lint 与用例双红；把 `errorEnvelope` 退化成正则比消息 → 「同形」那条红。
      **没在本批做的**：`run.ts` 的覆盖率没进门槛（它的分支大头在别线的工坊编排里，本批只动到错误信封）；
      `workflow-detail` / `workflow-mutations` 的 `message: "Workflow not found"` 是**英文文案**
      （码已经对，属另一条口径，见台账 P3 卫生里的文案一致性）。
      **一处门槛按实测下调并已留痕**：`material.ts` 的 `lines` 100 → 95（同文件
      `statements` 90 → 95、`branches` 75 → 80 顺带收紧，净一降两升）。原因是那两处
      `if (!dir)` 拆成多行 `TRPCError` 之后，不再被「条件行」顺带盖住 —— 它们本就是
      **不可达的防御分支**（`scope` 过 `sanitizeScope` 的字符白名单、`folder` 是枚举，
      `folderDir` 的包含断言因此不可能失败），留着是给「以后有人放宽那两条校验」兜底。
      **没有 mock `folderDir` 把数字凑回 100**：那测的是今天不存在的输入形状，数字好看而判据是空的
      （口径同 §18.6「门槛取实测、旧值与原因写在注释里」）。
      证据：`eslint.config.js`、`tests/router-error-envelope.test.ts`、`tests/helpers/trpc.ts`、
      `src/server/api/routers/{material,project,task,generate,run,skill,workflow-model}.ts`。
- [x] **E9 应用事件通道「只剩一端」—— 装成对判据并逐条处置三条死端（本批）**：
      `~/lib/app-events` 把事件名与载荷类型收在一张表里，但表管不到**有没有人用这一行**。
      两种坏法全是静默的：派发方没了而监听器还挂着（表现是「界面该刷新的时候没刷新」，
      注释却继续写着「某某按钮会通过它请求打开详情」，后来人顺着注释找不到触发源，
      然后以为是自己看错了）；订阅方没了而广播照发（更隐蔽 —— 代码照常执行、什么都没发生）。
      判据：`tests/app-event-pairing.test.ts`（固定守护清单 18 → 19 条）。认两种写法
      （字面量与 `export const X = "a:b"` 的常量间接形态 —— 库里真有一处这么派发，
      只认字面量会误报，而误报一片的判据会被当噪音关掉，那比没有判据更糟）；
      **测试文件不算任何一端**（口径同 E3′：只有用例在调的口不是安全，是可以烂掉而没人红）；
      定义处自己不算端；先过 `stripComments`（注释里举例提到事件名不是派发）。
      装机实测到的存量三条**逐条处置在同一次提交里**：
      ① `open-task` 只有订阅（`use-history-list` 里那条 `useEffect` 与表行删除；
      `openDetail` 仍由列表行点击调用，功能面没动）；
      ② `comfyapp:local-workflows-path-changed` 只有订阅，且它对应的 `.env` 覆盖项
      早已被「设置里的 ComfyUI 安装路径推导」取代（`getLocalWorkflowRoots` 读 `readEnvVar`，
      全仓没有 UI 写它）—— 连它那份**替不存在的链路背书**的用例一起删
      （`use-workflow-library.test.ts` 里「目录配置变更事件会触发重新拉取」那条自己
      `dispatchEvent(new CustomEvent(...))` 造出派发方，于是永远绿：口径同 §11.2.1
      「断言在替缺陷背书比没有断言更糟」）；
      ③ `custom-nodes:updated` 只有派发（`refreshCustomNodes()` 每次解析完都发，
      而它的订阅侧 —— 画布的添加节点菜单 —— 已不在库里，`getAllNodeTypes()` 如今零消费方）。
      **本批没修的那一条点名留下**：注册表刷新现在**确实没有**通知通道，
      「从设置面板解析出新节点后，视图要硬刷新才看见」是现状；补它必须连订阅侧一起补
      （判据会拦只有派发的那一端）。③ 的删除让 `refreshCustomNodes` 的
      `catch { return 0 }` 第一次有了日志 —— 「刷新失败」与「manifest 里零个节点」
      在调用方看来同形，那行 `console.error` 是唯一能分开的痕迹。
      ⚠️ **同时量到 P61 的一处豁免过宽**（本轮没改，属他人判据）：
      `check-ui-primitives.cjs` 的 P61 对「已经 import 了 app-events 的文件」整份跳过，
      于是那样的文件里再裸写 `new CustomEvent("a:b")` 不计数。实测本批只在被删的那份
      测试里见到这一形态，暂无生产侧实例；精确化方向是「按调用点豁免」而不是「按文件豁免」。
      证据：`src/lib/app-events.ts`、`tests/app-event-pairing.test.ts`、
      `src/config/custom-nodes.ts`、`src/components/studio/{history/hooks/use-history-list,workflow-library/hooks/use-workflow-library}.ts`。
- [x] **E10 提交门槛的 C 组「红但不是用例红」：清单顶穿平台命令行上限，vitest 根本没起（本批发现并修）**：
      同一次提交里撞出来的，值得单独立一条 —— C 组原本是 `pnpm exec vitest run --maxWorkers=4 $files`，
      清单是**位置参数**、长度随改动面线性增长。改 22 个文件的那一批算出 **229 个用例 / 10840 字符**，
      而 `pnpm exec <bin>` 在 Windows 上经 `.cmd` shim，那条链的上限是 cmd.exe 的 **8191 字符**：
      进程没起，stdout 只有一行 GBK 乱码（「文件名或扩展名太长」），钩子只说「组 C 失败」。
      危害不是「被拦」，是**它长得像任何别的东西** —— 判据在场、跑了 0 个用例、退出码非零而
      原因读不出；改动面越大的提交越容易撞上，也就是治理线自己的批次最先撞。
      与本台账反复记的「绿 ≠ 跑过」是同一族的两面：**红也 ≠ 跑过**。
      修法与判据：启动那一步交给 `scripts/run-affected-tests.mjs`（`spawnSync(process.execPath,
[vitest 的 ESM 入口, …])`，不经 cmd 层，上限回到 Win32 的 32767），按 24000 字符预算
      **分块**且「宁可多起一次也不丢用例」；入口走 `require.resolve("vitest/package.json")` +
      `bin.vitest`，不写死 `node_modules/vitest/…`（pnpm 布局下顶层只是链接）。
      判据 `tests/hook-affected-launch.test.ts`（固定清单 19 → 20）钉四件：分块后**并集等于输入
      且顺序不变**、每块在预算内（单条就超预算时点名红，不许静默跳过）、启动器没有 `shell: true`
      也不出现 `pnpm exec vitest` / `npx vitest`、钩子里 C 组确实指向该入口（配合成旧写法反证）。
      两次变异各红各的：把钩子换回旧拼法 → 恰好那条钩子文本判据红；把最后一块丢掉 → 三条
      「不丢用例」的判据一起红。
      ⚠️ **与同批落地的 `tests/doc-check-hook-wiring.test.ts` 对齐过一次口径**（规范 §13.5.8：
      「在场判据要解析、不要 `toContain`」——把钩子里那行前面加 `# ` 注掉，行内仍含同一段
      字面量，`toContain` 照样命中）：本判据原先正是 `hook.toContain("scripts/run-affected-tests.mjs")`，
      而本文件上方的机制说明里也写着这个文件名，**在注释上命中**是分不出「在执行」与「已静音」的。
      现在按 `run_group C … sh -c '<body>'` 解析出实调用体、剔掉行首是 `#` 的行再断言，
      并补一条「注掉那一行」的反证（实测恰好那一条红）。同一次对齐还保住了钩子里那句
      「D(N 个判据脚本)」的计数陈述 —— 它由那份判据核与实际 D 组步骤数一致，
      本批改写 C 组注释时把它原样带过去并加了「新增判据必须同步这个数字」的指向。
      ⚠️ 顺带量到但**本批没动**：`.githooks/pre-commit` 的注释里有硬日期
      （`2026-09-22 并行化重排`）—— R10「注释禁止历史流水」只扫 `.ts/.tsx/.css`，shell 脚本
      在判据面之外；要把这类落点也管住，得先给 R10 加扫描面而不是逐处手改。
      证据：`.githooks/pre-commit`、`scripts/run-affected-tests.mjs`、
      `tests/hook-affected-launch.test.ts`、规范 §13.5.8。
- [x] **E3 服务端集成覆盖收口：判据从「router 有没有测试文件」升到「每条 procedure 有没有执行者」（本批）**：
      台账从 13/16 走到这里，最后 3 个零执行者的口（`customNode` / `user` / `post`）
      **没有一条被补成测试** —— 给死口写用例等于把它焊死。逐条定性后删除：
      · `customNode.list`：`nodes` 写死成 `[]`（真正的 manifest 读取在 REST
      `/api/custom-nodes`，同一份数据两个门、tRPC 这一个是假的），并把
      `getSettingsSync()` **整包**回给客户端（本机安装路径 + 全部开关状态），零消费方；
      · `post.getLatest` / `post.create`：T3 脚手架示例。源码注释自称「OWASP A01：列表与
      读取都要求已登录」，而 `loginRequired` 默认 `false` ⇒ `authedProcedure` 回落演示用户
      ⇒ 那句「要求登录」在默认配置下等于没写；`getLatest` 也没有 `createdById` 过滤，
      是跨用户读。零消费方；
      · `user.me`：客户端取会话走的是 better-auth 的 `authClient`（`src/app/login/page.tsx`），
      这口从没有被调用过。
      **判据落在挂载动作上**（`tests/trpc-surface-executors.test.ts`，已进
      `FIXED_STRUCTURAL_TESTS`）：枚举 `appRouter` 的全部 procedure（登记时 74 条，随后续批次增减），
      要求每条都出现在
      「import 了该 router 文件闭包」的测试里的调用形态 —— 「文件在、某几条口照样零执行者」
      是这一族最后的漏洞，所以粒度必须是 procedure 而不是 router。三条配套 sanity：
      扫描面本身非空（空输入不许绿）、命名空间都得在 `root.ts` 登记、判据自身用合成的
      `ghost.*` 反证四种形态（没测试 / 只 import 不调用 / 调用但没 import / 齐备）。
      本批顺带填的两个真空（除那 3 个 router 外全表仅有的两条零执行者口，功能是真的、
      缺的是判据）：`workflow.detailFull` / `workflow.subgraph` 共 5 条用例，钉
      「他人的 id 与不存在的 id **逐字**同形」「`bust` / `uid` / `hostId` 三个入参真的
      转到了 lib」。反向验证逐条做过：去掉 `findByIdForUserSelect` 的 userId 条件 →
      两条归属用例红；`bust` 写成 `{}` → bust 用例红；`hostId` 写死 `""` → 子图坐标用例红。
      证据：`src/server/api/root.ts`、`tests/trpc-surface-executors.test.ts`、
      `src/server/api/routers/workflow.test.ts`、`vitest.config.ts`（`workflow-detail.ts` 首次登记门槛）。
      **本批复算出来、交给下一条（E3′）处置的存量**：**13 条 procedure 有执行者、
      零消费方** —— `llm.complete`、`material.list` / `material.save` / `material.delete`、
      `project.get` / `project.patch`、`skill.create`、`train.detail`（另有本批删掉的 4 条）。
      口径是「客户端源码里搜不到 `api|trpc|vanillaApi|sender.<ns>.<proc>` 的字面调用」，
      复算方法：`appRouter._def.procedures` 全枚举 + 沿 import 闭包比对 `src/` 非服务端源码。
- [x] **E3′ 零消费的 tRPC 口：收成「每条口都要有消费方」的硬闸（本批修复 + 判据）**：
      上一批复算出 13 条有执行者、零消费方的口。逐条问过「这口还有谁要」之后分三类处置：
      · **与 REST 面重复的两扇门收口到有人走的那一侧**（§12.12 / §12.14）：删掉
      `src/server/api/routers/material.ts`（`material.list` / `save` / `delete` 三条）——
      素材库面板自始至终走 REST 的 `/api/materials`（`src/lib/media/materials-client.ts`），
      归属判据在 `src/lib/media/materials.ts` 一处。**「判据一条不减」这句先被实测驳回了**：
      门删掉之后 `materials.ts` 的分支覆盖从 80 掉到 **78.43**（`check:all` 当场红）——
      那些清洗与包含分支（129 字符的 scope、`..`、`a<b>.png`、201 字符的文件名、隐藏文件、
      子目录、单条 stat 失败）此前只被那扇门的用例**顺带**走过，而活着的 REST 门送进来的全是
      合法入参，这些形状一个都进不来。补法不是把死门找回来，而是**给判据层自己一份用例**
      （`src/lib/media/materials.test.ts`，按判据本身组织）+ REST 补一条「素材库根读不出来时
      按『没有别的 scope』答」，分支回到 **100** 并按实测把门槛抬上去（95/90/85/80 → 100/95/98/100）。
      三条变异核过：去掉 scope 的长度上限 → 恰好那条拒绝用例红；把 `folderDir` 的包含断言摘掉 →
      恰好 `..` 那条红；去掉隐藏文件的跳过 → 恰好排序那组红（其余 36 条全绿）。
      删掉 `llm.complete` —— `/api/llm` 是活的 LLM 门
      （还多带流式与 tools），它身上的 `provider` / `taskType` 枚举闸改由
      `llm.configSave` 的用例判住（补了一条 `temperatureByTask` 非法键 → 400 且不落库）。
      · **确实要留的四条登记在案并写明「谁将来接它」**：`project.get` / `project.patch` /
      `skill.create` / `train.detail`。它们不是「判据缺失」而是「功能未接」——归属与形状闸
      都有用例，红得起来。
      · 判据升成硬闸：`tests/trpc-surface-executors.test.ts` 加了**第二个维度**（消费方），
      与执行者维度共用一份挂载面（`scanSurface()`）。要点三条：
      ① 消费面 = `src/**` 的非测试代码且**先剥注释** —— 只有测试在调 = 零消费方，
      这正是 `material.*` 的形状（18 条归属用例全绿、界面一个字都没引用）；
      ② 点名形态认三种（`api.ns.proc`、`api.ns["proc"]`、`RouterInputs["ns"]["proc"]`），
      定义这条口的文件闭包不算它自己的消费方；
      ③ 登记表 `ZERO_CONSUMER` **双向不陈旧** —— 口没了登记还在 = 红，消费方接上了登记
      还在 = 红，登记条目长度进棘轮（`MAX_ZERO_CONSUMER`，只许降）。
      反向验证逐条做过：摘掉 `train.detail` 的登记 → 主断言报 `['project.get','train.detail']`；
      把登记键改成 `project.gone` → 陈旧断言报「已经不存在，登记该删掉」。
      顺带一条**实测**：判据装机时暴露出「客户端地址没有落点」这一族（3 条真请求打向不存在的
      handler，实测全 404；另有 1 条只是 URL 形状的缓存键），另立 E3‴ 处置（同批已关闭）。
      证据：`src/server/api/root.ts`（「登记即欠两样东西」）、
      `tests/trpc-surface-executors.test.ts`、`src/lib/workshop/generation-client.ts`
      （`fetchWorkshopStyles`）+ `src/lib/workshop/generation-client.styles.test.ts`、
      `vitest.config.ts`（素材那组从三条减成两条）。
- [x] **E3‴ 客户端写的 REST 地址有 3 条真请求没有落点（实测 404，界面按空态吞掉），另有 1 条 URL 形状的假地址（本批修复 + 判据）**：
      复现口径是**实测**而不是读代码：起本机服务逐条 curl ——
      `GET /api/skills`、`GET /api/images?filename=…`、`GET /api/file/x.png` **全部 404**，
      同一条链上 `GET /api/trpc/project.list` → 200。三个 handler 在基线迁移那次提交里
      就没带过来（`git log --diff-filter=D -- src/app/api/<名>/**` 逐条可查），调用点却留着。
      失败形态不是报错而是**常年空态**：404 → 调用点一句 `catch {}` / `MediaThumbnail` 的空 `src`
      就把它咽下去（「选完图看不到图」那条实测反馈有一半是这个原因，不只是形状解析）。
      四条的处置（各归各位，没有一条靠加兜底）：
      · `/api/skills` → 改吃 `skill.list`（`fetchWorkshopStyles`，与成片工作室同一扇门，
      内置技能种子因此只有一份）；
      · `/api/images` → **补上那个根本不在的 handler**（`src/app/api/images/route.ts`）：
      本机代理 ComfyUI 的 `/api/view`，复用现成的 `getView()` 与 `contentTypeForPath()`，
      判据顺序 = 会话 → 文件名形状 → 类别枚举 → 上游状态；失败**分三相**
      （上游 404 → 404 / 上游别的码 → 502 / 连不上 → 503 + `hint=comfyui-unreachable`），
      响应头必须 `private` 且不许 `immutable`（口径同 A13：响应取决于「你是谁」，
      而 ComfyUI 的 `input` 目录会被同名上传覆盖）。
      为了让这三相可判，`getView()` 的失败从 `Error("getView failed: 404")` 改成
      带 `status` 的 `ComfyViewError`（消息原样保留，`executor-finalize` 那类只判
      「拿不到就抛」的调用方零感知）—— 否则调用方只能**读消息**来分相，消息一改判决就错。
      实测（`next dev` 起服务、ComfyUI 未运行）：`/api/images?filename=nope.png&type=input`
      → **503** 且体里带着 `hint`（本批之前是 404 从 Next 发出，两种 404 在状态码上分不出来）；
      缺 `filename` → 400；`filename=../../x.png` → 400；`/api/trpc/project.list` → 200。
      · `/api/file/<name>`（训练素材缩略图）→ **不补第二扇门**：它是同一件事的另一条地址，
      改吃 `comfyImageUrl({ filename })`，于是「ComfyUI 媒体地址」的形状仍然只在
      `media-url.ts` 一处（那本来就是它收口的理由）。
      · `use-workflow-detail-loader.ts` 的 `` `/api/workflows/${id}[/subgraph]` `` → 它**不发请求**
      （真实请求走 `vanillaApi.workflow.detailFull` / `subgraph`），只是拿这个形状当
      sessionStorage 的键；键改成请求身份三元组，`CACHE_KEY_PREFIX` 的 `R7` 升一档
      （`purgeStaleCache` 会洗掉旧命名空间，TTL 本来 30s，代价是一次缓存未命中）。
      判据：`tests/rest-endpoint-targets.test.ts`（进 `FIXED_STRUCTURAL_TESTS`）——
      扫 `src/**` 非测试代码里以引号紧接 `/api/` 开头的每个字面量，必须命中
      `src/app/**` 目录形状推出的某个 route handler；段数要对齐（少一段就是 404），
      `[x]` 吃一段、`[...x]` 吃剩余全部（也吃零段），`${…}` 当通配段；
      `` `${base}/api/prompt` `` 这种前面是 `}` 的外部服务地址不进扫描面。
      两类**长得像地址但不是地址**的必须显式登记（`NON_REQUEST_ADDRESS`，双向不陈旧：
      字面量没了还留着 = 红，登记的路径其实有 handler = 红）：`/api/trpc` 是 RPC 通道基址
      （真实请求一律 `/api/trpc/<ns.proc>`，实测那条 200、基址本身没人拿），
      `/api/ws` 是 ComfyUI 自己的 WS 路径（拼在 `ws://<comfy host>` 上）。
      **判据装机时自己先错过一次**：它抄了别处的 `collectTs`，那份递归跳过名为 `generated`
      的目录（产物根在仓库根时是对的），于是 `src/app/api/generated/[...path]` 整个从路由表里
      消失，`/api/generated/…` 被判成没有落点。假红暴露的正是「同一份扫描工具在不同目录
      语义不同」——现在注释写在函数上，跳只剩 `node_modules` 与 `.next`。
      反向验证：往 `media-url.ts` 塞一条 `/api/nope-endpoint/x` → 恰好主断言红并点名文件；
      把登记键换成 `/api/gone-already-fixed` → 主断言与陈旧断言各红一条。
      证据：`src/app/api/images/route.ts` + `route.test.ts`（11 条，四项门槛满档）、
      `src/lib/comfyui/client.ts`（`ComfyViewError`）+ `client.test.ts`（`getView` 三支）、
      `src/lib/media/media-url.ts`、`src/components/studio/TrainingStudio.tsx`、
      `src/components/studio/workflow-editor/hooks/use-workflow-detail-loader.ts`、
      `git show ab12a551^:src/app/api/images/route.ts`。
- [ ] **E3″ 端到端仍只有 3 spec / 31 用例且无登录态**（E3 的 router 维度已收口，这一维度没动）：
      没有任何一条走完「登录 → 建项目 → 出图」的旅程，所以壳起不来、会话过期、
      中间件改写这类**只在真实 HTTP 栈上成立**的缺陷没有执行者（A13 的产物口就是靠手工
      实测才发现的，见那条）。证据：`e2e/*.spec.ts`；`playwright.config.ts`。
- [ ] **E4 msw 仅 7 文件使用**；缺 zod↔API 契约测试。
- [ ] **E5 棘轮 `--update` 无制衡**。证据：`AGENTS.md:94,97`。
- [ ] **E6 无 bundle 体积门禁 / 变异测试 / a11y 自动化**。
- [ ] **F1 零 i18n**（中文硬编码、`lang` 写死）。证据：`src/app/layout.tsx:36`。
- [ ] **F2 缺 `global-error.tsx`**；`error.tsx` 仅 1/6；`loading.tsx` 仅全屏；`<Suspense>` 0 处。
- [ ] **F3 `next/image` 0 处且 lint 关闭**。证据：`eslint.config.js:185-192`。
- [ ] **F4 无离线能力**（无 SW / `onLine` / 离线队列；58 文件手写 localStorage 无 persist）。
- [ ] **F5 虚拟滚动仅 2 处**；`next/dynamic` 仅 2 处。
- [~] **F6 Storybook 已接入（ISSUE #1381），可视回归仍未接**；UI 复用棘轮 78 条存量违规。证据：`.storybook/`、`package.json` 的 `storybook` / `storybook:build`、`scripts/.ui-primitives-baseline.json:18`。剩余的一格：**像素基线**仍是 Playwright `toHaveScreenshot`（规范 11 §11.8），Storybook 不替代它。
      **已加的两层判据**（同批）：故事文件的**枚举来源**由
      `tests/storybook-cva-variant-source.test.ts` + `node scripts/storybook-check.mjs`
      守着（`cva()` 返回的是函数、运行期没有 `.variants`；以及手写清单漏档）。
      判据上线时当场抓到 `button.stories.tsx` 漏列 `icon-sm` / `icon-lg` 两档
      —— 而这两档全库有 46 处在用，口径见规范 16 §16.2.3.4。
      **组件覆盖率**随后从「写在 `guide-storybook.md` 里的一句话」升成棘轮判据
      （`tests/storybook-component-coverage.test.ts` + 同一份门禁，台账
      `scripts/storybook-checks/coverage-ledger.mjs`）：分子只许升不许降，分母
      （`ui/` 的可预览文件数）变了要同批回答「新增的那个为什么没有 story」。
      这一格因此**不再是文档里的数字** —— 口径见规范 16 §16.2.3.5。
      当前覆盖 `scripts/.storybook-coverage-baseline.json` 里的实测值；没有 story 的
      组件逐条理由（hook / 只有出错时才渲染的边界件 / 被别的基元 import 的部件…）
      也写在那份台账里，不是一张赦免名单。
      **「有数据依赖」那一批已收口**（同批）：先搭了「Args → 数据源」的注入层
      （`.storybook/data-sources.tsx`，口径见规范 16 §16.2.3.6），再给它写 story。
      复核时纠了一件事 —— 「有数据依赖」此前用得太宽，其中一大半其实是
      **纯 props，只是有几个 ReactNode 参数**（`field` / `seed-mode-button` /
      `option-list-popover` / `segment-popover`）或**结构化入参**
      （`studio/RequiredSummary` 吃 `WorkflowIOMap`）；真正需要注入层的只有
      「吃一条真链路 / 一层真上下文」那一档。同批新增 `Studio/` 与 `Workshop/`
      两个 story 分组。`ui/` 有 story 的组件数 21 → 34（棘轮基线同批改）。
      **注入层刻意不 mock**：拿不到真数据时画的就是「拿不到」（`media` 源留了一个
      故意不存在的 `missing.png`，名字写错则抛错）。跨源那道门槛（应用不回 CORS）
      是**刻意不绕**的，写明在 §16.2.3.6 —— 于是 tRPC 那一族 story 在画布上验的
      是「界面在后端不可用时的形态」，那恰好是真机上最难复现的一档。
      **`ui/` 的组件覆盖率已到 87/87（全量），理由表清空**（同批）：那 5 条理由
      逐条都是「补法」而不是「不能写」——`progress`（两个 slot 在 `progress-bar`
      里看不到）、`sonner`（story 里真调 `toast()`）、`error-boundary`（配一个会抛
      的 `Boom`）、`dialog-overlay` / `dialog-width`（**出口算出来的字符串就是它的
      对外面**）。判据随之从「理由表非空」换成一条**双向不变式：表空 ⟺ 覆盖率已满**
      （原判据会在表真的清空后要求人凑一条假理由）。同批修掉 `cvaVariantKeys`
      按「整文件同名轴取并集」比较的真缺陷（`ui/item.tsx` 两处 `variant` 会被判成
      「缺档」而修法无处可去）。口径见规范 16 §16.2.3.7。
- [ ] **F7 metadata 脚手架默认值**（无 OG/SEO/manifest）。证据：`src/app/layout.tsx:19-23`。
- [ ] **F8 无 Onboarding**；快捷键仅一处命令面板。
- [ ] **F9 更新无通道 / 回滚**；`installMode:passive` 失败无回退。
- [ ] **F10 `eslint-plugin-jsx-a11y` 未显式启用**。证据：`eslint.config.js:63-69`。
- [ ] **F11 端口 TOCTOU + 800 槽哈希分桶碰撞无兜底**。证据：`src-tauri/src/lib.rs:831-834`；`single_instance.rs:189-192`。
- [ ] **F12 无 Web Vitals**；SQLite 无 `busy_timeout`；几乎无事务边界。证据：`src/server/db.ts:74-75`。
- [x] **F13 `unknown` + `as never` 把「调用点形状错了」咽掉（本批补判据并清掉两处实例；实例已随 F13′ 收完）**：
      Prisma→Drizzle 迁移把仓储的投影参数写成 `select?: unknown`，交给 Drizzle 时
      `db.select(select as never)` —— 于是调用点留着 Prisma 的布尔投影
      （`{ id: true, status: true }`）时 **tsc 一声不响**，运行时生成空投影 → SQL 语法错。
      实际后果：`train.cancel` 自那次迁移起每次 500，而这条 router 没有执行者，
      所以没有任何一条红过（`c7a77d19` 那刀补上判据、类型收紧成
      `Record<string, AnySQLiteColumn>`，见 `repository-lora.ts` 的注释）。
      **本批把「类」变成有判据的东西**：`tests/f13-projection-shapes.test.ts`（进固定清单）判四件事 ——
      ① 非测试源码里每一处 `as never` 都要**逐处登记 + 写清为什么**（新增未登记 = 红；
      登记的那处不见了 = 红；按「文件 + 该文件内次数」记账，不按会漂的行号）；
      ② 投影类参数（名字含 `select` / `projection` / `columns`）的类型不许是
      `unknown` / `any`；③ `.select(… as never)` 这个形状零存在（就是当年那一句）；
      ④ 仓储签名里不许有以 `_` 开头的参数 —— 那个下划线就是「我知道没人用，但我不想删」的写法。
      判的是**形状**而不是语义：`as never` 的语义就是「这里我不检查了」，
      而对编译器按下静音键的地方，坏掉的时候也不会对任何人吱一声。
      **同批清掉的三处实例**（原来都在扫描面的盲区里）：
      · `workflowTemplateRepository.findByIdForUserSelect(userId, id, _select?: unknown)`
      —— 参数名承诺投影、实现是 `db.select()` 全列，三个调用点还在传 Prisma 形状的
      `{ id: true, rawJson: true, … }`。后果是性能而不是 500：详情加载每次把
      `rawJson` 与 `positions` 两个大 JSON blob 整行拖出来，而那份「只取需要的列」
      的清单是空气。改法 = 删掉这个不做实事的方法，元数据那一读换成**真投影**
      （`findSourceMetaForUser` + `SOURCE_META_COLUMNS`），另两读改吃已有的
      `findByIdForUser`（行为一字不变 —— 它们本来拿的就是整行）。
      · LLM 回来的景别：`parseShotsFromJson` 把它声明成 `string`，下游
      `shotType: s.shotType as never` 塞进 `Shot` —— 等于「模型返回什么景别就存什么」。
      现在收在**解析边界**（`normalizeShotType`），并补一条用例钉住清单外的值必须回落
      默认档（变异核过：把 passthrough 写回去 → 恰好这一条红）。
      · 顺带照出**同一份清单被抄了四遍**：`ShotType` 联合、`VALID_SHOT_TYPES`、
      `prompts.ts` 里的 `SHOT_TYPES`、`StoryboardPlanner.parts.tsx` 里又一份下拉选项。
      现在 `SHOT_TYPES` 是唯一出处（联合由它派生），其余三处吃它。
      **这一族另一半仍然只有执行者能发现**（「一个 procedure 从迁移那天起就是死的」），
      那一支已随 E3 收口成判据（`tests/trpc-surface-executors.test.ts`）。
      证据：`tests/f13-projection-shapes.test.ts`、`src/lib/core/repository-workflow-template.ts`、
      `src/lib/workshop/types.ts`（`SHOT_TYPES` / `normalizeShotType`）、
      `src/lib/core/repository-lora.ts`、`changelog.d/0-router-gates-tranche2.md`。
- [x] **F13′ MCP 工具的写侧入参没有域内校验（本批修复；同族另一处另立 F13″）**：
      `src/server/mcp/workshop-mcp.ts` 的 `workshop_set_characters` / `workshop_set_storyboard`
      原本把 inputSchema 写成 `z.array(z.any())`，再 `as never` 压进 `Character[]` / `Shot[]`。
      与其他几处「桥接第三方签名」不同 —— MCP 是**外部客户端可以随便发的边界**，而这两个工具
      是**整幅覆盖**草稿并落库。具体后果（不是"类型不安全"这种抽象说法）：
      `styleTags` 给成字符串时 `buildCharacterPrompt` 先过 `c.styleTags.length`（字符串也成立）
      再 `.join()` → TypeError 打断写入路径；`characterIds` 同理被 `rebuildShotPrompts` 的
      `.includes` 用掉。
      修法：`~/lib/workshop/types` 出一份**贴着接口的写侧契约**（`characterInputSchema` /
      `shotInputSchema` + 两个 list 版本），工具直接引用它，`as never` 随之消失
      （**tsc 现在验的是真的** —— 契约产出的是真 `Character[]` / `Shot[]`）。口径四条：
      只有「缺了就没法被引用」的必填（id / name / index）；可缺省的补默认（文本 `""`、
      列表 `[]`，因为下游无条件读取）；**必填枚举严格**（`status` 脏值走拒收）、
      **可选枚举认不出当没给**（`motion: "hyper"` 不落库也不因它拒收整批）；
      `positivePrompt` / `prompt` 一律空串占位，由服务端 `rebuild*Prompts` 重算 ——
      输入里带什么都不信（否则外部可绕过重算直接指定最终提示词）。
      ⚠️ **一条只有落笔时才知道的事**：MCP 的入参校验发生在 SDK 从 zod 推出的
      **JSON Schema** 上，不是 zod 本身。`z.unknown().transform(normalizeShotType)`
      在那一层是「非可选」，于是「模型压根没给景别」这个最常见的情况会被直接拒
      （实测 `expected nonoptional, received undefined at shots[0].shotType`）。
      正解是 `.default(...)` + `.transform(...)`：JSON Schema 里是带 default 的可选字段，
      zod 侧缺值先补默认再归一。
      判据两层：① `tests/f13-projection-shapes.test.ts` 的登记表里**这两条已删**
      （登记失去记账能力就是白表），并新增一条「MCP 面的 inputSchema 里不许出现 `z.any(`」
      （含合成反证；变异：把契约换回 `z.array(z.any())` → 恰好这条红）；
      ② `src/server/mcp/workshop-mcp.test.ts` —— 这一层**此前的 17 条工具零执行者**，
      现在走真的 `client.callTool`（内存 transport，不是直接调 handler：handler 实测
      **不做校验**，喂 `{a:""}` 会原样进 callback）逐条点名「翻译到哪个服务端出口」，
      并判「拒收时 orchestrator 一次都没被调用」。门槛按实测 100 满档登记
      （`coverage.include` + `thresholds` 两处同批）。
      **同族另一处 → F13″**：`src/lib/workshop/draft-sync-shared.ts` 的 `parseDraftDto`
      只校验容器（`Array.isArray`），元素仍是 `obj.characters as Character[]` /
      `obj.shots as Shot[]` 强转。它该复用本批这份契约，但读的是**用户自己的草稿**——
      「脏元素是丢弃还是保留原样」是数据保全决策，不是一次类型收口的顺带项，
      先定口径再动（丢弃 = 静默丢用户数据；保留 = 这处继续不校验）。
      证据：`src/lib/workshop/types.ts`、`src/server/mcp/workshop-mcp.ts`、
      `src/server/mcp/workshop-mcp.test.ts`、`src/lib/workshop/draft-sync-shared.ts`。
- [ ] **F13″ 草稿同步路径的元素级仍未校验（F13′ 的同族另一处，先定口径再动）**：
      `src/lib/workshop/draft-sync-shared.ts` 的 `parseDraftDto` 只判容器
      （`Array.isArray(obj.characters)`），元素是 `as Character[]` / `as Shot[]` 强转 ——
      于是「数组里躺着一个 `styleTags` 是字符串的角色」照样能从 localStorage 进服务端镜像，
      与 F13′ 修掉的 MCP 那一格是同一个洞、不同的门。
      修法 = 复用 `~/lib/workshop/types` 的 `characterListInputSchema` / `shotListInputSchema`
      （形状只有一份事实源，不在这里再写一遍 zod，§12.12）。
      **动手前要先定的不是代码而是口径**：这条路径读的是用户自己的草稿，
      认不出的元素**丢弃**= 静默丢用户数据、**保留**= 这处继续不校验。
      建议的第三条路（与 E11 那类「按后果分档」同口径）：逐元素 `safeParse`，
      认不出的**保留原样但整条草稿标成「需要修复」**并在界面给出口（硬规则 4），
      既不丢数据也不把脏值当合法喂给 prompt-builder。定了再动，同批补判据。
- [ ] **P3 卫生**：无 `.editorconfig`；`package.json` 无 `engines`；tsconfig 缺 `exactOptionalPropertyTypes` 等；`cn@^0.3.0` / `lucide-react:^1.47.0` 版本偏宽；双 TS 版本导致构建/门禁语义不一致；`/api/update-check` 无鉴权回显变更指纹；`comfyapp://` 由外部 helper 实现需单独审计防任意网页利用本机路径。

## 规范状态

已固化:12(结构/命名/卫生/防线)、13.5(本地提交门禁)、03 §3.1(v4 规范
类名)、TESTING.md(分层策略/覆盖率棘轮)、reviews/(两轮审查归档)。
待补:无——新缺口按上表滚动进入对应章节。
