# AGENTS.md — AI 协作强制规范

> 本文件会被编码代理（ZCode、CodeBuddy 等）在会话开始时自动加载。
> **改动前先读项目文档是硬约束，不是建议**：任何代理在改动任何文件
> （代码 / 配置 / 脚本 / 文档 / 依赖）之前，必须先完成下方「改动前必读文档」
> 的前置阅读，再按改动范围命中「强制先读规范文档的改动范围」表时完整阅读
> 对应规范章节，并在实施说明中注明遵循了哪些条目。

## 改动前必读文档

任何改动动手前，先按序完成下列前置阅读（缺一视为违规）：

1. `README.md` — 项目是什么、技术栈、目录结构、常用命令与入口。
2. `docs/README.md` — 文档中心统一索引：主规范与 standards 文档集（01~17 章）、
   各指南、冲突裁决链与「改动前先看对应章节」的定位方法。
3. 本文件（`AGENTS.md`）全文——尤其下方「硬规则」与「强制先读规范文档的改动范围」表。

按改动范围快速定位规范章节：
- 前端业务 / 组件 / 状态 / 性能 / 类型 / 样式 / 测试 → `docs/standards/README.md`
  总览，按主题进入 `docs/standards/01~17` 对应章节；
- 启动链路 / Tauri 壳 / 构建打包 / ComfyUI 生命周期 → `docs/standards/launch-and-build.md`
  （§4.3「陈旧实例：运行图落后于源码」= 长开窗口 + 拉新代码导致的白屏及其通知；
  改 store 动作、或新增会被已挂载实例调用到的模块时必读；用户侧说明见
  `docs/guide-stale-code.md`）；
- 提交 / PR / 自查清单 / 分支策略 → `docs/standards/13-提交与-code-review.md`
  （§13.1 自查清单、§13.5 门禁、§13.6 分支与合并、§13.6.1 master 提交守卫）；
- 不确定读哪些 → 先读 `docs/standards/15-附录.md` §15.5「新成员 10 分钟速读路径」建立全局认知。

> 判断标准：改动被「强制先读规范文档的改动范围」表或本清单覆盖但未先读就动手 = 违规，
> 提交会被拒或要求回滚。

## 强制先读规范文档的改动范围

| 范围 | 路径 | 规范章节 |
|---|---|---|
| 启动链路 | `start-tauri/`、`scripts/start_tauri_launcher.py`、`scripts/dev-launcher.ps1` | §1–§3 |
| Windows 双击入口 | `tools/<分类>/*.ps1`（启动类 `tools/start/`）、`scripts/entry-common.ps1` | §8 |
| Tauri 壳 | `src-tauri/**`（conf.json / src / splash-assets） | §2、§7 |
| ComfyUI 生命周期 | `src/lib/comfyui/**`（lifecycle / executor-* / reaper） | §3、§5 |
| 工坊管线 | `src/components/workshop/**`、`src/lib/workshop/**` | §5 |
| UI/逻辑分离 | 视图层新增 `fetch`/`vanillaApi`/tRPC hook 时 | §17（[17-UI与逻辑分离.md](docs/standards/17-UI与逻辑分离.md)） |
| 跨平台行为 / 端口与文档 | 新增按平台分叉的逻辑、改动 `src/lib/kill-process-tree.ts` / `launch-path.ts` 的平台判据、动 `scripts/app-port.mjs`，或**在文档/README 里写具体端口号** | §1.1、§3.1、§9（[launch-and-build.md](docs/standards/launch-and-build.md)）；端口「两条链路」见 [reference-facts.md](docs/reference-facts.md) §1.1 |
| 构建与打包 | `scripts/build-desktop.mjs`、`tools/**` | §7、§8 |
| 复用/去重与常量收口 | 抽共享模块、加/改默认地址与端口、写新的质量门禁 | §12.12（跨文件重复）、§12.13（函数长度）、§12.14（端点收口） |

## 硬规则（违反 = 提交被拒或必须回滚）

1. **包管理只用 pnpm**（`pnpm exec …`）。禁止 npx / npm run——npm 11.19 在本机
   解析 typescript 别名链会崩溃（`Class extends value undefined`）。
2. **工具链钉死项不可随意改**（改动前必须读规范 §6 并在提交说明里给出理由）：
   - `pnpm-workspace.yaml`：`minimumReleaseAge: 0`、`allowBuilds`（6 个包）、
     `verifyDepsBeforeRun: false`
   - `next.config.js`：`experimental.useTypeScriptCli: false`
3. **进程清理必须杀整棵树**：Node 侧一律经 `src/lib/kill-process-tree.ts` 的
   `killProcessTree()`（平台判据收在该模块，禁止在各处自己写 `taskkill` /
   `process.kill`）：Windows 走 `taskkill /PID <pid> /T /F`，POSIX 向进程组发
   信号（`kill(-pid)`，拿不到组时单杀兜底）。禁止 `Process.Kill()` / 单杀
   leader（外壳死了，node/python 子进程会残留成孤儿，锁住端口与日志文件）。
4. **失败路径必须有日志 + 用户可见出口**；日志按规范 §4 的布局落 `log/`，
   不得引入新的固定名日志文件（残留进程句柄会锁死它，用按次命名 + 轮转）。
5. **改了 `tauri.conf.json` / `src-tauri/src/**` / `splash-assets/**` 必须
   `cd src-tauri && cargo build --release --features custom-protocol` 重编壳**
   （**feature 不能省**：不带它 tauri 的 `cfg(dev)` 开启，启动页会被导航到
   `build.devUrl` 且资源不内嵌——冷启动必现 Edge「无法访问此页面」错误页，
   详见规范 §5）——窗口配置与启动页是编译期内嵌的，只改源码不重编 =
   跑旧二进制（历史黑屏事故来源）。
6. **不在 `master` 上直接提交，一切变更走分支 + PR**（ISSUE #492 / 规范 §13.6.1）：
   `master` 只接受「分支开发 → PR → 评审 → 合并」。三层防线 = 平台**分支保护设置**
   （保护分支 + 禁直接 push，拦 push、放行 PR 合并）+ `.githooks/pre-commit` 第 1 步
   `scripts/check-branch-guard.cjs`（拦本地提交）+ CI `Branch guard` 步骤（拦源分支为
   `master` 的 PR）。**平台层禁用 `git create-branch-lock`**：它锁的是整分支写入，
   会把 PR 合并一起拦死（锁上后 master 无法合并任何 PR）。
   判据是 **HEAD 父提交数**：`master` 上父提交数 ≤ 1 = 直连主干，阻断；> 1 =
   PR 合并提交，放行（只查分支名会把合并一起拦掉，见规范 §13.6.1）。
   提交已在本地 `master` 上时：`git branch feat/<描述>` → `git reset --hard
   origin/master` → `git checkout feat/<描述>` → 推送开 PR。
7. **提交必须通过 `.githooks/pre-commit`**（分支守卫 + 结构检查 + tsc + eslint +
   UI/逻辑分离棘轮 + CHANGELOG 碎片，全部走 `pnpm exec`）。钩子失败先修代码，
   禁止 `--no-verify` 绕过进历史。钩子由 `pnpm install` 自动接上
   （`package.json` postinstall → `scripts/install-git-hooks.sh` 写
   `core.hooksPath=.githooks`）；未生效时手动 `git config core.hooksPath .githooks`。
8. **新增含 postinstall 构建脚本的依赖**：同步更新 `pnpm-workspace.yaml`
   的 `allowBuilds`，否则非交互模式 `pnpm install` 会 exit 1。
9. **dev server 运行期间不要执行 `pnpm install`**（better-sqlite3 等原生模块（`.node`）被进程
   锁定会 EPERM 连锁失败）。
10. **视图层不得新增 IO**：`src/components/**`、`src/app/**`（除 `api/`）里不允许新写
   `fetch(`、`vanillaApi.*`、`api.x.y.useQuery/useMutation`——逻辑要进
   `<feature>/hooks/`，网络层一律进 `src/lib/<domain>-client.ts`（守卫只豁免
   `hooks/` 目录，`components/<feature>/*-api.ts` 会被计为违规）。守卫脚本
   `scripts/check-ui-logic-separation.cjs`（棘轮只许降不许升，已接入 pre-commit 与 CI）。
   治理后必须 `node scripts/check-ui-logic-separation.cjs --update` 收紧基线。
11. **禁用 `.bat` / `.cmd` / `.vbs` 入口，Windows 入口一律 `.ps1`**（ISSUE #23 / 规范 §8）。
    **入口放 `tools/<分类>/`，不放仓库根**（ISSUE #29 / 规范 §8.6）：启动类归
    `tools/start/`，与 `tools/build/`、`tools/registry/`、`tools/studio/` 按用途并列；
    根目录只留工程配置与文档。R9 在 pre-commit 强制拦截，回归测试见
    `tests/check-file-structure.test.ts`。
   理由：cmd.exe 走系统 ANSI（GBK）代码页，中文提示与子进程 UTF-8 输出必然乱码，
   历史上被迫把入口做成「不含中文、不含逻辑」的哑壳。新增入口规则：
   - 入口只做「定位项目根 → 调用逻辑脚本 → 收尾」，逻辑下沉到 `scripts/` 或
     `tools/scripts/`，公共能力复用 `scripts/entry-common.ps1`；
   - 含中文的 `.ps1` 必须 **UTF-8 with BOM** 保存（无 BOM 会被 PowerShell 5.1
     按 GBK 解码，与 `.bat` 乱码同源）；
   - R7/R8 由 `scripts/check-file-structure.cjs` 在 pre-commit 强制拦截，
     回归测试见 `tests/check-file-structure.test.ts`。
12. **注释里禁止「历史流水」**（ISSUE #46 / 规范 §12.4.2 / 反模式表 G4）：
    日期（`2026-08-17`）、改动编号（`R-ardot114` / `R83` / `R-Next`）、
    任务批次号（`T12-3`）—— 这些归 `git log`，写进注释会随代码搬迁过期失真。
    由 `scripts/check-file-structure.cjs` 的 **R10** 在 pre-commit 强制拦截，
    回归测试见 `tests/check-file-structure.test.ts`。
13. **变更日志只写 `changelog.d/` 碎片，不直接改 `CHANGELOG.md`**（ISSUE #408 / 规范 §13.10.5）：
    `CHANGELOG.md` 的 `[Unreleased]` 是全仓库唯一「人人都改同一处」的文件，并行分支必然冲突。
    条目写 `changelog.d/<issue号>-<slug>.md`（一件变更一个文件，首行标 `## Added` / `## Fixed` 等段落），
    由 `node scripts/merge-changelog-fragments.mjs` 在发版/整理时并入。
    形态由 `scripts/check-changelog-fragments.cjs` 在 pre-commit 与 CI 强制拦截，
    回归测试见 `tests/check-changelog-fragments.test.ts`。
14. **改动任何文件前必须完成「改动前必读文档」前置阅读**（见本文件对应章节）：
    未读 `README.md` / `docs/README.md` / 本文件全文就动手 = 违规；
    命中「强制先读规范文档的改动范围」表或相关规范章节时，须读完对应章节
    并在提交/实施说明里注明遵循了哪些条目。把「先看文档再改代码」当默认动作，
    不凭项目外部经验或旧记忆猜测本仓库约定。

15. **构建期模块图上的模块：模块级副作用不得直接读库，且源码保持纯 ASCII**（ISSUE #489 / 规范 §5）：
    - **模块级副作用先判就绪**：`pnpm build` 的 collect-page-data / prerender 阶段会为每条路由
      起 worker 加载模块图，而干净检出（CI / 新克隆）没有 `db.sqlite`。任何「加载即读库」的副作用
      （现有：`src/lib/comfyui/reaper.ts`，由 `enqueue.ts` 裸副作用导入挂在启动路径）都会在
      build 期抛 `no such table: …`，把构建打死且报错行号落在无关路由上。新增此类副作用必须先过
      `src/lib/db-schema-ready.ts` 的 `isSchemaReady()`；跳过是安全的（回收幂等、下轮重跑），
      但「表在、查询失败」这类真故障不许被吞。
    - **会被 code frame 渲染到的模块写纯 ASCII**：Next 的 `next-code-frame` 按**字节**切串，
      高亮区间端点落在多字节字符（中文 3 字节）内部时 Rust 侧直接 panic
      （`end byte index N is not a char boundary`），整个 `next build` 被 `Error: Panic in async function`
      带走，且报错完全指不出业务原因。触发偏移敏感 —— 同一文件删掉中文能过、换个长度的中文又能复现。
      实践口径见规范 §5 对应两条；业务模块与文档不受此限，中文照常。

16. **分发产物不得携带开发机私有输入，敏感值不得以明文落日志**（ISSUE #489 / 规范 §7.3、07 §7.18.2.1）：
    - `next build` 会把仓库根的 `.env` 与 `db.sqlite` 复制进 `.next/standalone`，
      进而被 `build-desktop` 内嵌进桌面包 —— **密钥明文分发**，且壳以
      `current_dir(res_dir)` 起 sidecar、db 路径按 `process.cwd()` 解析，被带进包的
      开发库就是应用首次启动读写的那个。守卫在**产物层**：`pnpm build` 的收尾步骤
      （`scripts/standalone-private-inputs.mjs`）与 `scripts/build-desktop.mjs` 都会剥离，
      `scripts/check-standalone-contents.cjs` 真数产物。**`outputFileTracingExcludes`
      对 `.env` 实测无效**（Next standalone 无条件复制），别只加 excludes 就当修好。
    - 日志脱敏有**两条落盘通道**：pino 的 `redact` 只管它自己的输出流，ERROR 镜像
      （`app-runtime.log`）走另一条路径、不受保护。镜像**不许整包 `JSON.stringify`**
      payload，只能输出文本 / 键名，并经值形状守卫 `redactSecretShaped()`。
      **别往 `REDACT_PATHS` 加 `*secret` 类通配** —— pino 不支持部分字符串匹配，实测无效。
    - 写这类用例时给**自己的临时目录**（镜像/日志是真实写盘副作用），别让
      `pnpm test` 往仓库 `log/` 里写字。
    - 同一条通道还带**开发期文件与整套内部门禁脚本**（`AGENTS.md` / `CHANGELOG.md` /
      `README.md` / 各 `*.config.*` / 整个 `scripts/`）。`scripts/` 走**白名单**
      （`RUNTIME_SCRIPTS`：只有运行时真的会读的那两份留下），根级文件走黑名单；
      产物层由 `check-standalone-contents.cjs` 的 `ALLOWED_SCRIPTS` 同款守。
      **新增脚本默认不进产物**，要留下必须登记并说明理由。

17. **standalone 产物必须包含 Next 自带运行时脚本，缺件的表现是「页面正常、接口全 500」**（ISSUE #489 / 规范 §7.4）：
    - Turbopack 对 `require("next/dist/compiled/next-server/<name>.runtime.prod.js")`
      这类**动态 require 字符串**的追踪不完整：只追到被 middleware 图带上的
      `app-page-turbo`，所有 `route.ts` 都要的 `app-route-turbo` 一条 nft 都没有。
      运行时表现是**每个 API 路由 500**（`Failed to load external module`），
      而构建期静默、页面全 200 —— 极易被误判成业务/数据库/鉴权问题。
    - 防线只能靠 `next.config.js` 顶层的 **`outputFileTracingIncludes`**
      （`./node_modules/next/dist/compiled/next-server/*runtime.prod.js`）。
      **别往 `outputFileTracingExcludes` 里加**：excludes 只做减法，补不回缺件。
    - 「没有任何常规门禁会启动 standalone」是这条长期潜伏的原因：CI 只跑 `pnpm build`，
      而 `next start` 与 `output: standalone` 不兼容。所以门禁是**两层**——
      `tests/standalone-runtime-completeness.test.ts` 锁配置，
      `check-standalone-contents.cjs` 真去数产物里的必需文件。

17. **源码里禁止内嵌控制字符（NUL 等），哨兵必须用可打印形式**（规范 §12.11 / 门禁 R12）：
    源码里带一个真的 NUL 字节，会让**整个文件**被 git / diff / grep / 多数编辑器判成
    二进制 —— `git diff` 只回「Binary files differ」（评审看不到改动）、`git show --stat`
    显示 bin、`grep -rn` 静默跳过整个文件，而 CI 全绿（tsc / eslint / vitest 都读得动
    这个字节）。这类 NUL 几乎都来自「拿 NUL 当占位符哨兵」，本仓库的实例是
    `src/lib/comfyui/markdown.ts` 的行内代码暂存（`\0CODE<n>\0` → 已改 `<n>`）。
    要表达 NUL 写转义 `"\u0000"`；选哨兵形状时列清「接下来还要跑的每一组正则」，
    确认一个都不命中、且用户内容伪造不出同形状。门禁 `scripts/check-file-structure.cjs`
    的 R12 按码位扫 `src/**` 的 `.ts`/`.tsx`（豁免只有制表符 / 换行 / 回车），
    pre-commit 第 2 步与 CI `File structure rules` 各跑一次。

18. **禁止跨文件复制实现（孪生对），默认地址不得各处硬编码**（ISSUE #536 / 规范 §12.12、§12.14）：
    - 同一段逻辑**逐行重合 ≥75% 且两边都 ≥60 行**即判定为「孪生」，由
      `scripts/check-code-duplication.cjs` 阻断（棘轮 `scripts/.code-duplication-baseline.json`）。
      修法是**抽共享模块让两边只留差异**，不是「两边一起改」；共享内核里不许放任何
      一侧的传输层代码（`server-only` / Next 落盘 / 纯 Node 读文件都由入口注入）。
    - 本机默认端口与回环地址只在 `src/lib/endpoints.ts` 定义一次，别处一律 import
      （回环主机写 `127.0.0.1` 不写 `localhost`：Node fetch 会先解析成 `::1`）。

19. **函数长度超 400 行即进拆分候选，按文件计数走棘轮**（ISSUE #536 / 规范 §12.13）：
    `scripts/check-function-length.cjs` 阻断「新增巨型函数」（棘轮
    `scripts/.function-length-baseline.json`，只许降不许升）。R5 管**文件**行数、
    本条管**函数**行数，两条维度不可互相替代。括号配对只认 `()` `{}` `[]`——
    把 `<` `>` 算进去会让 TSX 里的泛型/JSX 标签把深度漂负、函数尾永远找不到（静默漏报）。
    **Rust 壳同一维度见 §12.13.1**：`scripts/check-rust-function-length.cjs` 扫
    `src-tauri/src/**`，阈值 **120 行**（结构化编排的自然长度比 TSX 短），棘轮记在
    `scripts/.rust-function-length-baseline.json`。Rust 特有的 `r#"…"#` 原始字符串与
    `'` 的两义性（字符字面量 vs 生命周期）已在状态机里处理。

## 快速排障

被提交门槛拦下时，先看报错指出的规范章节（分支守卫 → §13.6.1、文件结构/命名 → §12.8、
源码控制字符 → §12.11、CHANGELOG 碎片 → §13.10.5），不要用 `--no-verify` 换一条干净历史。

**端口写进文档前先分清两条链路**（ISSUE #489）：`pnpm dev` / `pnpm start` / Playwright 走
**解析链**（`.env` → 检出路径推导 3200~3999 → 兜底 3100，`scripts/app-port.mjs`），缺省拿到的是
推导值，**不是 3100**；`tauri.conf.json` 的静态 `devUrl: 3100` 属静态链（启动器 / 壳的编译期兜底），
不参与 `pnpm dev`。文档里写错的表现是致命的静默误导：照文档打开 3100 得到
`ERR_CONNECTION_REFUSED`，看起来正像「本平台跑不起来」。写法见 README「快速上手」与
[reference-facts.md](docs/reference-facts.md) §1.1，`pnpm doc:check` 已按语境核对（`dev.port.derived`）。

改完构建 / 产物相关的东西，先跑 `node scripts/check-standalone-contents.cjs`
（它同时查「不该有的」与「必须有的」）。

**起不来时先分清是「没起来」还是「起来后报错」**（ISSUE #489）：`.env` / 数据库没就绪
时**不应该**先看到 Next 的 `✓ Ready`。`pnpm dev` / `pnpm start` 现在都在起 Next 之前
做预检（`.env` 三项非空 → `scripts/env-preflight.mjs`；哨兵表 → `db-schema-state.mjs`），
未就绪即打印可行动作。若你看到「`✓ Ready` 紧跟一屏栈」，说明预检被绕过或缺失，
先按 §9.1 / §9.2 第 6 条核对。补 `.env` 用 `pnpm env:init`（跨平台；只 `cp .env.example .env`
会因三项留空而仍然起不来）。

遇到启动/生成问题，先查规范文档 **§5 症状 → 根因对照表**（本项目全部历史
事故都在里面），再按 **§4 日志布局** 的顺序看日志（log/ 按子系统分区：
`launcher/`、`nextjs/`、`services/`、`tools/`、`archive/`）：
`log/launcher/start-tauri-launcher.log` → `log/launcher/dev-launcher-stderr.log` →
`log/launcher/dev-launcher.log` → `log/nextjs/nextjs-stderr-<ts>.log` →
`log/services/comfyui-runtime.log`。

## 维护约定

- 修出新的启动/构建故障后：先更新规范文档 §5 对照表与相关章节，再提交修复。
- 规范文档与本文件必须同步演进：改了规范文档的硬规则，同步改这里的摘要。
- 新增 / 重命名 / 删除规范文档后：同步更新本文件「改动前必读文档」的定位指引
  与「强制先读规范文档的改动范围」表，保证代理总能据最新文档索引找到对应章节。
