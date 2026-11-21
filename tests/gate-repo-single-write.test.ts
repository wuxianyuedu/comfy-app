/**
 * 门禁夹具的**落盘契约**：同一条工作区路径只被写一次（ISSUE #2380，现场是 PR #2377）。根因：`createGateRepo()` 的
 * `copy` 与按 import 追出的同目录依赖两条写入路径指到同一落点（现场 `lock-diff.mjs` 整行 NUL 致加载期 SyntaxError）。
 * 红在四十份消费方断言上，故判**落盘次数**（不是顺序）：copy+import ⇒ 只落一次且与源一致；依赖链不相交时照旧自动补齐。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildRuntimeSourceIndex,
  copyGateDeps,
  createGateRepo,
  type GateRepoHandle,
} from "./helpers/gate-repo";

const REPO_ROOT = path.resolve(__dirname, "..");

const handles: Array<GateRepoHandle> = [];
afterEach(() => {
  while (handles.length > 0) {
    handles.pop()?.dispose();
  }
});

/** 建一个工作区，并把它记下来给 `afterEach` 收尾。 */
function repo(options: Parameters<typeof createGateRepo>[0]): GateRepoHandle {
  const handle = createGateRepo(options);
  handles.push(handle);
  return handle;
}

describe("门禁夹具：同一条路径只写一次", () => {
  /**
   * 观测点选的是**源码里的落盘口径**，不是运行期计数：夹具用 static import 绑定，宿主侧
   * `fs.cpSync = spy` 无效（实测落盘了也数到 0），那种用例永远绿。两条真判的：① 现场（#2380）
   * `copy` + import 同目录 ⇒ 文件与源逐字、长度一致（NUL 填充/半写必红）；② `createGateRepo` 只有一处 `cpSync(`。
   */
  it("整目录 copy 与依赖链重叠时，那个文件与源逐字一致", () => {
    const { repo: gate } = repo({
      script: "gates/check-deps-freshness.mjs",
      workdir: "gate-repo-single-write",
      // 与 `tests/deps-freshness-gate.test.ts` 同一形状：整目录拷 + 判据自己
      // 又 `import "./lockfile/lock-diff.mjs"`。
      copy: [{ from: "scripts/lockfile", to: "scripts/lockfile" }],
    });

    for (const name of ["lock-diff.mjs", "render-lock-diff.mjs"]) {
      const written = path.join(gate.dir, "scripts", "lockfile", name);
      const source = path.join(REPO_ROOT, "scripts", "lockfile", name);
      expect(
        readFileSync(written),
        `${name} 与源不一致 —— 有第二条写入路径覆盖过它（ISSUE #2380 的 NUL 填充形态）`,
      ).toEqual(readFileSync(source));
    }
  });

  it("两条来路共用一处落盘（夹具里只有一个 cpSync 调用点）", () => {
    const helper = readFileSync(path.join(REPO_ROOT, "tests", "helpers", "gate-repo.ts"), "utf8");
    const callSites = helper.match(/\bcpSync\(/g) ?? [];
    expect(
      callSites.length,
      "夹具里出现了第二处 cpSync —— `copy` 与 `copyGateDeps` 各写各的，同一条路径就会写两遍",
    ).toBe(1);
    expect(
      helper.includes("copyGateDeps(path.join(root, scriptRel), place, copySeeds)"),
      "依赖链没有再走那一处收口（`place`）—— 「已存在的目标不覆盖」就管不到 `copy` 刚落的那些",
    ).toBe(true);
  });

  it("依赖链与 copy 不相交时，同目录依赖仍被自动补齐", () => {
    // 只拷 `lockfile/` 目录，`dependency-face.mjs` / `git-dir.mjs` 得靠依赖链补。
    const { repo: gate } = repo({
      script: "gates/check-deps-freshness.mjs",
      workdir: "gate-repo-deps-still-copied",
      copy: [{ from: "scripts/lockfile", to: "scripts/lockfile" }],
    });

    for (const name of ["dependency-face.mjs", "git-dir.mjs"]) {
      expect(
        gate.exists(path.join("scripts", "lib", name)),
        `${name} 没被带进工作区 —— 判据跑起来会是 ERR_MODULE_NOT_FOUND`,
      ).toBe(true);
    }
  });

  it("用例自己写在 files 里的同名文件优先，不被依赖链覆盖", () => {
    // `files` 拥有它自己的路径：依赖链只补「还没有人写过」的那些。
    const { repo: gate } = repo({
      script: "gates/check-deps-freshness.mjs",
      workdir: "gate-repo-files-owned",
      files: { "scripts/lockfile/lock-diff.mjs": "// 用例自己的夹具\n" },
      copy: [{ from: "scripts/lockfile", to: "scripts/lockfile" }],
    });

    expect(gate.read(path.join("scripts", "lockfile", "lock-diff.mjs"))).toBe(
      "// 用例自己的夹具\n",
    );
  });
});

describe("门禁夹具：显式 copy 的传递依赖自动闭合（ISSUE #4691）", () => {
  /**
   * 现场：#4688 为让 on-demand-duties 沙箱跑起来，沿 freshness-ledger →
   * freshness-ledger-sync → shell.mjs → executable-resolve.ts → platform /
   * pnpm-resolve / version-compare 手补了六件 `copy:`；同族坑 #4654（log.mjs）
   * 已犯过一次。修法：显式 copy 的真实源也进 `copyGateDeps` 的 BFS 队列 ——
   * 拷一件 = 它的仓库内依赖链自动闭合。
   */
  it("显式拷入的模块，其仓库内 import 链自动补齐，不必逐个手补", () => {
    const { repo: gate } = repo({
      script: "gates/check-on-demand-duties.cjs",
      workdir: "gate-repo-copy-closure",
      copy: [
        {
          from: "scripts/freshness/freshness-ledger.mjs",
          to: "scripts/freshness/freshness-ledger.mjs",
        },
      ],
    });

    for (const rel of [
      path.join("scripts", "launcher-core", "log.mjs"),
      path.join("scripts", "freshness", "freshness-ledger-sync.mjs"),
      path.join("scripts", "launcher-core", "shell.mjs"),
      path.join("scripts", "launcher-core", "command-echo.mjs"),
      path.join("src", "lib", "process", "executable-resolve.ts"),
      path.join("src", "lib", "process", "platform.ts"),
      path.join("src", "lib", "process", "pnpm-resolve.ts"),
      path.join("src", "lib", "process", "version-compare.ts"),
    ]) {
      expect(gate.exists(rel), `${rel} 应随显式 copy 的传递依赖自动落盘`).toBe(true);
    }
  });

  it("整目录 copy 也展开扫描：目录内文件的依赖同样闭合", () => {
    const { repo: gate } = repo({
      script: "gates/check-deps-freshness.mjs",
      workdir: "gate-repo-copy-closure-dir",
      copy: [{ from: "scripts/launcher-core", to: "scripts/launcher-core" }],
    });

    for (const rel of [
      path.join("src", "lib", "process", "executable-resolve.ts"),
      path.join("src", "lib", "process", "version-compare.ts"),
      // launcher-core/worktree.mjs 的仓库内依赖（判据入口的 import 链之外）。
      path.join("scripts", "lockfile", "lock-diff.mjs"),
    ]) {
      expect(gate.exists(rel), `${rel} 应随整目录 copy 的传递依赖自动落盘`).toBe(true);
    }
  });
});

describe("门禁夹具：src .ts 重名不静默指错（ISSUE #4702）", () => {
  const tempRoots: Array<string> = [];
  afterEach(() => {
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  /** 造一个受控的「仓库切面」：scripts/ 一份 .cjs；src/ 里 a、b 两个目录各有一份
   *  dup.ts（重名），另有唯一名 uniq.ts 与三类排除件（index / test / 声明）。 */
  function makeSlice(): { scriptsDir: string; srcDir: string } {
    const root = mkdtempSync(path.join(tmpdir(), "gate-repo-ambiguous-"));
    tempRoots.push(root);
    const scriptsDir = path.join(root, "scripts");
    const srcDir = path.join(root, "src");
    mkdirSync(path.join(scriptsDir, "gates"), { recursive: true });
    writeFileSync(path.join(scriptsDir, "gates", "only-gate.cjs"), "module.exports = 1;\n");
    for (const sub of ["a", "b"]) {
      mkdirSync(path.join(srcDir, sub), { recursive: true });
      writeFileSync(path.join(srcDir, sub, "dup.ts"), `export const side = "${sub}";\n`);
    }
    writeFileSync(path.join(srcDir, "uniq.ts"), "export const uniq = 1;\n");
    writeFileSync(path.join(srcDir, "index.ts"), "export {};\n");
    writeFileSync(path.join(srcDir, "sample.test.ts"), "export {};\n");
    writeFileSync(path.join(srcDir, "sample.d.ts"), "export {};\n");
    return { scriptsDir, srcDir };
  }

  it("buildRuntimeSourceIndex：重名 .ts 被剔除并标记 ambiguous；唯一名照常入索引；排除件不进", () => {
    const { scriptsDir, srcDir } = makeSlice();
    const index = buildRuntimeSourceIndex(scriptsDir, srcDir);
    expect(index.sources.has("dup.ts"), "重名件不许留在索引里（静默取先见者 = 指错真源）").toBe(
      false,
    );
    expect(index.ambiguous.has("dup.ts")).toBe(true);
    expect(index.sources.get("uniq.ts")).toBe(path.join(srcDir, "uniq.ts"));
    expect(index.sources.get("only-gate.cjs")).toBe(
      path.join(scriptsDir, "gates", "only-gate.cjs"),
    );
    for (const excluded of ["index.ts", "sample.test.ts", "sample.d.ts"]) {
      expect(index.sources.has(excluded), `${excluded} 不是运行时依赖`).toBe(false);
      expect(index.ambiguous.has(excluded)).toBe(false);
    }
  });

  it("copyGateDeps 命中重名：不落盘 + 返回一句可读告警（不静默跳过）", () => {
    const { scriptsDir, srcDir } = makeSlice();
    const index = buildRuntimeSourceIndex(scriptsDir, srcDir);
    const sandbox = mkdtempSync(path.join(tmpdir(), "gate-repo-ambiguous-sandbox-"));
    tempRoots.push(sandbox);
    const gateAbs = path.join(sandbox, "gate.cjs");
    writeFileSync(gateAbs, 'require("./dup.ts");\n');
    const warnings = copyGateDeps(gateAbs, undefined, [], index);
    expect(
      existsSync(path.join(sandbox, "dup.ts")),
      "重名件不许被自动补齐 —— 两个候选都不可信，缺件可归因",
    ).toBe(false);
    const joined = warnings.join("");
    expect(joined).toContain("重名");
    expect(joined).toContain("GateRepoOptions.copy");
  });
});
