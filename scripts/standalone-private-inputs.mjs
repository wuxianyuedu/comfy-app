/**
 * standalone-private-inputs.mjs — 从 Next standalone 产物里剥掉「开发机私有输入」
 * ===========================================================================
 *
 * 背景（ISSUE #489）：`next build` 会把仓库根的 `.env` 与 `db.sqlite` 一起复制
 * 进 `.next/standalone`。两者随 `scripts/build-desktop.mjs` 组装的
 * `src-tauri/static` 被**编译期内嵌进 exe**，后果不是「多带了个文件」：
 *
 *   1) `.env` 里的 `BETTER_AUTH_SECRET` / OAuth client secret **明文随包分发**，
 *      拿到安装包的人解包即得；
 *   2) 壳以 `current_dir(res_dir)` 启动 sidecar，而 `resolveDbPath` 按
 *      `process.cwd()` 解析 `db.sqlite` —— 被带进包的开发库**就是**应用首次
 *      启动时读写的那个库，开发者本机数据会变成出厂数据。
 *
 * 为什么不能只靠 `outputFileTracingExcludes`（实测口径）：
 *   · `db.sqlite` 加 exclude **有效**（已写进 next.config.js）；
 *   · `.env` 加 exclude **无效** —— Next standalone 的环境加载是**无条件复制**，
 *     `./.env`、`./**` 下的 `.env` 都试过，文件照旧在。所以 `.env` 只能构建后删除。
 *
 * 该模块被两处复用（单一实现，避免两份清单漂移）：
 *   · `package.json` 的 `build`：`next build && node scripts/standalone-private-inputs.mjs`
 *     —— 保证 `pnpm build` 本身产出的 standalone 就是干净的（CI 只跑 build）；
 *   · `scripts/build-desktop.mjs`：组装 static 后再清一次（兜底）。
 *
 * 直接执行时（`node scripts/standalone-private-inputs.mjs`）清理
 * `.next/standalone`；被 import 时导出 `stripPrivateInputs(dir)` 供复用。
 */
import { existsSync, lstatSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 不得随分发包出去的开发机私有输入（相对产物根）。
 *
 * `data/**` 这一组是 ISSUE #1216 摸底时量到的同类泄漏（与 `.env` 同源同性质）：
 * `src/lib/llm/secrets.ts` 把 LLM 密钥的主密钥写在 `data/llm-secret.key`、
 * `src/lib/app-settings/app-settings.server.ts` 把整机设置写在
 * `data/app-settings.json`，两者都按 `process.cwd()` 落在仓库根，于是被
 * file tracing 一起带进 `.next/standalone`，再随 `src-tauri/static` 进安装包——
 * **解包即得开发机的密钥与全部本机设置**。`data/` 目录本身是运行期按需建的
 * （两处写入方都有 `mkdirSync(..., { recursive: true })`），剔除不会改变任何行为。
 */
export const PRIVATE_INPUTS = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "db.sqlite",
  "db.sqlite-wal",
  "db.sqlite-shm",
  "data/llm-secret.key",
  "data/app-settings.json",
  // standalone 首启由 `scripts/launcher-core/standalone-runtime-env.mjs` 写进载荷根的
  // 会话签名密钥。它是**运行期产物**：跑过一次再重新打包（`tauri bundle` 不重装配）就会
  // 被当成分发内容带出去，与 `.env` 同性质。
  "data/runtime-secret.json",
];

/**
 * 从某个产物目录里删除开发机私有输入。
 *
 * @param {string} dir 产物目录（`.next/standalone` 或 `src-tauri/static`）
 * @param {(name: string) => void} [onRemoved] 每删一项的回调（用于日志）
 * @returns {string[]} 实际删掉的文件名
 */
export function stripPrivateInputs(dir, onRemoved) {
  const removed = [];
  for (const name of PRIVATE_INPUTS) {
    const p = join(dir, name);
    if (existsSync(p)) {
      rmSync(p, { force: true });
      removed.push(name);
      onRemoved?.(name);
    }
  }
  return removed;
}

/* ── 开发期文件 / 内部门禁脚本：产物级白名单剔除 ──────────────────────────
 *
 * `next build` 的 file tracing 会把仓库根的**开发文件与整套 CI 门禁脚本**一起
 * 复制进 `.next/standalone`（Turbopack 退化为「全项目追踪」的产物，见 §7.2）：
 *
 *   AGENTS.md / CHANGELOG.md / README.md           内部规范与变更史
 *   playwright.config.ts / vitest.config.ts /      开发与门禁配置
 *   typedoc.json 等
 *   scripts/**（46 个文件 / 544K，含 16 个 *.cjs 门禁脚本）+ __pycache__
 *
 * 它们随 static 被编译期内嵌进 exe —— 解包即得内部规范全文与全部门禁脚本。
 * 判断标准不是「多带了几百 K」，而是**它们不可能是任何 server code 的运行时
 * 依赖**（路由跑的是 `.next/server/**` 的编译产物）。
 *
 * 为什么用**白名单**而不是再列一份黑名单：黑名单是欠完备的，每加一个根级文件
 * 就要记得补一条（这正是上一次 `db.sqlite` 漏掉的原因）。这里反过来：scripts/
 * 只保留**运行时真的会读**的那几个（判据是代码里有 `process.cwd()` + 路径拼接），
 * 其余一律剔除；新增脚本默认被剔除，要留下必须显式加进 RUNTIME_SCRIPTS 并说明理由。
 *
 * RUNTIME_SCRIPTS 里的启动链路有三个身份：
 *   · `src-tauri/src/lib.rs::looks_like_project_root()` 的项目根判据（判据是
 *     `package.json` + `scripts/dev-launcher.mjs`，即编排器的**唯一实现**）；
 *   · `build-desktop.mjs` 把它们拷进 `static/scripts`，让桌面包脱离仓库时仍
 *     能被重新编排一次；
 *   · 组件的 `scripts/launcher-core/*` 与 `kill-process-tree` 是编排器的运行期
 *     依赖 —— 缺一份就是运行时 ENOENT，而表现只是「双击没反应」。
 *
 * **判据是编排器的相对 import 闭包，不是「看着像运行时的都写上」**：
 * `dev-launcher.mjs` 的顶层是静态 import，ESM 在加载期就解析整张图 —— 缺一份不是
 * 「那一步跳过」，而是整个编排器起不来（`ERR_MODULE_NOT_FOUND`）。因此清单必须覆盖
 * 从 `dev-launcher.mjs` 出发递归可达的每个 `scripts/**` 模块，这条由
 * `tests/dist-artifact-hygiene.test.ts` 自动核对（新增内部分件漏登记即失败）；
 * 只出现在 JSDoc 类型注释里的说明符（如 `lockfile/lock-diff.d.mts`）不算运行期依赖。
 *
 * `.ps1` 只是 Windows 侧的**调用入口**，编排逻辑不在这里（见规范 §3/§8）。
 */
export const RUNTIME_SCRIPTS = [
  // src/app/api/helper/{install,status}/route.ts 直接把这份脚本当下载内容返回
  "install-comfyapp-helper.ps1",
  // 启动编排的唯一实现（跨平台）：项目根判据也靠它
  "dev-launcher.mjs",
  // Windows 侧的调用入口（双击 / 启动器 exe 转交），本身不含编排逻辑
  "dev-launcher.ps1",
  // dev-launcher.mjs 的会话锚点（PID/心跳落盘）与端口解析：被它 import，
  // 缺一份即整条编排在运行时 ENOENT
  "dev-launcher-session.mjs",
  "app-port.mjs",
  // 「应用服务为什么结束」的落盘侧（ISSUE #1692）：`dev-launcher.mjs` 顶层静态
  // import 它的 `writeAppServiceExit`，收尾定性时写 `run/app-service-exit.json`。
  // 缺这份同样是整个编排器 ENOENT —— 而它恰恰只在「服务已经出过事」时才被用到，
  // 也就是说漏登记的表现是「正常启动一切照旧，出事之后记录写不出来」。
  "app-service-exit.mjs",
  // 起 Next 之前的两道预检（`.env` 三项非空、schema 待应用）与执行件：
  // 都在 dev-launcher.mjs 的顶层静态 import 里（见规范 §9.1 / §9.2）。
  "env-preflight.mjs",
  "db-schema-state.mjs",
  "db-push-core.mjs",
  // 备份 / 恢复的唯一实现（D6，ISSUE #1611）：`dev-launcher.mjs` 顶层静态
  // import 它的 `applyPendingRestoreAtBoot`（换文件必须排在起 Next 之前）——
  // 缺这份就是整个编排器 ENOENT，与「缺一份内部分件」表现完全一样。
  // `db-backup.mjs`（`pnpm db:backup` 的手动档）**不在**这里：它是给人敲的
  // 命令，桌包里没有它也不影响任何运行时路径。
  "db-backup-core.mjs",
  // 统一的进程树回收入口：编排器收尾、Python 启动器的兜底补刀、Rust 壳的
  // `kill_sidecar` 补刀都调它（平台判据只此一份，见 AGENTS 硬规则 3），
  // 连同它 import 的 kill-process-tree 一起缺不了。
  "reap-process.mjs",
  // ComfyUI 执行器独立宿主（P3 §5 第 2 期 · Phase 2-C）：`dev-launcher.mjs` 的
  // `spawnExecutorHost()` 在 `COMFY_EXECUTOR=host` 灰度下把它作为受管子进程起
  // 起来（骨架阶段只走 boot + 心跳 + SIGTERM 三条，Phase 3 才接管任务）。与
  // launcher 的关系同 `dev-launcher.mjs`——走同一份 spawnInGroup / killProcessTree
  // 语义，因此必须在 standalone 产物里；桌面包用户想试 host 模式（改 `.env` 的
  // COMFY_EXECUTOR）时，脚本得随包带出去。清单必须与 check-standalone-contents
  // 里的 ALLOWED_SCRIPTS 同源（tests/dist-artifact-hygiene.test.ts 核对）。
  "executor-host.mjs",
  // 宿主的预编译运行时图与它的构建清单（3-E1，ISSUE #1169）：这两件**不是仓库源码**，
  // 而是构建期由 scripts/build-executor-host.mjs 写进产物的（桌包里没有 tsx，也不该
  // 依赖 src/lib/** 的 TS 源）。登记进白名单是因为它们落在 scripts/ 下——不登记就会被
  // 下面的剪枝删掉，表现是「产物里设 host 起不来」。
  "executor-host.runtime.mjs",
  "executor-host.build.json",
  // lockfile 差异：编排器启动前打印「不一致的具体位置」（render-lock-diff），
  // worktree 解析同一份差异对象（lock-diff）—— 两者都是静态 import。
  "lockfile/render-lock-diff.mjs",
  "lockfile/lock-diff.mjs",
  // 编排器的内部分件（procs / shell / log / worktree / orchestrator / corepack /
  // splash-assets）：逐项登记而不是放行整个目录 —— 目录级放行会让**以后新增**的
  // 脚本自动进产物，而「新增脚本默认不进产物」正是这条白名单的意义。
  // corepack 负责工具链探测与 corepack 对齐、splash-assets 在编排前同步启动页
  // 资源，两者也都在 dev-launcher.mjs 的顶层静态 import 里。
  "launcher-core/procs.mjs",
  "launcher-core/shell.mjs",
  // `COMFY_EXECUTOR` 判据的纯 Node 侧唯一定义（ADR §14 D5）：launcher 的门控与
  // host 脚本的运行时开关都静态 import 它，缺一份就是 host 静默跑成骨架。
  "launcher-core/executor-mode.mjs",
  // 「按开关拉起执行器宿主」的同一份实现（ISSUE #1767）：编排 6.5 步与桌包/生产
  // 启动链路都经它，`dev-launcher.mjs` 顶层静态 import —— 缺这份同样是整个编排器
  // ENOENT，而表现只是「双击没反应」。它自己还 import `shell/log/worktree` 三份，
  // 那三份各自已在本清单里。
  "launcher-core/executor-host-spawn.mjs",
  // shell.mjs 与 procs.mjs 都要 import 它（命令行回显的唯一出口）：少这份就是
  // 运行期 `ERR_MODULE_NOT_FOUND`，表现与「缺一份内部分件」完全一样。
  "launcher-core/command-echo.mjs",
  "launcher-core/log.mjs",
  // 「一次运行一包」的日志锚点（ISSUE #1326）：runId / run.json / current/ 归档 /
  // 保留 / 诊断包。dev-launcher.mjs 顶层静态 import 它 —— 缺这份就是编排器起不来。
  "launcher-core/run.mjs",
  "launcher-core/worktree.mjs",
  "launcher-core/orchestrator.mjs",
  "launcher-core/corepack.mjs",
  "launcher-core/splash-assets.mjs",
  // 「收尾定性」这一族（ISSUE #1692 / 规范 §4.5.3）：四种成因的判决表与文案、
  // 以及运行期退出的写点判据。`dev-launcher.mjs` 顶层静态 import 它 —— 缺这份
  // 同样是整个编排器 ENOENT，而它的表现最难查：只在**服务已经出过事**的那一刻
  // 才被走到（`concludeDownstreamExit` 与常驻段的收尾），正常启动一切照旧。
  "launcher-core/downstream-exit.mjs",
  // 基础设施层拆分带出来的五份内部分件（ISSUE #1811 第四刀，PR #1823）：
  // `dev-launcher.mjs`（1540 → 953 行）把预检 / 端口回收 / 下游 / 壳产物名 /
  // 杂项各自成模块，主文件顶层静态 import 它们。**这五份的登记是 PR #1823 漏了
  // 的一步**，由 `tests/dist-artifact-hygiene.test.ts` 的「清单覆盖编排器的相对
  // import 闭包」当场照出来 —— 缺它们的表现正是这条白名单存在的理由：
  // 桌包脱离仓库后重新编排一次，ESM 在加载期解析整张图 ⇒ `ERR_MODULE_NOT_FOUND`
  // ⇒ 用户只看到「双击没反应」，而本地开发（源码树齐全）一切照旧。
  "launcher-core/downstream.mjs",
  "launcher-core/preflight.mjs",
  "launcher-core/shell-ops.mjs",
  "launcher-core/misc-ops.mjs",
  "launcher-core/port-reap.mjs",
  // 主流程按阶段拆出来的四份（ISSUE #1811 第五刀）：预检桥段（孤儿回收 / 环境与
  // 工具链门禁 / 依赖对齐 / 备份恢复 / 端口）、桌面壳阶段、起服务桥段（缓存 /
  // dev server / 执行器宿主 / 会话锚点 / 后台 schema）、就绪等待（轮询 / 陈旧
  // 路由表自愈 / 超时定性）。`dev-launcher.mjs`（953 → 753 行）顶层静态 import
  // 它们 —— 缺任一份就是 `ERR_MODULE_NOT_FOUND`，表现与上面那批一模一样：
  // 桌包重新编排一次「双击没反应」，本地开发看不出。
  "launcher-core/startup-gates.mjs",
  "launcher-core/shell-stage.mjs",
  "launcher-core/dev-boot.mjs",
  "launcher-core/ready-wait.mjs",
  // 运行期「陈旧路由表」自愈与它的归因纯函数：`ready-wait.mjs` 与本模块都由
  // `dev-launcher.mjs` 顶层静态 import（自愈只在这两份里，见
  // `tests/dev-launcher-runtime-heal.test.ts` 的接线断言）—— 缺任一份同样是整个
  // 编排器加载即 `ERR_MODULE_NOT_FOUND`，桌包重新编排一次的表现只是「双击没反应」。
  "launcher-core/runtime-heal.mjs",
  "launcher-core/sync-attribution.mjs",
  // 「本检出 `.git` 在哪」的唯一实现（ISSUE #2043 收成一处，#2072 把 launcher 也接上）：
  // `launcher-core/run.mjs` 顶层静态 import 它 —— 少这份同样是整个编排器在加载期
  // `ERR_MODULE_NOT_FOUND`，桌包脱离仓库重新编排一次的表现只是「双击没反应」，
  // 而本地源码树齐全、看不出任何异常。登记漏在 #2072 那一批（改了代码没改清单），
  // 由 `tests/dist-artifact-hygiene.test.ts` 的「清单覆盖编排器的相对 import 闭包」照出来。
  "git-dir.mjs",
  // 桌包 standalone 形态的运行入口与它的环境装配（ISSUE #1216）：壳把
  // `node server.js` 换成 `node scripts/standalone-runtime.mjs`，缺这份就是
  // standalone 桌包回到「起不来且没人知道为什么」。
  "standalone-runtime.mjs",
  "launcher-core/standalone-runtime-env.mjs",
];

/**
 * `src-tauri/static`（= 装进安装包的 `bundle.resources`）允许的**顶层条目**。
 *
 * 为什么这里必须是白名单而不是再列一份黑名单：`bundle.resources` 从 ISSUE #1216
 * 起是真的会分发出去的东西（此前 `resources` 段是空的，`static/` 里多脏都没人看见），
 * 而 file tracing 每次升级都可能多带一个目录。**哪几样会在场，每台机、每一趟都不一样**：
 * 历史上被点名过的形状有整棵 `src/`、`changelog.d/`、开发机的 `data/llm-secret.key`、
 * 桌面快捷方式 `.lnk`、`build-launcher/`、根级 `next.config.js`；而一次真装配（本次在本机）
 * 读到的是 `.next / node_modules / package.json / public /
 * scripts / server.js / src` 七个顶层条目、装配那一跳 `挡掉 0 条` —— 因为 `pnpm build`
 * 收尾那一步（同一个清单）已经先剥过一轮。
 * **所以这份名单的价值不是"省下多少 MB"**（那个数每次都不一样，写在这里就会腐烂），
 * 而是「多带一个目录必然被看见」这条**不依赖上游是否干净**的性质。
 * 黑名单是欠完备的——#1217 记的正是「`outputFileTracingExcludes` 整份未生效」这条根因；
 * 在装配这一层用默认拒绝，才让「多带一个目录」必然被看见而不是等用户解包发现。
 *
 * 每一项的运行时理由：
 *   · `server.js` + `package.json` + `.next/` + `node_modules/` —— Next standalone
 *     的四件必需（`server.js` 启动即 `process.chdir(__dirname)`，配置读
 *     `.next/required-server-files.json`，所以 `next.config.js` **不需要**随包）。
 *   · `public/` —— 静态资源（`favicon.ico` / `splash.html`）。**产物不在这里**：
 *     产物根曾是 `public/generated`（跟着静态资源一起被拷进包），现已搬到仓库根的
 *     `generated/`（台账 A13 的结构性关法）。它是**默认拒绝**的一项 —— 顶层名单里
 *     没有 `generated`，所以不管 tracing 带不带它都进不来；将来确需放行必须同改
 *     两处清单并写清「谁在运行期读它」。
 *   · `scripts/` —— 编排器与宿主的运行期脚本（清单见 `RUNTIME_SCRIPTS`）。
 *   · `splash.html` / `index.html` —— 启动页与根路径兜底页（壳与 sidecar 都读）。
 *   · `schema.sql` —— 首启建表的 DDL，由 `build-desktop.mjs` 的 §首启建表 现生成
 *     （载荷里没 drizzle-kit，桌包首启只能靠它；只含结构、不许含数据）。
 *
 * 注意 `src` **不在**这份顶层名单里：桌包不需要整棵源码树（它主要是测试与开发期源码，
 * 出厂件一件都不读）。但运行期有一处真的会读 TS 源——`scripts/reap-process.mjs` 与
 * `scripts/dev-launcher.mjs` 都 `await import("../src/lib/process/kill-process-tree.ts")`
 * （硬规则 3 的平台机制单点），缺它桌包里的回收入口直接起不来。所以 `src` 走
 * `RUNTIME_SRC` 的**逐文件**放行，见下面那份清单与 `isStaticPathAllowed()`；
 * 本次真装配的产物里 `src/` 恰好就是那三个放行件（`kill-process-tree.ts` /
 * `executable-resolve.ts` / `platform.ts`）—— 放行集在干活，读得出。
 */
export const STATIC_ALLOWED_TOPLEVEL = [
  ".next",
  "index.html",
  "node_modules",
  "package.json",
  "public",
  "schema.sql",
  "scripts",
  "server.js",
  "splash.html",
];

/**
 * 随桌包带出去的 `src/**` 运行期依赖（相对 `src/`，逐文件、不给目录级放行）。
 *
 * 判据与 `RUNTIME_SCRIPTS` 同一套：只看「运行期代码里有没有真的 import 它」，不看
 * 「看着像不像运行时的」。目录级放行会让将来新增的 `src/**` 自动进产物，而这条白名单
 * 存在的全部意义就是「默认不进」。
 *
 * **清单的完备性由 `tests/standalone-runtime.test.ts` 的闭包判据核对**（新增一份
 * 运行期依赖而漏登记 ⇒ 当场红）：入口是 `RUNTIME_SCRIPTS` **全部** `.mjs`（不是「记得
 * 写进来的那几个」），顺 `.ts` 自己的 import 一路走到底，再减掉 `PREBUNDLED_SRC_ROOTS`
 * 那一份闭包（构建期已打进预编译件的）。实测读数（判据那一跑的口径）：全部入口可达
 * `src/` 61 个、打包掉 58 个、**净 3 个 = 本清单逐字相等**（ISSUE #2158 第 7 条）。
 *
 * 为什么允许放行 TS 源：Node 22.18+/24 的类型擦除（type stripping）默认开启，
 * `.mjs` 里 `import("./x.ts")` 能直接跑——注意随包的 Node 是**构建机那一份二进制**
 * （`build-desktop.mjs` 复制 `process.execPath`），所以这个能力在构建时就钉死了，
 * 与使用者装没装 Node 无关。该文件必须是「可擦除语法」（无 enum / namespace /
 * 参数属性），由 tests/dist-artifact-hygiene.test.ts 钉住，避免哪天给它加个 enum
 * 就把桌包的回收链静默弄断。
 */
export const RUNTIME_SRC = [
  "lib/process/kill-process-tree.ts",
  /* executable-resolve.ts：可执行形态判据的唯一实现（`whichCommand` /
   * `usableCommand` / `pnpmInvocation`，ISSUE #1327 从 `shell.mjs` 搬下来的）。
   * `launcher-core/shell.mjs` 静态 import 它 —— 而 `shell.mjs` 本身在
   * `RUNTIME_SCRIPTS` 里（桌包要能重新编排一次），所以这份**必须同批随包**：
   * 缺了它不是「那一步跳过」，而是整个编排器加载即 `ERR_MODULE_NOT_FOUND`
   * （与 `kill-process-tree.ts` 同一个理由）。它也走 Node 24 的类型擦除，
   * 因此同样受「只许可擦除语法」约束（由 tests/dist-artifact-hygiene.test.ts 钉住）。 */
  "lib/process/executable-resolve.ts",
  /* platform.ts：判据的**叶子**（`isWindows`），从 `executable-resolve.ts` 拆出来
   * 的唯一理由是「`.mjs` 静态 import 一份 `.ts` 时说明符必须带 `.ts` 扩展名，而 TS
   * 侧惯例是省略」（ISSUE #1961，见那份文件头）。它不是可选件：上面那份现在 import
   * 它，缺了同样让整个编排器**加载即断** —— 逐文件放行的语义是「一个都不能少」，
   * 不是「放行了它的父模块就够」。 */
  "lib/process/platform.ts",
  /* pnpm-resolve.ts / version-compare.ts：从 `executable-resolve.ts` 按职责拆出来的
   * 两块（它越过文件长度硬闸时切的）。链**照样是一个都不能少**：`shell.mjs` →
   * `executable-resolve.ts` → `pnpm-resolve.ts` → `version-compare.ts`，缺任何一份
   * 都是编排器加载即 `ERR_MODULE_NOT_FOUND`（与上面两条同一个理由）。两份同样走
   * Node 24 的类型擦除，受「只许可擦除语法」约束。 */
  "lib/process/pnpm-resolve.ts",
  "lib/process/version-compare.ts",
];

/**
 * 运行期**不会**以 `.ts` 形态被加载、但闭包里带着一大片 `src/**` 的那些根（相对 `src/`）。
 *
 * 为什么要有这一份：`scripts/executor-host.mjs` 的 `loadRuntimeGraph()` 是**两条分支** ——
 * 预编译件 `scripts/executor-host.runtime.mjs` 在（产物形态）就 `import` 它；
 * **不在**才 `import("tsx/esm/api")` 后加载 `src/lib/comfyui/host-runtime.ts`
 * （dev 兜底 —— `tsx` 是 devDependency、不随包）。所以从这份根出发那 71 个 `src/**`
 * 是**构建期被打进预编译件**的，产物里读的是那一件 bundle（1505 KB），不是这些 `.ts`。
 *
 * 闭包判据必须减掉它们：不减，「运行期真的会读的」会被算成 74 个，而真要随包的只有 3 个 ——
 * 那时这条判据要么红得没道理，要么被人改成「放宽清单」而失去意义（ISSUE #2158 第 7 条）。
 *
 * 新增一份预编译交付件时在这里加一行并写清「产物里读的是哪一件」。
 */
export const PREBUNDLED_SRC_ROOTS = ["lib/comfyui/host-runtime.ts"];

/**
 * `.next/standalone` 允许的**顶层条目**（默认拒绝，ISSUE #1217）。
 *
 * 为什么这一层也要一份、而不是只守装配那层：`pnpm build` 的产物就是这一层，而实测
 * `next build` 走 Turbopack 时 `outputFileTracingExcludes` 对「全项目追踪」带进来的
 * 整目录条目**一条都不减** —— 同一份源码、同一份清单：Turbopack 出来是 40 个顶层条目 /
 * 19274 个真文件（含 `src-tauri` 8520、`python-venv` 5356、`db.sqlite`+WAL/SHM、`.env`、
 * 仓库根那个 `Comfy APP.lnk`）；而**跑完今天这套按名字的剔除清单之后仍然剩 19 个顶层条目**
 * （`src-tauri` / `python-venv` / `tests` / `log` / `e2e` / `tools` / `build-launcher` /
 * `run` / `temp` / `next.config.js` / `postcss.config.js` / 那个 `.lnk` 全都在）。
 * 按名字列黑名单永远慢一步，而「多带一个目录」的表现与当年 `.env` 那次同类：
 * 静默、构建不报错、CI 全绿。默认拒绝把这件事变成「必然被看见」。
 *
 * 理由与 static 同源（逐项见 `STATIC_ALLOWED_TOPLEVEL`），只少**装配步才产出**的三项
 * （`schema.sql` / `splash.html` / `index.html`）。也没有 `generated/`：规范 §7.2 那句
 * 退役技术栈的运行时残留（数据层现在是 drizzle + libsql / `node:sqlite`，
 * 仓库根也不存在 `generated/`）。将来确需多放行一项时，**必须同批改这里与
 * `check-standalone-contents.cjs` 的那份**（两份逐字同源由用例核对），并写清谁在运行期读它。
 */
export const STANDALONE_ALLOWED_TOPLEVEL = [
  ".next",
  "node_modules",
  "package.json",
  "public",
  "scripts",
  "server.js",
];

/**
 * 产物里某条相对路径在这一层是否允许存在（默认拒绝的**唯一**判据实现，两层共用）。
 *
 * `src` 不在任何一层的顶层名单里，但**必须**能被逐文件放行：
 * `scripts/reap-process.mjs` 与 `scripts/dev-launcher.mjs` 都
 * `await import("../src/lib/process/kill-process-tree.ts")`（硬规则 3 的平台机制单点），
 * 缺它两层的回收入口都起不来。所以形态是「顶层放行祖先、叶子逐文件判」，逐文件那份
 * 清单就是 `RUNTIME_SRC`。
 *
 * @param {string[]} allowedToplevel 该层的顶层白名单
 * @param {string} relPosix 相对产物根的路径（允许反斜杠）
 * @returns {boolean}
 */
function isProductPathAllowed(allowedToplevel, relPosix) {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- relPosix 来自文件枚举（外部数据），string 只是声明
  const rel = String(relPosix ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "");
  if (rel === "") {
    return true;
  }
  const top = rel.split("/")[0] ?? "";
  if (allowedToplevel.includes(top)) {
    return true;
  }
  if (top !== "src") {
    return false;
  }
  // `src` 本身与其祖先目录要放行，否则 cpSync 走不到被放行那个文件；再逐条比对
  // RUNTIME_SRC（相对 src/ 的路径）。
  for (const allowed of RUNTIME_SRC) {
    const full = `src/${allowed}`;
    if (rel === full || full.startsWith(`${rel}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * `src-tauri/static` 层的判据（`build-desktop.mjs` 的 `cpSync` filter 用它）。
 *
 * @param {string} relPosix 相对产物根的路径
 */
export function isStaticPathAllowed(relPosix) {
  return isProductPathAllowed(STATIC_ALLOWED_TOPLEVEL, relPosix);
}

/**
 * `.next/standalone` 层的判据。
 *
 * @param {string} relPosix 相对产物根的路径
 */
export function isStandalonePathAllowed(relPosix) {
  return isProductPathAllowed(STANDALONE_ALLOWED_TOPLEVEL, relPosix);
}

/**
 * 把一个产物目录裁到该层白名单允许的样子（默认拒绝，**两层共用这一份删循环**）。
 *
 * 为什么共用：两处各写一个删循环，迟早有一处忘了另一处的护栏（这里指 `src/` 走空之后
 * 把空目录也收掉，以及不穿符号链接的口径）—— §12.12。
 *
 * @param {string} dir 产物目录
 * @param {(rel: string) => boolean} isAllowed 该层的判据
 * @param {(name: string) => void} [onRemoved] 每删一项的回调（用于日志）
 * @returns {string[]} 实际删掉的条目（相对 dir）
 */
function pruneToAllowList(dir, isAllowed, onRemoved) {
  const removed = [];
  for (const entry of readdirSync(dir)) {
    if (isAllowed(entry)) {
      continue;
    }
    // 落在链接上只删链接本身、不顺着递归（本机实测：对一个指向别处目录的链接执行
    // `rmSync(..., {recursive:true})`，链接没了、目标里的文件一个没动）。这一条是
    // 这条判据敢用在自己的产物上的前提——standalone 的 `node_modules/<pkg>` 就是
    // 指向开发机 pnpm store 的链接，口径与 `collectFiles(followLinks=false)` 一致。
    rmSync(join(dir, entry), { recursive: true, force: true });
    removed.push(entry);
    onRemoved?.(entry);
  }
  // src/ 是「顶层放行祖先、逐文件判叶子」的形态：自顶向下走一遍。
  const srcDir = join(dir, "src");
  if (existsSync(srcDir)) {
    /**
     * @param {string} abs 当前扫描的绝对目录
     * @param {string} rel 相对 `src/` 的路径（顶层调用传空串）
     */
    const walk = (abs, rel) => {
      for (const entry of readdirSync(abs)) {
        const childRel = rel ? `${rel}/${entry}` : entry;
        const childAbs = join(abs, entry);
        if (isAllowed(`src/${childRel}`)) {
          if (statSync(childAbs).isDirectory()) {
            walk(childAbs, childRel);
          }
          continue;
        }
        rmSync(childAbs, { recursive: true, force: true });
        removed.push(`src/${childRel}`);
        onRemoved?.(`src/${childRel}`);
      }
    };
    walk(srcDir, "");
    if (readdirSync(srcDir).length === 0) {
      rmSync(srcDir, { recursive: true, force: true });
    }
  }
  return removed;
}

/**
 * 把 `src-tauri/static` 裁到「桌包允许的样子」。
 *
 * `scripts/` 那一份由 `stripDevArtifacts()` 按 `RUNTIME_SCRIPTS` 剪，不在这里重复。
 * 用途有两层：`build-desktop.mjs` 的 `cpSync` filter 已经按同一判据在**复制前**挡掉
 * （省掉 15 MB 无谓复制），这里保留作落盘兜底——有人绕过 filter 直接往 static 写文件、
 * 或将来改了复制方式时，泄漏仍然被这一刀挡住。命中与否都只是空操作。
 *
 * @param {string} dir 目标目录（`src-tauri/static`）
 * @param {(name: string) => void} [onRemoved]
 * @returns {string[]} 实际删掉的条目（相对 dir）
 */
export function pruneStaticToAllowList(dir, onRemoved) {
  return pruneToAllowList(dir, isStaticPathAllowed, onRemoved);
}

/**
 * 把 `.next/standalone` 裁到 `STANDALONE_ALLOWED_TOPLEVEL`（ISSUE #1217）。
 *
 * @param {string} dir 通常是 `.next/standalone`
 * @param {(name: string) => void} [onRemoved]
 * @returns {string[]} 实际删掉的条目（相对 dir）
 */
export function pruneStandaloneToAllowList(dir, onRemoved) {
  return pruneToAllowList(dir, isStandalonePathAllowed, onRemoved);
}

/**
 * 构建期产出、不在仓库源码里的白名单条目（相对 scripts/）。
 *
 * scripts/build-desktop.mjs 拷 RUNTIME_SCRIPTS 时**跳过**这些名字（仓库里没有同名
 * 源文件，按缺件失败会把人引向「清单漂了」这个错方向），改在组装完整树之后断言它们
 * 还在——真正的故障是「忘了跑 pnpm build 里的那一步」或「被剪枝误删」。
 */
export const BUILT_RUNTIME_SCRIPTS = ["executor-host.runtime.mjs", "executor-host.build.json"];

/** 产物根下不该随分发包出去的开发文件（相对产物根）。 */
export const DEV_ARTIFACTS = [
  "AGENTS.md",
  "CHANGELOG-archive.md",
  "CHANGELOG.md",
  "README.md",
  "components.json",
  "drizzle.config.ts",
  "playwright.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "prettier.config.js",
  "tsconfig.json",
  "typedoc.json",
  "vitest.config.ts",
  // TypeScript 增量编译缓存：构建期产物，不是运行时依赖
  "tsconfig.tsbuildinfo",
  "__pycache__",
  // 文档目录与变更碎片（都是产物根下的整目录，直接整删最省事）。
  // 「`.md` 不该随分发包出去」这条主张有两处判据在数：
  // `check-standalone-contents.cjs` 的 `["变更碎片"]`/`["文档目录"]` 两行，以及
  // `tests/turbopack-tracing-excludes.test.ts` 的同名产物探针。
  // `./docs/**`、`./changelog.d/**` 早就写在 `next.config.js` 的
  // outputFileTracingExcludes 里，**但实测对 tracing 带进来的文件不做减法**
  // （写在清单里的同一批目录，产物里仍有 747 个变更碎片真文件）——
  // 与 AGENTS 硬规则 17 记的 `.env` 是同一件事：兜底只能在这里显式删。
  "docs",
  "changelog.d",
  // `tools/docs/` 单列而不整删 `tools/`：后者该不该进产物是打包线的判断，
  // 这里只清无争议的文档。
  "tools/docs",
];

/**
 * 按**形状**递归剔除的条目（相对产物根的路径命中即删）。
 *
 * 为什么根级清单（DEV_ARTIFACTS）不够：这三类形状有相当一部分不在产物根，而是
 * 藏在解引用之后的依赖包里 —— `src-tauri/static`（最终被编译期内嵌进 exe 的那份）
 * 实测有 472 个 `node_modules/<pkg>/docs/` 下的 .md、24 个 `src/` 下的 .test.tsx，
 * 都不是「某个根目录」，列不进按目录名删的那张表。
 *
 * **判据必须与 `check-standalone-contents.cjs` 的 FORBIDDEN 同源**（这几条正则逐字
 * 相同，由 `tests/dist-artifact-hygiene.test.ts` 核对）：剔除侧与检查侧一旦漂移，
 * 表现是「删掉了却仍判违规」或「判违规却没人删」，两边都白跑。
 *
 * @type {Array<[string, RegExp]>}
 */
export const FORBIDDEN_SHAPES = [
  ["测试文件", /(^|\/)src\/.*\.test\.tsx?$/],
  ["变更碎片", /(^|\/)changelog\.d\/.*\.md$/],
  ["文档目录", /(^|\/)docs\/.*\.md$/],
];

/**
 * 密钥与开发库的**形状**（同样按产物根相对路径判，命中即删）。
 *
 * 为什么根级清单（PRIVATE_INPUTS）不够：那条只删产物根那层的
 * `.env` / `db.sqlite`，而全项目 tracing 会把藏在子目录里的开发库一起带进来
 * （实测 `check-standalone-contents.cjs` 在 `static` 上报出过旧布局下的 `db.sqlite`
 * 这一条 —— 判据早就写了「开发库文件绝不能出现」，减法却一直没人做）。
 * 表现不是多个文件，而是**上一台机器的数据成为出厂数据**。
 */
export const PRIVATE_SHAPES = [
  ["开发机私有输入", /(^|\/)\.env(\.[^/]*)?$/],
  ["开发库文件", /(^|\/)db\.sqlite(-wal|-shm)?$/],
];

/**
 * 剔除侧实际用的全集（形状级 + 密钥/开发库级）。
 *
 * @type {Array<[string, RegExp]>}
 */
const ALL_SHAPES = /** @type {Array<[string, RegExp]>} */ ([
  ...PRIVATE_SHAPES,
  ...FORBIDDEN_SHAPES,
]);

/**
 * 递归剔除命中形状清单的文件，并收掉被掏空的目录。
 *
 * ⚠️ **不穿符号链接**（用 `lstatSync` 判类型、是链接就整条跳过）：
 * `.next/standalone/node_modules/<pkg>` 是指向本仓库 `node_modules/.pnpm/...`
 * 真 store 的链接（实测 `node_modules/next` 的链接目标就是开发机那份 Next），
 * 顺着链接删 `.md` 会**直接损坏开发机的依赖**，而不是清理产物。
 * 依赖包的内容真正变成产物里的真文件，是在 `build-desktop.mjs` 用
 * `dereference: true` 拷进 `static` 之后 —— 所以同一次剔除在 `staticDir` 上
 * 才会命中那 472 个文档；在 standalone 上命中的是 `src/` 下那些真文件。
 * 这条分工也是产物探针只信「真文件」的依据（见规范 §7.2）。
 *
 * @param {string} dir 产物目录（`.next/standalone` 或 `src-tauri/static`）
 * @param {(name: string) => void} [onRemoved] 每删一项的回调（用于日志）
 * @param {number} [reportLimit] 最多回调几条：这类文件成百，全打会淹掉构建输出，
 *   而**返回值不受它影响**（调用方要计数时拿到的是全量）
 * @returns {string[]} 实际删掉的相对路径
 */
export function stripForbiddenShapes(dir, onRemoved, reportLimit = Infinity) {
  /** @type {string[]} */
  const removed = [];
  pruneShapeWalk(dir, "", removed, onRemoved, reportLimit);
  return removed;
}

/**
 * 深度优先剔除；删空了的目录顺手收掉（空目录不参与模块解析，删它没有副作用）。
 *
 * @param {string} absDir 当前目录的绝对路径
 * @param {string} prefix 相对产物根的路径前缀（顶层调用传空串）
 * @param {string[]} removed 输出：实际删掉的相对路径（全量，不受 reportLimit 影响）
 * @param {((name: string) => void) | undefined} onRemoved
 * @param {number} reportLimit 只回调前这么多条（见 stripForbiddenShapes）
 */
function pruneShapeWalk(absDir, prefix, removed, onRemoved, reportLimit) {
  let names;
  try {
    names = readdirSync(absDir);
  } catch {
    return; // 读不到的目录不是违规，跳过（断链 / 权限）
  }
  for (const name of names) {
    const abs = join(absDir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      continue;
    }
    if (st.isDirectory()) {
      pruneShapeWalk(abs, rel, removed, onRemoved, reportLimit);
      try {
        if (readdirSync(abs).length === 0) {
          rmSync(abs, { recursive: true, force: true });
        }
      } catch {
        /* 收不掉就留着：空目录无害，不值得为它把整趟剔除判成失败 */
      }
      continue;
    }
    if (!ALL_SHAPES.some(([, re]) => re.test(rel))) {
      continue;
    }
    rmSync(abs, { force: true });
    removed.push(rel);
    // 只回报名额内的几条：这类文件成百，全打会把构建输出淹掉
    if (removed.length <= reportLimit) {
      onRemoved?.(rel);
    }
  }
}

/**
 * 剔除开发期文件与内部门禁脚本（白名单保留 RUNTIME_SCRIPTS）。
 *
 * @param {string} dir 产物目录（`.next/standalone` 或 `src-tauri/static`）
 * @param {(name: string) => void} [onRemoved] 每删一项的回调（用于日志）
 * @returns {string[]} 实际删掉的条目名
 */
export function stripDevArtifacts(dir, onRemoved) {
  const removed = [];
  for (const name of DEV_ARTIFACTS) {
    const p = join(dir, name);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      removed.push(name);
      onRemoved?.(name);
    }
  }
  // scripts/：白名单之外一律剔除（新增脚本默认不进产物）。
  // 白名单条目允许是相对路径（如 `launcher-core/orchestrator.mjs`）：逐层比对，
  // 目录只有在「白名单里有它的子项」时才保留。
  const scriptsDir = join(dir, "scripts");
  if (existsSync(scriptsDir)) {
    pruneNotWhitelisted(scriptsDir, "", RUNTIME_SCRIPTS, removed, onRemoved);
    // 全部被剔（未来 RUNTIME_SCRIPTS 变空）时不留空目录
    if (readdirSync(scriptsDir).length === 0) {
      rmSync(scriptsDir, { recursive: true, force: true });
    }
  }
  // 形状级剔除（测试文件 / 变更碎片 / 依赖包文档）。量大：实测 standalone 有
  // 406 个测试文件、static 有 472 个依赖包文档，逐条打日志会把构建输出淹掉，
  // 所以只点名前几条（走调用方的 onRemoved，它们是真实相对路径），
  // 分类计数作为返回值的一项汇总出现。
  const shapeRemoved = stripForbiddenShapes(dir, (rel) => onRemoved?.(rel), 5);
  if (shapeRemoved.length > 0) {
    const byTag = new Map();
    for (const rel of shapeRemoved) {
      const tag = ALL_SHAPES.find(([, re]) => re.test(rel))?.[0] ?? "其它";
      byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
    }
    removed.push(
      `形状剔除 ${shapeRemoved.length} 个（${[...byTag]
        .map(([tag, n]) => `${tag} ${n}`)
        .join(" / ")}）`,
    );
  }
  return removed;
}

/**
 * 按白名单剔除目录内的条目（支持 `a/b.mjs` 形式的相对路径）。
 *
 * 为什么白名单允许嵌套路径而不是「目录级放行」：目录级放行会让**以后新增**的
 * 脚本自动进产物 —— 而「新增脚本默认不进产物、要留下必须显式登记」正是这条
 * 白名单存在的全部意义。
 *
 * @param {string} absDir 当前扫描的绝对目录
 * @param {string} prefix 相对产物根的相对前缀（顶层调用传空串）
 * @param {string[]} allowed 白名单（相对 `scripts/` 的路径）
 * @param {string[]} removed 输出：实际删掉的条目（相对 `scripts/`）
 * @param {(name: string) => void} [onRemoved]
 */
function pruneNotWhitelisted(absDir, prefix, allowed, removed, onRemoved) {
  const direct = new Set();
  const nested = new Set();
  for (const rel of allowed) {
    if (prefix && !rel.startsWith(`${prefix}/`)) {
      continue;
    }
    const rest = prefix ? rel.slice(prefix.length + 1) : rel;
    const [head] = rest.split("/");
    if (!head) {
      continue;
    }
    direct.add(head);
    if (rest.includes("/")) {
      nested.add(head);
    }
  }
  for (const name of readdirSync(absDir)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const abs = join(absDir, name);
    let isDir = false;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      /* 读不到时按需删除处理 */
    }
    if (isDir && direct.has(name) && nested.has(name)) {
      pruneNotWhitelisted(abs, rel, allowed, removed, onRemoved);
      continue;
    }
    if (!isDir && direct.has(name)) {
      continue;
    }
    if (isDir && nested.has(name)) {
      continue;
    }
    rmSync(abs, { recursive: true, force: true });
    removed.push(`scripts/${rel}`);
    onRemoved?.(`scripts/${rel}`);
  }
}

/** 作为脚本直接执行：清理 `.next/standalone`。 */
function main() {
  const root = join(import.meta.dirname, "..");
  const standalone = join(root, ".next", "standalone");
  if (!existsSync(standalone)) {
    // 产物不存在不是错误：本步骤是 `next build` 的收尾，跳过即可。
    console.log("[standalone-clean] 未找到 .next/standalone，跳过");
    return 0;
  }
  const removed = stripPrivateInputs(standalone, (name) => {
    console.log(`[standalone-clean] 已剔除开发机私有输入 .next/standalone/${name}`);
  });
  const devRemoved = stripDevArtifacts(standalone, (name) => {
    console.log(`[standalone-clean] 已剔除开发期文件 .next/standalone/${name}`);
  });
  // 顶层默认拒绝（ISSUE #1217）放在两份「按名字删」的清单**之后**：那两份负责删有名字的，
  // 这一刀负责「以后多出来的那一个谁也没听过的目录」。顺序反过来会先把白名单里的连带删掉，
  // 日志看着像「这次剥得真干净」，其实是剪错了。
  const topRemoved = pruneStandaloneToAllowList(standalone);
  // 不打逐条日志：`src/` 那一格的叶子有上百个，逐行会把这次剔除挤成看不见的噪声。
  // 按「顶层条目」与「src 叶子」两类各出一行汇总，两类都看得见、也数得出。
  const strayTop = topRemoved.filter((name) => !name.includes("/"));
  if (strayTop.length > 0) {
    console.log(
      `[standalone-clean] 已剔除顶层白名单外条目 ${strayTop.length} 个：${
        strayTop.slice(0, 12).join(" / ")
        }${strayTop.length > 12 ? ` …其余 ${strayTop.length - 12} 个` : ""
        }（要留下请同批登记 STANDALONE_ALLOWED_TOPLEVEL 与 check-standalone-contents.cjs，` +
        `并写清谁在运行期读它）`,
    );
  }
  const straySrc = topRemoved.length - strayTop.length;
  if (straySrc > 0) {
    console.log(
      `[standalone-clean] 已剔除 src/ 下未逐文件登记的条目 ${straySrc} 个` +
        `（这一格只保留 RUNTIME_SRC 点名的 ${RUNTIME_SRC.join(" / ")}）`,
    );
  }
  if (removed.length === 0) {
    console.log("[standalone-clean] ✓ 产物无开发机私有输入（.env / db.sqlite*）");
  }
  if (devRemoved.length === 0) {
    console.log("[standalone-clean] ✓ 产物无开发期文件 / 内部门禁脚本");
  }
  if (topRemoved.length === 0) {
    console.log(
      `[standalone-clean] ✓ 顶层只剩白名单那 ${STANDALONE_ALLOWED_TOPLEVEL.length} 类条目`,
    );
  }
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.filename === process.argv[1];
if (invokedDirectly) {
  process.exit(main());
}
