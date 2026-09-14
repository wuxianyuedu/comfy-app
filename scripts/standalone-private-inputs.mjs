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
import { existsSync, rmSync } from "node:fs";
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
  if (removed.length === 0) {
    console.log("[standalone-clean] ✓ 产物无开发机私有输入（.env / db.sqlite*）");
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) process.exit(main());
