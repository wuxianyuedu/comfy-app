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
import { existsSync, readdirSync, rmSync } from "node:fs";
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
 *   vitest.config.ts / typedoc.json / …
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
 * 注意 RUNTIME_SCRIPTS 里保留 dev-launcher.ps1 有两个身份：`src-tauri/src/lib.rs`
 * 的 `resolve_project_root()` 靠它存在来判断项目根，`build-desktop.mjs` 也会单独
 * 把它拷进 static/scripts。删掉它壳会找不到项目根。
 */
export const RUNTIME_SCRIPTS = [
  // src/app/api/helper/{install,status}/route.ts 直接把这份脚本当下载内容返回
  "install-comfyapp-helper.ps1",
  // src-tauri/src/lib.rs::resolve_project_root() 的项目根判据 + 壳的启动编排
  "dev-launcher.ps1",
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
  // scripts/：白名单之外一律剔除（新增脚本默认不进产物）
  const scriptsDir = join(dir, "scripts");
  if (existsSync(scriptsDir)) {
    const keep = new Set(RUNTIME_SCRIPTS);
    for (const name of readdirSync(scriptsDir)) {
      if (keep.has(name)) continue;
      rmSync(join(scriptsDir, name), { recursive: true, force: true });
      removed.push(`scripts/${name}`);
      onRemoved?.(`scripts/${name}`);
    }
    // 全部被剔（未来 RUNTIME_SCRIPTS 变空）时不留空目录
    if (readdirSync(scriptsDir).length === 0) rmSync(scriptsDir, { recursive: true, force: true });
  }
  return removed;
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
