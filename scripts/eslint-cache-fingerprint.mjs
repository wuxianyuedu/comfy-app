#!/usr/bin/env node
// eslint 增量缓存的依赖指纹失效（ISSUE #1399）。
//
// **要解决的问题**：`pnpm run lint` 带 `--cache --cache-strategy content`，而
// eslint 的缓存键只含「文件内容 + 解析后的 eslint 配置」——**不含装了哪些依赖**，
// 也不含 `tsconfig.json` 的解析口径。`@typescript-eslint/no-unsafe-*` 那一族是
// **类型化规则**（要看 AST 上的类型），于是依赖一变，旧判决被整片重放，两个方向
// 都会错：
//   · 假红：那份红会拦住从该缓存起的所有提交（本仓 #623 之后无 CI 兜底、
//     `--no-verify` 又不许用 → 最容易被拿去换掉的是判据本身）；
//   · 假绿（更要紧）：新依赖带进来的真违规被旧缓存洗掉，看起来全绿。
//
// 此前唯一的处理是钩子里那句 ⚠️「升级 eslint 之后先手动删该缓存目录」——
// 靠人记得删 = 没有执行者，且触发面写窄了（真实触发是**任何依赖变化**）。
//
// **机制**：记一份指纹（`pnpm-lock.yaml` + `node_modules/.pnpm/lock.yaml` +
// `tsconfig.json` 的字节哈希，前两份分别是「声明要装什么」与「实际装上了什么」，
// 见规范 §13.5.9；`eslint.config.js` 已在 eslint 自己的缓存键里，不重复）。
// 指纹变了就删缓存目录，没变就留着 —— 稳态热跑（实测 28.8–46.3s）的代价不能被
// 白付。指纹本身要落盘：只在内存里算答不了「这次 install 之后依赖到底变没变」。
//
// **调用面**：`postinstall`（经 `scripts/install-git-hooks.mjs` 转交）。任何异常一律
// 咽掉退 0 —— postinstall 非零会带走整次 `pnpm install`（AGENTS 硬规则 7 的形态）。
// 代价是诚实的：真装完依赖后的第一次提交多等约 4.5 分钟（冷跑 316s），买回
// 「判决来自当前依赖树」。
//
// 也做成命令行入口（`node scripts/eslint-cache-fingerprint.mjs [--check]`），
// 供自查与用例真跑：`--check` 只报结论、不动缓存。

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** eslint 缓存目录（与 `package.json` 的 `--cache-location` 逐字一致）。 */
export const CACHE_DIR_REL = "node_modules/.cache/eslint";

/** 指纹落盘位置（与缓存目录同域，`node_modules/.cache/` 已被 gitignore 覆盖）。 */
export const FINGERPRINT_REL = "node_modules/.cache/eslint-fingerprint.json";

/**
 * 进指纹的输入：**声明要装什么** + **实际装上了什么** + **类型解析口径**。
 *
 * 三类各自的理由（少一类都会让某个方向的旧判决被重放）：
 *   · `pnpm-lock.yaml`：增删依赖首先落在这里；
 *   · `node_modules/.pnpm/lock.yaml`：pnpm 写出「这次真的装了什么」，
 *     与上面那份**不同形**（13068 vs 12910 行，实测见 §13.5.9）—— 只比一份
 *     会把「lockfile 改了但没重装」读成「依赖已更新」；
 *   · `tsconfig.json`：类型化规则的解析口径变了，同一份源码的类型判决就该重算。
 *
 * 刻意**不含** `eslint.config.js`：它在 eslint 自己的缓存键里，登进来等于给
 * 「改了配置却删不掉缓存」这种假象留口子。
 */
export const FINGERPRINT_INPUTS = [
  "pnpm-lock.yaml",
  "node_modules/.pnpm/lock.yaml",
  "tsconfig.json",
];

/**
 * 算一份指纹：每个输入各自的 SHA256，拼成稳定顺序的对象。
 *
 * 缺失的文件记成 `<missing>`（而不是跳过）—— 跳过会让「lockfile 被删掉」这种
 * 拓扑变化哈希不变，正好是「依赖树变了但判决被重放」的极端形态。
 *
 * @param {string} root 仓库根
 * @returns {{ inputs: Record<string, string> }}
 */
export function computeFingerprint(root) {
  /** @type {Record<string, string>} */
  const inputs = {};
  for (const rel of FINGERPRINT_INPUTS) {
    const abs = path.join(root, rel);
    try {
      inputs[rel] = createHash("sha256")
        .update(fs.readFileSync(abs))
        .digest("hex");
    } catch {
      inputs[rel] = "<missing>";
    }
  }
  return { inputs };
}

/**
 * 读上次落盘的指纹；不存在 / 格式不对时返回 `null`（= 无从判定，按「变了」处理）。
 *
 * @param {string} root 仓库根
 * @returns {unknown}
 */
export function readStoredFingerprint(root) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(root, FINGERPRINT_REL), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * 比较两份指纹。形状必须逐键一致（键集变了也算变了：口径本身换了）。
 *
 * @param {unknown} stored
 * @param {{ inputs: Record<string, string> }} current
 * @returns {{ changed: boolean, reason: string }}
 */
export function fingerprintChanged(stored, current) {
  if (!stored || typeof stored !== "object" || !("inputs" in stored)) {
    return {
      changed: true,
      reason: "没有可比对的旧指纹（首次接线 / 指纹文件缺失）",
    };
  }
  const prev = /** @type {{ inputs?: Record<string, string> }} */ (stored)
    .inputs;
  if (!prev || typeof prev !== "object") {
    return { changed: true, reason: "旧指纹形状不对（口径变更）" };
  }
  const prevKeys = Object.keys(prev).sort();
  const curKeys = Object.keys(current.inputs).sort();
  if (prevKeys.join("\n") !== curKeys.join("\n")) {
    return { changed: true, reason: "指纹输入集变了（口径变更）" };
  }
  for (const key of curKeys) {
    if (prev[key] !== current.inputs[key]) {
      return { changed: true, reason: `${key} 的字节哈希变了` };
    }
  }
  return { changed: false, reason: "" };
}

/**
 * 主动作：按指纹决定是否删缓存目录，并把当前指纹落盘。
 *
 * **每一步都不抛**：读不到、删不掉、写不进去都只跳过那一步。判别与副作用分开，
 * 是为了让用例能在临时目录上真跑（不污染仓库的 `node_modules`）。
 *
 * @param {{ root?: string, log?: (line: string) => void, check?: boolean }} [opts]
 * @returns {{ changed: boolean, reason: string, cacheDir: string, removed: boolean }}
 */
export function runFingerprint({
  root = ROOT,
  log = () => {},
  check = false,
} = {}) {
  const cacheDir = path.join(root, CACHE_DIR_REL);
  const current = computeFingerprint(root);
  const { changed, reason } = fingerprintChanged(
    readStoredFingerprint(root),
    current,
  );

  let removed = false;
  if (changed && !check) {
    // 只在「缓存真的在」时删（不存在没什么可删的，也不算异常）。
    try {
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        removed = true;
      }
    } catch (err) {
      log(`[eslint-cache] 删缓存目录失败，跳过：${String(err)}`);
    }
    // 指纹要在**这一轮依赖树**上落盘：这就是下一次 install 的比对基线。
    try {
      fs.mkdirSync(path.dirname(path.join(root, FINGERPRINT_REL)), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(root, FINGERPRINT_REL),
        `${JSON.stringify(current, null, 2)}\n`,
        "utf8",
      );
    } catch (err) {
      log(`[eslint-cache] 写指纹失败，下次会重新判「变了」：${String(err)}`);
    }
  }

  if (changed) {
    log(
      removed
        ? `[eslint-cache] 依赖指纹变化（${reason}）→ 已删除 ${CACHE_DIR_REL}`
        : `[eslint-cache] 依赖指纹变化（${reason}）→ 缓存将在下次 lint 时全量重建`,
    );
  }
  return { changed, reason, cacheDir, removed };
}

/** 命令行入口：默认执行（删缓存 + 落盘），`--check` 只报结论不动手。 */
function main() {
  const check = process.argv.includes("--check");
  try {
    const result = runFingerprint({
      check,
      log: (line) => process.stdout.write(`${line}\n`),
    });
    if (!result.changed)
      process.stdout.write("[eslint-cache] 依赖指纹未变，缓存保留。\n");
  } catch {
    // 自查入口也不给调用方制造失败：这条判据的失效应表现为「缓存没被清」，
    // 而不是「install 挂了」。
  }
  process.exit(0);
}

// 被 import 时不做任何事（`tests/*` 直接调函数）；只有作为入口才跑 main。
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
