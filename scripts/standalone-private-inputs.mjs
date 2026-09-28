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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 不得随分发包出去的仓库根文件（相对产物根）。 */
export const PRIVATE_INPUTS = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "db.sqlite",
  "db.sqlite-wal",
  "db.sqlite-shm",
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
 *   eslint.config.js / playwright.config.ts /      开发与门禁配置
 *   例如 vitest.config.ts / typedoc.json 等开发期文件
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
  // 起 Next 之前的两道预检（`.env` 三项非空、schema 待应用）与执行件：
  // 都在 dev-launcher.mjs 的顶层静态 import 里（见规范 §9.1 / §9.2）。
  "env-preflight.mjs",
  "db-schema-state.mjs",
  "db-push-core.mjs",
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
  // shell.mjs 与 procs.mjs 都要 import 它（命令行回显的唯一出口）：少这份就是
  // 运行期 `ERR_MODULE_NOT_FOUND`，表现与「缺一份内部分件」完全一样。
  "launcher-core/command-echo.mjs",
  "launcher-core/log.mjs",
  "launcher-core/worktree.mjs",
  "launcher-core/orchestrator.mjs",
  "launcher-core/corepack.mjs",
  "launcher-core/splash-assets.mjs",
];

/**
 * 构建期产出、不在仓库源码里的白名单条目（相对 scripts/）。
 *
 * scripts/build-desktop.mjs 拷 RUNTIME_SCRIPTS 时**跳过**这些名字（仓库里没有同名
 * 源文件，按缺件失败会把人引向「清单漂了」这个错方向），改在组装完整树之后断言它们
 * 还在——真正的故障是「忘了跑 pnpm build 里的那一步」或「被剪枝误删」。
 */
export const BUILT_RUNTIME_SCRIPTS = [
  "executor-host.runtime.mjs",
  "executor-host.build.json",
];

/** 产物根下不该随分发包出去的开发文件（相对产物根）。 */
export const DEV_ARTIFACTS = [
  "AGENTS.md",
  "CHANGELOG.md",
  "README.md",
  "components.json",
  "drizzle.config.ts",
  "eslint.config.js",
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
 * （实测 `check-standalone-contents.cjs` 在 `static` 上报出过 `prisma/db.sqlite`
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
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      pruneShapeWalk(abs, rel, removed, onRemoved, reportLimit);
      try {
        if (readdirSync(abs).length === 0)
          rmSync(abs, { recursive: true, force: true });
      } catch {
        /* 收不掉就留着：空目录无害，不值得为它把整趟剔除判成失败 */
      }
      continue;
    }
    if (!ALL_SHAPES.some(([, re]) => re.test(rel))) continue;
    rmSync(abs, { force: true });
    removed.push(rel);
    // 只回报名额内的几条：这类文件成百，全打会把构建输出淹掉
    if (removed.length <= reportLimit) onRemoved?.(rel);
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
    if (readdirSync(scriptsDir).length === 0)
      rmSync(scriptsDir, { recursive: true, force: true });
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
    if (prefix && !rel.startsWith(`${prefix}/`)) continue;
    const rest = prefix ? rel.slice(prefix.length + 1) : rel;
    const [head] = rest.split("/");
    if (!head) continue;
    direct.add(head);
    if (rest.includes("/")) nested.add(head);
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
    if (!isDir && direct.has(name)) continue;
    if (isDir && nested.has(name)) continue;
    rmSync(abs, { recursive: true, force: true });
    removed.push(`scripts/${rel}`);
    onRemoved?.(`scripts/${rel}`);
  }
}

/** 作为脚本直接执行：清理 `.next/standalone`。 */
function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const standalone = join(root, ".next", "standalone");
  if (!existsSync(standalone)) {
    // 产物不存在不是错误：本步骤是 `next build` 的收尾，跳过即可。
    console.log("[standalone-clean] 未找到 .next/standalone，跳过");
    return 0;
  }
  const removed = stripPrivateInputs(standalone, (name) => {
    console.log(
      `[standalone-clean] 已剔除开发机私有输入 .next/standalone/${name}`,
    );
  });
  const devRemoved = stripDevArtifacts(standalone, (name) => {
    console.log(`[standalone-clean] 已剔除开发期文件 .next/standalone/${name}`);
  });
  if (removed.length === 0) {
    console.log(
      "[standalone-clean] ✓ 产物无开发机私有输入（.env / db.sqlite*）",
    );
  }
  if (devRemoved.length === 0) {
    console.log("[standalone-clean] ✓ 产物无开发期文件 / 内部门禁脚本");
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) process.exit(main());
