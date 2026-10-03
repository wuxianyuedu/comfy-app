/**
 * `scripts/invalidate-lint-cache.mjs` 的执行者。
 *
 * 钉两件事：
 *  1. **失效判定本身**：依赖 / 类型口径变了要清、没变不许清、读不到输入不许清也不许炸。
 *  2. **它真的接在 `pnpm install` 上，且清的是 lint 真正在用的那个目录** —— 只测纯函数的话，
 *     「导出了却没人调用」与「清错目录」（改了 `--cache-location` 而失效器还盯着老路径）
 *     这两种失效都会静默通过，而那两格正是本线一直在收的。
 *
 * 真跑文件系统的一组用临时目录，不碰仓库自己的 `node_modules`。
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CACHE_DIR_REL,
  FINGERPRINT_INPUTS,
  STAMP_REL,
  computeFingerprint,
  runAndReport,
  syncLintCache,
} from "../scripts/invalidate-lint-cache.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/** package.json 走文本读：不为一条用例去赌 resolveJsonModule 的开法。 */
function readPkg(): { scripts: Record<string, string> } {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  const scripts =
    typeof raw === "object" && raw !== null
      ? (raw as { scripts?: unknown }).scripts
      : undefined;
  expect(scripts, "package.json 里没有 scripts 段？").toBeTypeOf("object");
  return { scripts: scripts as Record<string, string> };
}

/** 读失效器落下的指纹文件（形状外来的东西一律收窄后再用，不许 `any` 漏进断言）。 */
function stampFingerprint(root: string): string | null {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(root, STAMP_REL), "utf8"),
  );
  if (typeof raw !== "object" || raw === null) return null;
  const fp = (raw as { fingerprint?: unknown }).fingerprint;
  return typeof fp === "string" ? fp : null;
}

/** 造一棵最小假仓库：lockfile / tsconfig / 已装标记 + 一个存在的 eslint 缓存目录。 */
function makeTree(probe = "v1"): string {
  const root = mkdtempSync(path.join(tmpdir(), "lint-cache-"));
  writeFileSync(
    path.join(root, "pnpm-lock.yaml"),
    `lockfileVersion: ${probe}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(root, "tsconfig.json"),
    '{"compilerOptions":{}}\n',
    "utf8",
  );
  mkdirSync(path.join(root, "node_modules/.pnpm"), { recursive: true });
  writeFileSync(
    path.join(root, "node_modules/.pnpm/lock.yaml"),
    `installed: ${probe}\n`,
    "utf8",
  );
  mkdirSync(path.join(root, CACHE_DIR_REL), { recursive: true });
  writeFileSync(path.join(root, CACHE_DIR_REL, ".eslintcache"), "{}\n", "utf8");
  return root;
}

function putCache(root: string): void {
  mkdirSync(path.join(root, CACHE_DIR_REL), { recursive: true });
  writeFileSync(path.join(root, CACHE_DIR_REL, ".eslintcache"), "{}\n", "utf8");
}

function readAll(root: string) {
  return (rel: string) => {
    try {
      return readFileSync(path.join(root, rel));
    } catch {
      return null;
    }
  };
}

describe("lint 缓存的按指纹失效", () => {
  it("首次没有指纹文件 → 保守清一次并落下指纹；再跑同状态 → 保留", () => {
    const root = makeTree();
    try {
      expect(syncLintCache({ root }).action).toBe("cleared");
      expect(existsSync(path.join(root, CACHE_DIR_REL))).toBe(false);
      expect(stampFingerprint(root)).toBeTruthy();

      putCache(root);
      expect(syncLintCache({ root }).action).toBe("kept");
      expect(existsSync(path.join(root, CACHE_DIR_REL))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lockfile 变了 → 清掉缓存、写新指纹", () => {
    const root = makeTree();
    try {
      syncLintCache({ root });
      putCache(root);
      expect(syncLintCache({ root }).action).toBe("kept");

      writeFileSync(
        path.join(root, "pnpm-lock.yaml"),
        "lockfileVersion: v2\n",
        "utf8",
      );
      const res = syncLintCache({ root });
      expect(res.action).toBe("cleared");
      expect(res.detail).toContain("依赖/类型口径已变");
      expect(existsSync(path.join(root, CACHE_DIR_REL))).toBe(false);
      expect(stampFingerprint(root)).toBe(res.fingerprint);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("tsconfig 与「实际装了什么」各自都能触发失效（三样输入不是摆设）", () => {
    const root = makeTree();
    try {
      syncLintCache({ root });
      putCache(root);
      writeFileSync(
        path.join(root, "tsconfig.json"),
        '{"include":["x"]}\n',
        "utf8",
      );
      expect(syncLintCache({ root }).action).toBe("cleared");

      putCache(root);
      writeFileSync(
        path.join(root, "node_modules/.pnpm/lock.yaml"),
        "installed: v2\n",
        "utf8",
      );
      expect(syncLintCache({ root }).action).toBe("cleared");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("一份输入都读不到 → 跳过，且绝不碰缓存", () => {
    let removed = 0;
    const res = syncLintCache({
      root: path.join(tmpdir(), "no-such-repo-9c1b"),
      read: () => null,
      remove: () => {
        removed += 1;
      },
      write: () => undefined,
    });
    expect(res.action).toBe("skipped");
    expect(res.fingerprint).toBeNull();
    expect(removed).toBe(0);
  });

  it("失效器自己抛错时，入口把它咽掉并打印跳过（postinstall 不许非零退出）", () => {
    const lines: string[] = [];
    const { result, error } = runAndReport(
      () => {
        throw new Error("EBUSY: resource busy or locked");
      },
      (line: string) => lines.push(line),
    );
    expect(result).toBeNull();
    expect(error).toContain("EBUSY");
    expect(lines[0]).toContain("[lint-cache] 跳过");
  });

  it("确实挂在 postinstall 上，且入口真跑一次退 0（不是导出了却没人调用）", () => {
    expect(readPkg().scripts.postinstall ?? "").toContain(
      "node scripts/invalidate-lint-cache.mjs",
    );
    // 把「仓库根」指到临时目录再跑：入口要真的执行（退 0 + 打印 + 落指纹），
    // 但不许碰开发者自己的热缓存 —— 有副作用的用例会在别人跑测试时清掉缓存。
    const root = makeTree();
    try {
      const r = spawnSync(
        process.execPath,
        ["scripts/invalidate-lint-cache.mjs"],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: { ...process.env, COMFYAPP_LINT_CACHE_ROOT: root },
        },
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("[lint-cache]");
      expect(existsSync(path.join(root, STAMP_REL))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("清的必须是 lint 真正在用的那个目录，三样输入都真参与指纹", () => {
    const lintScript = readPkg().scripts.lint ?? "";
    expect(lintScript, "package.json 里没有 lint 脚本？").not.toBe("");
    const location = /--cache-location\s+(\S+)/.exec(lintScript)?.[1];
    expect(location, "lint 脚本还带 --cache-location 吗？").toBeTruthy();
    expect(location).toBe(CACHE_DIR_REL);

    const root = makeTree();
    try {
      const read = readAll(root);
      for (const rel of FINGERPRINT_INPUTS) {
        expect(
          existsSync(path.join(REPO_ROOT, rel)),
          `${rel} 在仓库里不存在`,
        ).toBe(true);
        const before = computeFingerprint(read);
        const original = readFileSync(path.join(root, rel));
        try {
          writeFileSync(
            path.join(root, rel),
            `${original.toString()}\n/* probe */\n`,
          );
          expect(computeFingerprint(read), `${rel} 的变化没进指纹`).not.toBe(
            before,
          );
        } finally {
          writeFileSync(path.join(root, rel), original);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("文档侧那句「手动删缓存」不许回来（换成自动失效就是这一刀的全部意义）", () => {
    const hook = readFileSync(
      path.join(REPO_ROOT, ".githooks/pre-commit"),
      "utf8",
    );
    expect(hook).not.toContain("先删掉该缓存目录");
    expect(hook).toContain("invalidate-lint-cache.mjs");
  });
});
