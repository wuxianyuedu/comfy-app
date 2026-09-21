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
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
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
  // shell.mjs 与 procs.mjs 都要 import 它（命令行回显的唯一出口）：少这份就是
  // 运行期 `ERR_MODULE_NOT_FOUND`，表现与「缺一份内部分件」完全一样。
  "launcher-core/command-echo.mjs",
  "launcher-core/log.mjs",
  "launcher-core/worktree.mjs",
  "launcher-core/orchestrator.mjs",
  "launcher-core/corepack.mjs",
  "launcher-core/splash-assets.mjs",
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
];

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
    if (readdirSync(scriptsDir).length === 0) rmSync(scriptsDir, { recursive: true, force: true });
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
    console.log(`[standalone-clean] 已剔除开发机私有输入 .next/standalone/${name}`);
  });
  const devRemoved = stripDevArtifacts(standalone, (name) => {
    console.log(`[standalone-clean] 已剔除开发期文件 .next/standalone/${name}`);
  });
  if (removed.length === 0) {
    console.log("[standalone-clean] ✓ 产物无开发机私有输入（.env / db.sqlite*）");
  }
  if (devRemoved.length === 0) {
    console.log("[standalone-clean] ✓ 产物无开发期文件 / 内部门禁脚本");
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) process.exit(main());
