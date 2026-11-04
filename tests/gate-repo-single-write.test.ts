/**
 * 门禁夹具的**落盘契约**：同一条工作区路径只被写一次（ISSUE #2380，现场是 PR #2377）。根因：`createGateRepo()` 的
 * `copy` 与按 import 追出的同目录依赖两条写入路径指到同一落点（现场 `lock-diff.mjs` 整行 NUL 致加载期 SyntaxError）。
 * 红在四十份消费方断言上，故判**落盘次数**（不是顺序）：copy+import ⇒ 只落一次且与源一致；依赖链不相交时照旧自动补齐。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGateRepo, type GateRepoHandle } from "./helpers/gate-repo";

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
      script: "check-deps-freshness.mjs",
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
      helper.includes("copyGateDeps(path.join(root, scriptRel), place)"),
      "依赖链没有再走那一处收口（`place`）—— 「已存在的目标不覆盖」就管不到 `copy` 刚落的那些",
    ).toBe(true);
  });

  it("依赖链与 copy 不相交时，同目录依赖仍被自动补齐", () => {
    // 只拷 `lockfile/` 目录，`dependency-face.mjs` / `git-dir.mjs` 得靠依赖链补。
    const { repo: gate } = repo({
      script: "check-deps-freshness.mjs",
      workdir: "gate-repo-deps-still-copied",
      copy: [{ from: "scripts/lockfile", to: "scripts/lockfile" }],
    });

    for (const name of ["dependency-face.mjs", "git-dir.mjs"]) {
      expect(
        gate.exists(path.join("scripts", name)),
        `${name} 没被带进工作区 —— 判据跑起来会是 ERR_MODULE_NOT_FOUND`,
      ).toBe(true);
    }
  });

  it("用例自己写在 files 里的同名文件优先，不被依赖链覆盖", () => {
    // `files` 拥有它自己的路径：依赖链只补「还没有人写过」的那些。
    const { repo: gate } = repo({
      script: "check-deps-freshness.mjs",
      workdir: "gate-repo-files-owned",
      files: { "scripts/lockfile/lock-diff.mjs": "// 用例自己的夹具\n" },
      copy: [{ from: "scripts/lockfile", to: "scripts/lockfile" }],
    });

    expect(gate.read(path.join("scripts", "lockfile", "lock-diff.mjs"))).toBe(
      "// 用例自己的夹具\n",
    );
  });
});
