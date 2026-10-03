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
  的 `DOMAINS`（R14）并按 §18.6 在 `vitest.config.ts` 设实测门槛，见 §18.14 / §12.5.3）；
- 提交 / PR / 自查清单 / 分支策略 → `docs/standards/13-提交与-code-review.md`
  （§13.1 自查清单、§13.5 门禁、§13.6 分支与合并、§13.6.1 master 提交守卫）；
- 不确定读哪些 → 先读 `docs/standards/15-附录.md` §15.5「新成员 10 分钟速读路径」建立全局认知。
- 跨文件检索 / 代码图谱查询 → 项目已配置两个 MCP server（`codegraph`、`zvec-grep`，声明见
  `.mcp.json`）作为**导航加速**：前者按语义图谱找定义/引用/影响面，后者按正则/文本做跨文件
  检索。**门禁判据只在 `scripts/check-*.cjs` 与 `.githooks/pre-commit`**——MCP 不替代机器
  判据，也不作为提交前的独立校验源；选择顺序：先看有没有对应 `pnpm exec` 脚本 / 门禁能给出
  结论 → 得不出再做检索。具体输入 / 输出 / 失败语义以各 server 的 `--help` 与
  `.mcp.json` 声明为准。

> 判断标准：改动被「强制先读规范文档的改动范围」表或本清单覆盖但未先读就动手 = 违规，
> 提交会被拒或要求回滚。

## 强制先读规范文档的改动范围

| 范围                                                                  | 路径                                                                                                                                                                                                                            | 规范章节                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 启动链路                                                              | `scripts/dev-launcher.mjs` + `scripts/launcher-core/**`（**全平台唯一编排**）、`scripts/dev-launcher.ps1`（仅入口）、`src-tauri/src/shell_launch.rs`（壳自编排）                                                                | §1–§3（编排 §3.3 / 入口 §3.2）                                                                                                                                                                                                                                           |
| Windows 双击入口                                                      | `tools/<分类>/*.ps1`（启动类 `tools/start/`）、`scripts/entry-common.ps1`                                                                                                                                                       | §8                                                                                                                                                                                                                                                                       |
| Tauri 壳                                                              | `src-tauri/**`（conf.json / src / splash-assets）                                                                                                                                                                               | §2、§7                                                                                                                                                                                                                                                                   |
| ComfyUI 生命周期                                                      | `src/lib/comfyui/**`（lifecycle / executor-* / reaper）                                                                                                                                                                         | §3、§5                                                                                                                                                                                                                                                                   |
| 工坊管线                                                              | `src/components/workshop/**`、`src/lib/workshop/**`                                                                                                                                                                             | §5                                                                                                                                                                                                                                                                       |
| UI/逻辑分离                                                           | 视图层新增 `fetch`/`vanillaApi`/tRPC hook 时                                                                                                                                                                                    | §17（[17-UI与逻辑分离.md](docs/standards/17-UI与逻辑分离.md)）                                                                                                                                                                                                           |
| lib 层边界与门禁                                                      | `src/lib/**`（新增/移动模块、拆 `.server.ts`、共享类型给视图层）                                                                                                                                                                | §18（[18-lib层规范.md](docs/standards/18-lib层规范.md)）；分层由 `eslint.config.js` 的 `boundaries` 强制，Node-only 声明由 `scripts/lib-node-only-scan.mjs` + `tests/lib-node-only-declarations.test.ts` 强制（§18.4），文件长度棘轮 `check-file-structure.cjs --strict` |
| lib 子域归属                                                          | `src/lib/**`（新增模块、新建子域目录、搬目录）                                                                                                                                                                                  | §12.5.3 + §18.14；门禁 `check-file-structure.cjs` 的 R13′/R14                                                                                                                                                                                                            |
| 跨平台动作（新增/删除 `.ps1` 或 `.mjs` 入口、改 `package.json` 脚本） | `package.json`、`tools/**`、`scripts/*.ps1`、`scripts/*.mjs`                                                                                                                                                                    | §9.5（[launch-and-build.md](docs/standards/launch-and-build.md) 的**跨平台动作对照表**）+ §12.8；门禁 `scripts/check-ps1-consistency.mjs`                                                                                                                                |
| 跨平台行为 / 端口与文档                                               | 新增按平台分叉的逻辑、改动 `src/lib/process/kill-process-tree.ts` / `launch-path.ts` 的平台判据、动 `scripts/app-port.mjs` 或 `src-tauri/`（Cargo 的 windows/gate、sidecar 命名、shell 插件）、**在文档/README 里写具体端口号** | §1.1、§3.1、§3.3、§9（[launch-and-build.md](docs/standards/launch-and-build.md)）；端口「两条链路」见 [reference-facts.md](docs/reference-facts.md) §1.1                                                                                                                 |
| 构建与打包                                                            | `scripts/build-desktop.mjs`、`tools/**`                                                                                                                                                                                         | §7、§8                                                                                                                                                                                                                                                                   |
| 复用/去重与常量收口                                                   | 抽共享模块、加/改默认地址与端口、写新的质量门禁、**动手前查有无现成实现 / 缺能力补地基**                                                                                                                                        | §12.18（复用优先·写之前先查）、§12.12（跨文件重复）、§12.13（函数长度）、§12.14（端点收口）                                                                                                                                                                              |

## 硬规则（违反 = 提交被拒或必须回滚）

1. **包管理只用 pnpm**（`pnpm exec …`）。禁止 npx / npm run——npm 11.19 在本机
   解析 typescript 别名链会崩溃（`Class extends value undefined`）。
2. **工具链钉死项不可随意改**（改动前必须读规范 §6 并在提交说明里给出理由）：
   - `pnpm-workspace.yaml`：`minimumReleaseAge: 0`、`allowBuilds`（6 个包）、
     `verifyDepsBeforeRun: false`
   - `next.config.js`：`experimental.useTypeScriptCli: false`
3. **进程清理必须杀整棵树，平台判据只收两处**：Node/TS 侧一律经 `src/lib/process/kill-process-tree.ts` 的 `killProcessTree()`；非 TS 宿主走命令行入口 `scripts/reap-process.mjs`；Rust 壳侧起子进程只能用官方 `tauri-plugin-shell` 的 `CommandChild`（退出整树回收同样转交 `reap-process.mjs`）。禁止各处自写 `taskkill` / `process.kill` / `Process.Kill()` / 单杀 leader / `std::process::Command` + `taskkill`（后者在 POSIX 上等于什么都不做）。**POSIX 自建进程组是前提**：`spawn({ detached: true })`。跨平台机制、防自杀判据、孤儿事故根因见 launch-and-build §3.1–§3.3。
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
   `cargo test`（壳里 37 条 `#[test]` 唯一的执行者）；触发面与 mtime 边界见规范 §11.10.4。
6. **不在 `master` 上直接提交，一切变更走分支 + PR**（ISSUE #492）：两层防线 = 平台**分支保护设置**（拦 push、放行 PR 合并）+ `.githooks/pre-commit` 开头的组 0「master 分支提交守卫」`scripts/check-branch-guard.cjs`（拦本地提交）。**判据是 HEAD 父提交数**：`master` 上 ≤ 1 = 直连主干阻断，> 1 = PR 合并放行（只查分支名会把合并一起拦掉）。`check-branch-guard.cjs` 的 `--pr-check` / `--merge-commit` 两个**服务端形态作为判据本身保留**，但随 ISSUE #623 与 `.cnb.yml` 一同失去调用方（§13.5）——**目前不再有 CI 兜底**。**平台层禁用 `git create-branch-lock`**（锁整分支写入会把 PR 合并一起拦死）。误提交到本地 `master` 时：`git branch feat/<描述>` → `git reset --hard origin/master` → `git checkout feat/<描述>` → 推送开 PR。三种拓扑回归见 §13.6.1。
7. **提交必须通过 `.githooks/pre-commit`**（分支守卫 + 结构检查 + tsc + eslint +
   UI/逻辑分离棘轮 + 结构守护与受影响用例 + CHANGELOG 碎片，全部走 `pnpm exec`）。
   测试那一层是「改到哪、测到哪」的增量层（固定清单 + 暂存改动沿**静态 import 图**
   追溯到的用例，判据与**已知边界**见 §13.5.8）——运行时拼出来的路径抓不到、也不是
   全量，全量仍由 `pnpm test` / `pnpm check:all` 负责。钩子失败先修代码，
   禁止 `--no-verify` 绕过进历史。钩子由 `pnpm install` 自动接上
   （`package.json` postinstall → `scripts/install-git-hooks.mjs` 写
   `core.hooksPath=.githooks`）；未生效时手动 `git config core.hooksPath .githooks`。
8. **新增含 postinstall 构建脚本的依赖**：同步更新 `pnpm-workspace.yaml`
   的 `allowBuilds`，否则非交互模式 `pnpm install` 会 exit 1。
9. **dev server 运行期间不要执行 `pnpm install`**（better-sqlite3 等原生模块（`.node`）被进程
   锁定会 EPERM 连锁失败）。
10. **视图层不得新增 IO**：`src/components/**`、`src/app/**`（除 `api/`）里不允许新写
    `fetch(`、`vanillaApi.*`、`api.x.y.useQuery/useMutation`——逻辑要进
    `<feature>/hooks/`，网络层一律进 `src/lib/<domain>-client.ts`（守卫只豁免
    `hooks/` 目录，`components/<feature>/*-api.ts` 会被计为违规）。守卫脚本
    `scripts/check-ui-logic-separation.cjs`（棘轮只许降不许升，已接入 pre-commit）。
    治理后必须 `node scripts/check-ui-logic-separation.cjs --update` 收紧基线。
11. **`src/lib` 是域化的：根目录只放顶层单例，模块一律进子域**（ISSUE #565 / §12.5.3 / §18.14）：新增子域必须**同批**登记 `scripts/check-file-structure.cjs` 的 `DOMAINS` 与 `DOMAIN_EXEMPT`（R14）**并**在 `vitest.config.ts` `thresholds` 里按**实测值**设门槛（§18.6）——只做一件 = 门槛挂在判据不认识的目录上、或新域零门槛。叶子域平铺，**不要再造 `admin/` `other/` `shared/` 这类杂物层**。门禁 R13′/R14 跑在 pre-commit 的 D 组「文件结构硬规则(R1-R12，R5 棘轮硬闸)」这一步。**迁移目录连带五查**（import 说明符含 `vi.mock` / `await import` / 门禁白名单 / 测试夹具假路径 / `path.resolve(__dirname, …)` / 规范与碎片里的路径引用），完整清单见 §12.5.3。

12. **禁用 `.bat` / `.cmd` / `.vbs` 入口，Windows 入口一律 `.ps1`；编排只写 Node（`.mjs`），`.ps1` 只是调用入口**（ISSUE #23 / §8）：`scripts/dev-launcher.mjs` 是**全平台唯一**的启动编排者（端口 / 缓存指纹 / 进度快照 / 回收语义全在这里，平台机制收在 `scripts/launcher-core/**` 与 `kill-process-tree`）；`scripts/dev-launcher.ps1` 只做「定位项目根 → 调用它 → 透传退出码」，**不得**再长出任何 Windows 专属编排（`taskkill` / `Get-CimInstance` / Job Object / `cmd.exe`），长度与内容由 `tests/cross-platform-launcher.test.ts` 守着。**入口放 `tools/<分类>/`，不放仓库根**（ISSUE #29 / §8.6）：启动类归 `tools/start/`，与 `tools/build/`、`tools/registry/`、`tools/studio/` 按用途并列；R9 在 pre-commit 强制拦截。**跨平台动作 = 写 `.mjs` 逻辑 + 挂 `package.json` 脚本 + 登记 §9.5 对照表**（`check-ps1-consistency.mjs` 在 pre-commit 核对，只写一侧会被拦）；`.ps1` 不是逻辑层，也不代表仓库只能在 Windows 用。含中文的 `.ps1` 必须 **UTF-8 with BOM**（无 BOM 会被 PowerShell 5.1 按 GBK 解码，与 `.bat` 乱码同源）。入口设计原则、禁 `.bat` 的 GBK 代码页根因、`KNOWN_FAILED_FILES` 与 R7/R8/R9 的具体判据见 §8.1–§8.4 与 `tests/check-file-structure.test.ts`。
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
15. **改动任何文件前必须完成「改动前必读文档」前置阅读**（见本文件对应章节）：
    未读 `README.md` / `docs/README.md` / 本文件全文就动手 = 违规；
    命中「强制先读规范文档的改动范围」表或相关规范章节时，须读完对应章节
    并在提交/实施说明里注明遵循了哪些条目。把「先看文档再改代码」当默认动作，
    不凭项目外部经验或旧记忆猜测本仓库约定。

16. **构建期模块图上的模块：模块级副作用先判就绪、源码保持纯 ASCII**（ISSUE #489 / §5）：任何「加载即读库」的副作用都必须先过 `src/lib/db-schema-ready.ts` 的 `isSchemaReady()`——历史实例是 `src/lib/comfyui/reaper.ts` 经 `enqueue.ts` 的裸 `import "./reaper"` 挂在启动路径上（P3 §5 ADR §14 D3 起该模块加载零副作用、由宿主显式起，但**规则本身不变**：新增「加载即读库」的副作用仍然必须先判就绪）——跳过是安全的（回收幂等、下轮重跑），「表在、查询失败」这类真故障不许被吞；会被 `next-code-frame` 渲染到的模块保持纯 ASCII（中文按字节的 code frame 高亮会触发 Rust `end byte index N is not a char boundary` panic、把整个 `next build` 打死，且偏移敏感、报错完全指不出业务原因）。**排查手法与实践细节**见 §5 排障手册对应两行；业务模块与文档不受此限，中文照常。

17. **分发产物不得携带开发机私有输入，敏感值不得明文落日志**（ISSUE #489 / §7.3、07 §7.18.2.1）：`next build` 会**无条件**把仓库根 `.env` 与 `db.sqlite` 复制进 `.next/standalone`（**`outputFileTracingExcludes` 在 Turbopack 这条链上不做减法**——`./changelog.d/**`、`./src/**/*.test.ts`、`./src-tauri/**` 甚至 `./db.sqlite` 都写在清单里，产物根仍有对应真文件；A/B 已量清是 **Turbopack 不读这份键**，webpack 下整目录条目确实归 0，但 `.env` / `data/`（含密钥）/ `log/` 照旧进来，而运行时脚本清单点名的是 `*-turbo.runtime.prod.js`，**所以换构建器不是出路**），进而被 `build-desktop` 内嵌进桌面包——**密钥明文分发**；防线在产物层：`scripts/standalone-private-inputs.mjs`（`pnpm build` 收尾与 `build-desktop.mjs` 各剥一次；减法要**递归按形状**、且**不穿符号链接**——standalone 的 `node_modules/<pkg>` 是指向开发机 pnpm store 的链接，穿链接删等于损坏依赖，§7.2 第六件事）+ `scripts/check-standalone-contents.cjs`（真数产物，计数口径同样不穿链接；**这道判据从 #1217 起接进了 `pnpm build` 收尾**，顺序是 减法 → 数产物 → 冒烟）。**两层顶层都是默认拒绝**（`STANDALONE_ALLOWED_TOPLEVEL` / `STATIC_ALLOWED_TOPLEVEL`，判据侧同名清单逐字同源由用例核对）：只允许运行时必需那几件，`src` 不在任何一层（只有 `RUNTIME_SRC` 逐文件放行的那一个），新增一项必须同改两处并写清「谁在运行期读它」。同一条通道还带开发期文件与整套内部门禁脚本（`AGENTS.md` / `CHANGELOG.md` / `README.md` / 各 `*.config.*` / 整个 `scripts/`）——`scripts/` 走白名单 `RUNTIME_SCRIPTS`（只有运行时真会读的那几份留下），根级文件走黑名单；**新增脚本默认不进产物**，要留下必须登记并说明理由。日志侧：pino `redact` 只保护它自己那一路，ERROR 镜像（`app-runtime.log`）走另一条独立通道、不受保护——镜像不许整包 `JSON.stringify` payload，只能输出文本/键名并经值形状守卫 `redactSecretShaped()`；`REDACT_PATHS` 加 `*secret` 类通配实测无效（pino 不支持部分字符串匹配）。写日志类用例给**自己的临时目录**，别让 `pnpm test` 往仓库 `log/` 写字。机制与实测数据见 §7.3 与 07 §7.18.2.1。

18. **standalone 产物必须含 Next 自带运行时脚本，缺件的表现是「页面正常、接口全 500」**（ISSUE #489 / §7.4）：Turbopack 对 `require("next/dist/compiled/next-server/<name>.runtime.prod.js")` 这类**动态 require 字符串**追踪不完整——只追到被 middleware 图带上的 `app-page-turbo`，所有 `route.ts` 都要的 `app-route-turbo` 一条 nft 都没有，运行时表现是**每个 API 路由 500**（`Failed to load external module`）而页面全 200。防线是 `next.config.js` 顶层的 **`outputFileTracingIncludes`**（`./node_modules/next/dist/compiled/next-server/*runtime.prod.js`；**别往 `outputFileTracingExcludes` 里加**，excludes 只做减法、补不回缺件）。两层门禁：`tests/standalone-runtime-completeness.test.ts` 锁配置 + `check-standalone-contents.cjs` 真数产物——**产物要数两层**（`.next/standalone` 与被 `build-desktop` 整树解引用拷贝、剪枝之后的 src-tauri/static 产物目录），因为组装发生在这道检查之后，真正内嵌进 exe 的是后者，「构建期过了」推不出「出厂件也在」。长期潜伏的原因见 §7.4。

19. **源码禁止内嵌控制字符（NUL 等），哨兵必须用可打印形式**（§12.11 / 门禁 R12）：源码里带一个真的 NUL 字节会让**整个文件**被 git / diff / grep / 多数编辑器判成二进制（`git diff` 只回「Binary files differ」、`grep -rn` 静默跳过），本地钩子还全绿——评审看不到改动。这类 NUL 几乎都来自「拿 NUL 当占位符哨兵」；要表达 NUL 写转义 `"\u0000"`。选哨兵形状时列清「接下来还要跑的每一组正则」、一个都不命中、且用户内容伪造不出同形状。R12 按码位扫 `src/**` 的 `.ts`/`.tsx`（豁免只有制表 / 换行 / 回车）、跑在 pre-commit 的 D 组「文件结构硬规则(R1-R12，R5 棘轮硬闸)」这一步；实例修复与哨兵形状选择的完整判据见 §12.11。

20. **禁止跨文件复制实现（孪生对），默认地址不得各处硬编码**（ISSUE #536 / §12.12、§12.14）：逐行重合 ≥75% **且** 两边 ≥60 行即判定为孪生，由 `scripts/check-code-duplication.cjs` 阻断（棘轮 `scripts/.code-duplication-baseline.json`）；修法是**抽共享模块让两边只留差异**（不是「两边一起改」），共享内核里不许放任何一侧的传输层代码（`server-only` / Next 落盘 / 纯 Node 读文件都由入口注入）。本机默认端口与回环地址只在 `src/lib/endpoints.ts` 定义一次，别处一律 import；回环主机写 `127.0.0.1` 不写 `localhost`（Node fetch 会先解析成 `::1`）。

21. **函数长度阈值 400 行进拆分候选、按文件计数走棘轮**（ISSUE #536 / §12.13）：`scripts/check-function-length.cjs` 阻断「新增巨型函数」（棘轮 `scripts/.function-length-baseline.json`，只许降不许升）。**Rust 壳同维度阈值 120 行**（`scripts/check-rust-function-length.cjs` 扫 `src-tauri/src/**`，棘轮 `.rust-function-length-baseline.json`；结构化编排的自然长度比 TSX 短）。R5 管**文件**行数、本条管**函数**行数，两条维度不可互相替代。括号只认 `()` `{}` `[]`（`<` `>` 会把 TSX 泛型 / JSX 标签的深度漂负、函数尾永远找不到 = 静默漏报）；Rust 特有的 `r#"…"#` 原始字符串与 `'` 两义性（字符字面量 vs 生命周期）已在状态机里处理，细节见 §12.13 / §12.13.1。

22. **`src/lib` 是门禁的一等公民，不是盲区**（ISSUE #575 / §18）：**lib 不得 import 视图层**（`src/components/**`、`src/app/**`）——`lib` 是被 `components` / `app` / `server` 共同依赖的地基；需要共享的类型下沉到 `src/lib` 下的类型模块（实例：`src/lib/workflow/workflow-io-types.ts`）。由 `eslint.config.js` 的 `boundaries` 强制，**元素顺序是语义**（`src/lib/core/**` 等数据层须排在 `src/lib/**` 之前，见 §18.3）。**Node-only 三选一，不许「都没有」**（§18.4）：全部出口只能服务端用 → `import "server-only"`；同领域服务端拆件 → `.server.ts`；纯 Node 宿主（由 `scripts/*.mjs` 动态加载，如 `src/lib/process/kill-process-tree.ts`）→ 两者都不加（给它加 `server-only` 会让启动编排直接崩，`server-only` 入口就是 `throw`）。**新增守卫前先查是否已有更强的一条**：客户端打包安全已由 `tests/client-bundle-node-builtins.test.ts`（从 `"use client"` 入口 DFS 可达性 + 完整引用链）守住，别再写「检查有没有 `server-only`」的第二判据。**R5 超 900 行文件走棘轮**（`--strict` 下新增 / 变大即阻断；**pre-commit 的这一步带的就是
    `--strict`**，ISSUE #1404 之前它是「只提醒」且硬闸档没有执行者），基线 `scripts/.file-size-baseline.json`。

23. **注释语言：一律中文**（ISSUE #678，机器强制）：业务代码、测试、脚本（`.ts` / `.tsx` / `.mjs` / `.cjs` / `.ps1` / Rust）里的注释统一写中文。**唯一例外**：会被 `next-code-frame` 渲染到的构建期模块（硬规则 16 那批）保持纯 ASCII + 英文注释，并在文件头一条说明原因。白名单登记在 `docs/reference-facts.md` 的 `comment.language.asciiOnly` 一行，由 `pnpm doc:check` 核对；判据、例外语义与自查入口见 §12.4.6 与 §9.6。

24. **复用优先：写之前先查、缺能力补地基，不造第二轮子**（§12.18）：动手写一段新逻辑前，先花一次 grep 的代价回答「这能力是不是已经有了、或本该有」——有等价 / 更通用的实现就 import（缺的差异用参数或薄封装补，**不在调用点重抄**）；没有、但属跨模块通用能力（格式化 / 单位换算 / 端口与地址 / 错误信封 / 进程与路径 / 重试与超时…）就补进对应地基（`src/lib/<domain>` 或 `core`）写一次 + 配单测，调用点 import；确认是这一处独有的业务才就地写。补地基的门槛是**真通用**（≥2 个现有调用点、或明确马上有第 2 个）；只有 1 个又看不出第二个的，先就地写、别急着抽象（§12.15 第三条）。地基里不放任何一侧的传输层代码（§18.4 / §12.12）。**分工**：本条管**落笔时的取向**；事后回潮由 §12.12（字面孪生 ≥75%）/ §12.14（端点收口）/ §12.16（零消费导出）机器兜底——**别再为其新写「抓该不该通用」的启发式扫描器**（会误报一片、本身就成了「会静默失效的清单」，那是用造轮子的方式反造轮子）。

## 快速排障

被提交门槛拦下时，先看报错指出的规范章节（分支守卫 → §13.6.1、文件结构 / 命名 → §12.8、源码控制字符 → §12.11、跨平台动作对照 → §9.5、CHANGELOG 碎片 → §13.10.5），**不要用 `--no-verify` 换一条干净历史**。

**报错指向的文件你根本没碰过 → 先复算 master 基线再怀疑自己**：PR 在平台侧是 squash 合并、不跑本地钩子，而 #623 之后已无 CI 兜底，所以硬闸违规可以直接落进 `master` 成为所有人的基线（棘轮类有数字可记账，**硬闸类须为 0、没有「带病通行」的中间态** → 一旦落地就拦住从它分出的每一个提交）。复算手法与处置口径见 §13.6.2（`git worktree add ../.wt-base-check cnb/master` → 在干净基线上跑同一条门禁 → 同样命中即别线的红，不许你为它放宽判据）。

启动 / 构建 / 产物层的**症状 → 已知根因**、日志顺序、端口「解析链 vs 静态链」、corepack 三形态、`dev.mjs` 静默 `exit=0`、启动页被 Explorer 压后……**全部收在 [`docs/standards/launch-and-build.md`](docs/standards/launch-and-build.md) §5 排障手册**（本项目全部历史事故都在里面）。按需定位：端口两条链与 `dev.port.derived` 判据见 §1.1（`pnpm doc:check` 已核对，文档里不要写死 3100）；`.env` 三项非空 → `scripts/env-preflight.mjs` + 哨兵表 → `scripts/db-schema-state.mjs` 两条预检挂在 `dev.mjs` / `start.mjs` 起 Next 之前，见 §9.1 / §9.2 第 6 条；corepack 三形态探测、`whichCommand()` / `usableCommand()` 判据、`pnpm check:toolchain` 自查入口见 §2.1.1–2.1.4；「`✓ Ready` 后两秒 `exit=0`」的内层 `pnpm.cmd` 拼法事故与 `pnpmInvocation()` 唯一入口见 §2.1.6；启动页 vs 应用窗的前台归属（`spawn_splash_front()` / `bring_splash_to_front()`）见 §1.3。**日志按 §4 布局看** `log/` 分区（`launcher/` → `nextjs/` → `services/` → `tools/` → `archive/`）。改完构建 / 产物相关的东西，先跑 `node scripts/check-standalone-contents.cjs`（同时查「不该有的」与「必须有的」）。**用例红先定性再改**：`pnpm exec vitest run --no-file-parallelism <文件>` 隔离重跑，串行也红才是真红；串行绿的是预算 / 并发问题（预算与 `maxWorkers` 的实测出处见 §11.13，不要靠继续抬超时掩盖）。

## 维护约定

- 修出新的启动/构建故障后：先更新规范文档 §5 对照表与相关章节，再提交修复。
- 规范文档与本文件必须同步演进：改了规范文档的硬规则，同步改这里的摘要。
- 新增 / 重命名 / 删除规范文档后：同步更新本文件「改动前必读文档」的定位指引
  与「强制先读规范文档的改动范围」表，保证代理总能据最新文档索引找到对应章节。
