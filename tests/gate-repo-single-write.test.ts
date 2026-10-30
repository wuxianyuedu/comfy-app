/**
 * 门禁夹具的**落盘契约**：同一条工作区路径只被写一次（ISSUE #2380）。
 *
 * 立案现场是 PR #2377 的「受影响用例」一格：临时仓库里那份
 * `scripts/lockfile/lock-diff.mjs` 整行是 NUL 填充，模块加载期直接
 * `SyntaxError: Invalid or unexpected token` —— 报错指向临时目录里那一份，
 * 读起来像判据坏了。根因是 `createGateRepo()` 里两条写入路径（用例声明的
 * 整目录 `copy` 与按 import 追出来的同目录依赖）指到同一个落点，各写一遍。
 *
 * 为什么这个契约要有一条用例守着：它红的样子**不在夹具里**，而在四十份消费方的
 * 某一条断言上（「expected … to contain '[未校验]'」），而那条断言一个字都没错。
 * 于是「夹具又写重了一次」的形状必须在这里就地读得出来 —— 判的是**落盘次数**，
 * 不是顺序：把顺序换个方向只是把雷埋起来，判据将来在目录里加一个 import 就再炸一次。
 *
 * 两条口径：
 *   ① 走 `copy` 整目录拷 + 判据 import 该目录里的文件（#2380 的现场形状）→ 目录里
 *      每个文件**只落一次**，且内容与源一致；
 *   ② 依赖链与 `copy` 不相交时照旧自动补齐（回归面：收口不能把「自动带依赖」关掉）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGateRepo, type GateRepoHandle } from "./helpers/gate-repo";

const REPO_ROOT = path.resolve(__dirname, "..");

const handles: Array<GateRepoHandle> = [];
afterEach(() => {
  while (handles.length > 0) handles.pop()?.dispose();
});

/** 建一个工作区，并把它记下来给 `afterEach` 收尾。 */
function repo(options: Parameters<typeof createGateRepo>[0]): GateRepoHandle {
  const handle = createGateRepo(options);
  handles.push(handle);
  return handle;
}

describe("门禁夹具：同一条路径只写一次", () => {
  /**
   * 观测点选的是**源码里的落盘口径**，不是运行期计数。
   *
   * 为什么不去数 `fs.cpSync` 被调了几次：夹具用的是 static import 绑定，
   * 宿主侧的 `fs.cpSync = spy` 对它无效（实测明明落盘了也数到 0）—— 那种用例会
   * 永远绿，而它自称在判「写了两次」。这里换成能真判的形态：
   *
   *   ① 现场形状（#2380）：`copy` 整目录拷 + 判据又 import 目录里的文件 ⇒ 那个文件
   *      内容与源逐字一致、长度一致（覆盖写出 NUL 填充 / 半写时必红）；
   *   ② 收口本身：`createGateRepo` 里**只有一处** `cpSync(`，且 `copy` 与
   *      `copyGateDeps` 共用它 —— 反过来说，两条各自落盘的写法会让这条红。
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
