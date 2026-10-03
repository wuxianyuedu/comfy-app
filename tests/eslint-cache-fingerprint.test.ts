/**
 * 回归护栏：**eslint 增量缓存必须在依赖变化后失效**（ISSUE #1399）。
 *
 * 现场（用户实测）：依赖已经装好，`pnpm run lint` 仍报 3 条
 * `@typescript-eslint/no-unsafe-assignment`；同一批文件加 `--no-cache` 是 0 条，
 * 删掉 `node_modules/.cache/eslint` 后冷跑也是 0 条。差的就是那份缓存。
 *
 * 机制：eslint 的缓存键 =「文件内容 + 解析后的 eslint 配置」，**不含装了哪些依赖**，
 * 也不含 `tsconfig.json` 的解析口径；而 `no-unsafe-*` 是**类型化规则**。于是依赖一变，
 * 旧判决被重放，两个方向都会错：假红（拦住从该缓存起的所有提交）与假绿（洗掉新依赖
 * 带进来的真违规）。此前唯一的处理是钩子里那句「升级 eslint 之后先手动删缓存目录」
 * —— 靠人记得删 = 没有执行者，且触发面写窄了（真实触发是任何依赖变化）。
 *
 * 本用例钉住三件事：
 *   ① 判据形状：指纹由「声明要装什么 + 实际装上了什么 + 类型解析口径」三类组成，
 *      且**不含** `eslint.config.js`（它在 eslint 自己的缓存键里）；
 *   ② 两个方向都真跑：指纹变了 → 缓存目录真被删；指纹没变 → 缓存**保留**
 *      （保留是这一层的价值所在：稳态热跑 28.8–46.3s 的代价不能被白付）；
 *   ③ postinstall 入口把它接上了（改 `.githooks/**` 时增量层会放弃收窄，所以这条
 *      必须在固定清单里跑 —— 见 `scripts/affected-tests.mjs` 的注释）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CACHE_DIR_REL,
  FINGERPRINT_INPUTS,
  FINGERPRINT_REL,
  computeFingerprint,
  fingerprintChanged,
  readStoredFingerprint,
  runFingerprint,
} from "../scripts/eslint-cache-fingerprint.mjs";

const ROOT = process.cwd();
const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

/** 造一个最小检出：三份指纹输入 + 一份「假装是缓存」的目录。 */
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eslint-fp-"));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  fs.mkdirSync(path.join(dir, "node_modules", ".pnpm"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "node_modules", ".pnpm", "lock.yaml"),
    "lockfileVersion: 9\n",
  );
  fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}\n");
  fs.mkdirSync(path.join(dir, CACHE_DIR_REL), { recursive: true });
  fs.writeFileSync(path.join(dir, CACHE_DIR_REL, "probe.json"), "{}\n");
  return dir;
}

const cacheExists = (root: string): boolean =>
  fs.existsSync(path.join(root, CACHE_DIR_REL));

describe("指纹口径（ISSUE #1399）", () => {
  it("输入集是「声明要装什么 + 实际装上了什么 + 类型解析口径」", () => {
    // 逐字钉住，不是「长度 ≥ 3」——换掉任何一个都会让某个方向的旧判决被重放。
    expect(FINGERPRINT_INPUTS).toEqual([
      "pnpm-lock.yaml",
      "node_modules/.pnpm/lock.yaml",
      "tsconfig.json",
    ]);
  });

  it("**不含** eslint.config.js（它在 eslint 自己的缓存键里，登进来会造出假象）", () => {
    expect(FINGERPRINT_INPUTS).not.toContain("eslint.config.js");
  });

  it("裸仓库上算得出指纹，且缺文件记成 <missing> 而不是被跳过", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eslint-fp-empty-"));
    tmpDirs.push(dir);
    const fp = computeFingerprint(dir);
    // 跳过会让「lockfile 被删掉」这种拓扑变化哈希不变 —— 正是要拦的极端形态。
    for (const rel of FINGERPRINT_INPUTS)
      expect(fp.inputs[rel]).toBe("<missing>");
  });

  it("三份输入任一变化都判「变了」，并点名是哪一份", () => {
    const dir = makeRoot();
    const before = computeFingerprint(dir);
    fs.appendFileSync(path.join(dir, "pnpm-lock.yaml"), "# touched\n");
    const after = computeFingerprint(dir);
    const verdict = fingerprintChanged(before, after);
    expect(verdict.changed).toBe(true);
    expect(verdict.reason).toContain("pnpm-lock.yaml");
  });

  it("输入集变了（口径变更）也判「变了」，不会被读成「一致」", () => {
    const dir = makeRoot();
    const current = computeFingerprint(dir);
    const verdict = fingerprintChanged(
      { inputs: { 别的文件: "abc" } },
      current,
    );
    expect(verdict.changed).toBe(true);
    expect(verdict.reason).toContain("输入集");
  });

  it("没有旧指纹 / 形状不对 → 按「变了」处理（宁可多清一次）", () => {
    const dir = makeRoot();
    const current = computeFingerprint(dir);
    expect(fingerprintChanged(null, current).changed).toBe(true);
    expect(fingerprintChanged({ inputs: null }, current).changed).toBe(true);
    expect(
      fingerprintChanged(readStoredFingerprint(dir), current).changed,
    ).toBe(true);
  });
});

describe("两个方向都真跑（ISSUE #1399）", () => {
  it("依赖指纹变化 → 缓存目录真被删，且指纹落盘", () => {
    const dir = makeRoot();
    // 先落一次基线（首次接线）。
    runFingerprint({ root: dir });
    expect(cacheExists(dir)).toBe(false);
    // 重建缓存目录，再改一份输入 —— 这次才是「变化」。
    fs.mkdirSync(path.join(dir, CACHE_DIR_REL), { recursive: true });
    fs.writeFileSync(path.join(dir, CACHE_DIR_REL, "probe.json"), "{}\n");
    fs.appendFileSync(
      path.join(dir, "node_modules", ".pnpm", "lock.yaml"),
      "# installed more\n",
    );
    const result = runFingerprint({ root: dir });
    expect(result.changed).toBe(true);
    expect(result.removed).toBe(true);
    expect(cacheExists(dir)).toBe(false);
    expect(fs.existsSync(path.join(dir, FINGERPRINT_REL))).toBe(true);
  });

  it("依赖指纹未变 → 缓存**保留**（这条是这一层的价值：不能白付冷跑代价）", () => {
    const dir = makeRoot();
    runFingerprint({ root: dir }); // 落基线（顺手清掉初始那份）
    fs.mkdirSync(path.join(dir, CACHE_DIR_REL), { recursive: true });
    fs.writeFileSync(path.join(dir, CACHE_DIR_REL, "probe.json"), "{}\n");

    const second = runFingerprint({ root: dir });
    expect(second.changed).toBe(false);
    expect(second.removed).toBe(false);
    expect(cacheExists(dir)).toBe(true);
  });

  it("`--check` 只报结论、不动缓存（自查入口不许有副作用）", () => {
    const dir = makeRoot();
    const result = runFingerprint({ root: dir, check: true });
    expect(result.changed).toBe(true);
    expect(result.removed).toBe(false);
    expect(cacheExists(dir)).toBe(true);
    // 也不该落指纹：落了的话下一次真安装会以为「比对过、没变」。
    expect(fs.existsSync(path.join(dir, FINGERPRINT_REL))).toBe(false);
  });

  it("根目录整个不存在也不抛（postinstall 非零会带走整次 install）", () => {
    // 这条不是假想：入口会先 `git rev-parse` 判「在不在检出里」，而在 tarball
    // 解包 / 只读挂载这类形态上，后续每一步都可能读不到或写不进去。
    // 判据的形状是「不抛 + 退 0」，不是「一定删成功」。
    const missing = path.join(os.tmpdir(), "eslint-fp-does-not-exist");
    fs.rmSync(missing, { recursive: true, force: true });
    expect(() => runFingerprint({ root: missing })).not.toThrow();
  });
});

describe("postinstall 入口接线（ISSUE #1399）", () => {
  it("入口真跑时带上这一步，且 exit 0（不阻断 install）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postinstall-fp-"));
    tmpDirs.push(dir);
    // 入口按自身位置找仓库根，所以把两个脚本放进同一个最小检出。
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    for (const f of ["install-git-hooks.mjs", "eslint-cache-fingerprint.mjs"])
      fs.copyFileSync(
        path.join(ROOT, "scripts", f),
        path.join(dir, "scripts", f),
      );
    fs.mkdirSync(path.join(dir, CACHE_DIR_REL), { recursive: true });
    fs.writeFileSync(path.join(dir, CACHE_DIR_REL, "probe.json"), "{}\n");
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}\n");

    const out = execFileSync(
      process.execPath,
      [path.join(dir, "scripts", "install-git-hooks.mjs")],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(out).toContain("[eslint-cache]");
    // 首次接线没有旧指纹 → 判「变了」→ 缓存被清（那份缓存本来就不可信）。
    expect(cacheExists(dir)).toBe(false);
  });

  it("入口源码里这一步在 process.exit(0) **之前**（写在其后 = 永不执行）", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "scripts", "install-git-hooks.mjs"),
      "utf8",
    );
    const fingerprintAt = src.indexOf("eslint-cache-fingerprint.mjs");
    const exitAt = src.lastIndexOf("process.exit(0)");
    expect(fingerprintAt).toBeGreaterThan(-1);
    expect(fingerprintAt).toBeLessThan(exitAt);
  });
});
