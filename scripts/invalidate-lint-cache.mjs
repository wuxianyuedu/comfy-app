#!/usr/bin/env node
// eslint 增量缓存的失效器，挂在 `package.json` 的 `postinstall` 上。
//
// **为什么要有这个文件**：`pnpm run lint` 带 `--cache --cache-strategy content`，
// 缓存键只有「文件内容 + 解析后的 eslint 配置」——**装了什么依赖不在键里**。
// 于是类型化规则（`no-unsafe-*` 那一族要看 AST 上的类型）会在依赖变化之后
// 重放旧判决，两个方向都会错：
//   · 假红：装完新依赖，之前判过的文件仍报「旧的错」—— 实测一次 `pnpm install`
//     补上 storybook 之后，`pnpm run lint` 仍报 3 条 `no-unsafe-assignment`，
//     而这三个文件 `--no-cache` 重跑是 0 条、全仓冷跑也是 0 条。
//     因为组 B 扫整个白名单，**这条红会拦下之后每一次提交**（本仓无 CI 兜底、
//     又不许 `--no-verify`），最可能被拿去换掉的恰恰是判据而不是缓存。
//   · 假绿（更要紧的那一面）：新依赖/新类型口径引入的真违规，会被旧缓存直接
//     洗掉 —— 判据在，判决是旧的，看起来全绿。
// 原先这条只写在 `.githooks/pre-commit` 的一句 ⚠️ 里（「升级 eslint 之后先手动删
// 该目录」）。手动步骤不在缓存键里、也没有执行者，所以它今天真的咬人了：把「记得删」
// 换成「按指纹自动失效」。
//
// **指纹取哪三样**（都取字节哈希，任一变化即失效）：
//   · `pnpm-lock.yaml`（声明的依赖树）
//   · `node_modules/.pnpm/lock.yaml`（**实际装上了什么**；它与根锁文件本就不同形，
//     各取一份才不会「改了声明但没重装」时误失效 —— 见规范 §13.5.9 那组读数）
//   · `tsconfig.json`（类型化 lint 的解析口径：`moduleResolution` / `paths` 变了，
//     同一份代码能看到不同类型）
// `eslint.config.js` 不在这里 —— 它本来就在 eslint 自己的缓存键里。
//
// **它必须永远退 0**：`postinstall` 非零退出会让整个 `pnpm install` 失败
// （见 `scripts/install-git-hooks.mjs` 文件头那条 Windows 事故），而缓存失效只是
// 一件锦上添花的事。任何异常都降级成「跳过并打印原因」。

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** eslint 缓存目录（与 `package.json` 的 `--cache-location` 逐字同源，见下面那条用例）。 */
export const CACHE_DIR_REL = "node_modules/.cache/eslint";
/** 上次失效时留下的指纹文件。 */
export const STAMP_REL = "node_modules/.cache/eslint-deps-stamp.json";
/** 进指纹的输入（相对仓库根）。 */
export const FINGERPRINT_INPUTS = [
  "pnpm-lock.yaml",
  "node_modules/.pnpm/lock.yaml",
  "tsconfig.json",
];

/** @typedef {{action: "cleared" | "kept" | "skipped", fingerprint: string | null, detail: string}} SyncResult */

/**
 * 按 `FINGERPRINT_INPUTS` 算一个短哈希；一份都读不到时返回 null（= 无法判定）。
 * @param {(rel: string) => Buffer | null} read
 * @returns {string | null}
 */
export function computeFingerprint(read) {
  const hash = createHash("sha256");
  let seen = 0;
  for (const rel of FINGERPRINT_INPUTS) {
    const bytes = read(rel);
    if (!bytes) continue;
    seen += 1;
    hash.update(rel);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  if (seen === 0) return null;
  return `${seen}:${hash.digest("hex").slice(0, 16)}`;
}

/**
 * 比较指纹与缓存目录，必要时清缓存。**不抛异常**，把结论返回给调用方打印。
 * @param {{root?: string, read?: (rel: string) => Buffer | null, remove?: (dir: string) => void, write?: (rel: string, text: string) => void}} [opts]
 * @returns {SyncResult}
 */
export function syncLintCache(opts = {}) {
  const root = opts.root ?? ROOT;
  const read =
    opts.read ??
    ((rel) => {
      try {
        return fs.readFileSync(path.join(root, rel));
      } catch {
        return null;
      }
    });
  const fingerprint = computeFingerprint(read);
  if (!fingerprint) {
    return {
      action: "skipped",
      fingerprint: null,
      detail: "读不到任何指纹输入",
    };
  }
  const stampPath = path.join(root, ...STAMP_REL.split("/"));
  let previous = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(stampPath, "utf8"));
    if (typeof parsed?.fingerprint === "string") previous = parsed.fingerprint;
  } catch {
    previous = null;
  }
  const cacheExists = fs.existsSync(
    path.join(root, ...CACHE_DIR_REL.split("/")),
  );
  if (previous === fingerprint && cacheExists) {
    return { action: "kept", fingerprint, detail: "指纹未变" };
  }
  if (previous === fingerprint) {
    return {
      action: "kept",
      fingerprint,
      detail: "指纹未变且缓存不在（下次 lint 自然冷跑）",
    };
  }
  const remove =
    opts.remove ??
    ((dir) => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
  if (previous === null && !cacheExists) {
    // 干净检出：没有缓存可失效，只把指纹落下来。
  } else {
    remove(path.join(root, ...CACHE_DIR_REL.split("/")));
  }
  const write =
    opts.write ??
    ((rel, text) => {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text, "utf8");
    });
  write(STAMP_REL, `${JSON.stringify({ fingerprint }, null, 2)}\n`);
  return {
    action: "cleared",
    fingerprint,
    detail:
      previous === null
        ? "首次记录指纹"
        : `依赖/类型口径已变（${previous} → ${fingerprint}）`,
  };
}

/**
 * 跑一次失效判定并打印一行结论。**任何异常都咽掉**（退 0 由调用方保证），
 * 因为 `postinstall` 非零退出会带走整次 `pnpm install`。
 * @param {() => SyncResult} [sync] 便于用例喂一个会抛的实现
 * @param {(line: string) => void} [log]
 * @returns {{result: SyncResult | null, error: string | null}}
 */
export function runAndReport(
  sync = syncLintCache,
  log = (line) => console.log(line),
) {
  try {
    const result = sync();
    const label =
      result.action === "cleared"
        ? "已清"
        : result.action === "kept"
          ? "保留"
          : "跳过";
    log(
      `[lint-cache] ${label} ${CACHE_DIR_REL} —— ${result.detail}` +
        `${result.fingerprint ? `（指纹 ${result.fingerprint}）` : ""}`,
    );
    return { result, error: null };
  } catch (err) {
    log(
      `[lint-cache] 跳过（失效器自身出错：${/** @type {Error} */ (err).message}）—— ` +
        "缓存留着她跑，别让 postinstall 非零退出",
    );
    return { result: null, error: /** @type {Error} */ (err).message };
  }
}

function main() {
  // 允许把「仓库根」指到别处：单测要跑真入口（退 0 + 打印），但不许碰开发者
  // 自己的 node_modules 缓存 —— 有副作用的用例会让人在跑测试时把热缓存清掉。
  const root = process.env.COMFYAPP_LINT_CACHE_ROOT?.trim() || ROOT;
  runAndReport(() => syncLintCache({ root }));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
