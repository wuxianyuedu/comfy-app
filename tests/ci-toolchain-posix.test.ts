/**
 * Linux 侧宿主自证（`scripts/ci-toolchain-posix.mjs`，ISSUE #1993）。
 *
 * ── 这条判据守的是什么 ──────────────────────────────────────────────────
 *
 * 它回答的是 Windows 侧那两条（`工具链自证` + `Install dependencies`）在 POSIX 上
 * **答不出来的三格**：`bash` 在不在、coreutils 齐不齐、`python3` 有没有。而它的失效
 * 形态全都是「不说」：
 *
 *   ① **整步空转**（`main()` 一次不跑、退 0 且零输出）：`scripts/ci-toolchain-selfcheck.mjs`
 *      与 `python-probe.mjs` 都真栽过这一格（`file://${argv[1]}` 拼法在 Windows 上恒不
 *      相等），表现是「这一步没跑」被读成「这一步过了」。入口判据在
 *      `tests/script-main-guard.test.ts`，这里补一条「本文件也被它扫到」的形状判据。
 *   ② **把读数当判据**：`python3` 不在时它**不该红**（处置归 `Python 可用性` ——
 *      那一步认得 apt / dnf / apk，会就地装）。它红了会让流水线停在一个没人该修的位置。
 *   ③ **`bash` 不在时它不红**：stage shell 本身就是 bash，缺了它后面三十步的失败
 *      全都与判据无关 —— 这是唯一必须红的一格。
 *
 * ## 三处注入面都是为「在 POSIX 开发机上判 Linux 的形态」而存在的
 *
 * `has` / `exists` / `cwd` 都可注入，所以下面每一档都不依赖跑判据那台机器上碰巧有什么
 * （`ci-toolchain-python.mjs` 的注释里记着同一个教训：不注入时结论会变成「这台机器
 * 碰巧装没装」）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { main, probePosixHost } from "../scripts/ci-toolchain-posix.mjs";

const SOURCE = readFileSync(
  path.resolve(import.meta.dirname, "..", "scripts", "ci-toolchain-posix.mjs"),
  "utf8",
);

/**
 * 造一个「这台机器有什么」的世界。
 *
 * @param {string[]} present 在的命令名
 */
function worldWith(present: string[]) {
  return {
    has: (cmd: string) => present.includes(cmd),
    exists: () => false,
    cwd: "/nonexistent-fixture",
  };
}

describe("Linux 宿主自证：只有 bash 会红（ISSUE #1993）", () => {
  it("四件齐 ⇒ ready，且逐格都打了读数", () => {
    const result = probePosixHost(
      worldWith([
        "bash",
        "mktemp",
        "sha256sum",
        "timeout",
        "git",
        "node",
        "pnpm",
        "python3",
      ]),
    );
    expect(result.verdict).toBe("ready");
    const names = result.rows.map((r) => r.格);
    for (const must of ["bash", "python3", "git", "node", "pnpm"]) {
      expect(names, `读数里少了 ${must} 那一格`).toContain(must);
    }
    // 每一格都有话说（判据要给人一句能读的话，不是只给布尔）。
    for (const row of result.rows) expect(row.读数.length).toBeGreaterThan(0);
  });

  it("缺 bash ⇒ broken（这是**唯一**会红的一格）", () => {
    const result = probePosixHost(
      worldWith(["mktemp", "sha256sum", "timeout", "git", "node", "pnpm", "python3"]),
    );
    expect(result.verdict).toBe("broken");
    expect(result.advice, "缺 bash 时必须给出下一动作").toBeTruthy();
    expect(result.advice).toContain("bash");
  });

  it("缺 python3 ⇒ **仍 ready**（只打读数；处置归 `Python 可用性`）", () => {
    /* 这一档是刻意「不红」的：`Python 可用性` 那一步认得 apt / dnf / apk，会就地装。
     * 在这里再红一次等于让流水线停在一个人不该修的位置（而它也不会修 —— 它没有装的能力）。 */
    const result = probePosixHost(
      worldWith(["bash", "mktemp", "sha256sum", "timeout", "git", "node", "pnpm"]),
    );
    expect(result.verdict).toBe("ready");
    const py = result.rows.find((r) => r.格 === "python3");
    expect(py?.读数, "缺 python3 时读数要说清处置归谁").toContain("Python 可用性");
  });

  it("缺 coreutils ⇒ **仍 ready**（它们是门禁里的东西，不是这一步的前提）", () => {
    const result = probePosixHost(worldWith(["bash", "git", "node", "pnpm", "python3"]));
    expect(result.verdict).toBe("ready");
    const mktemp = result.rows.find((r) => r.格 === "mktemp");
    expect(mktemp?.读数, "缺它时要说清后果").toContain("子进程");
  });

  it("`node_modules/.bin/tsc`：**不判「现在在不在」**（这一步跑在装依赖之前）", () => {
    /* 新检出里它必然不在（`pnpm install` 之后才有）。判它就是每个新节点首跑必红，
     * 而那条红与「这台机器缺什么」毫无关系。所以这一格的可判之处是
     * 「`package.json` 声明了 typescript」—— 那才是「装完之后会不会有」。 */
    const withoutTsc = probePosixHost({
      ...worldWith(["bash", "git", "node", "pnpm", "python3"]),
      exists: () => false,
      cwd: path.resolve(import.meta.dirname, ".."),
    });
    expect(withoutTsc.verdict).toBe("ready");
    const row = withoutTsc.rows.find((r) => r.格 === "node_modules/.bin/tsc");
    expect(row?.读数).toContain("装完依赖");
  });

  it("`package.json` 读不到时那一格**只说读数**、不判红（判据只收 bash）", () => {
    /* 这一格曾经被我写成「声明没了 ⇒ 红」，而它跑在装依赖之前：新检出里
     * `node_modules/.bin/tsc` 必然不在，拿它判红等于每个新节点首跑必红 ——
     * 那条红与「这台机器缺什么」毫无关系。所以判据只收一条：`bash`。 */
    const result = probePosixHost({
      ...worldWith(["bash", "git", "node", "pnpm", "python3"]),
      exists: () => false,
      cwd: "/nonexistent-fixture",
    });
    const row = result.rows.find((r) => r.格 === "node_modules/.bin/tsc");
    expect(row?.ok).toBe(true);
    expect(result.verdict).toBe("ready");
    expect(row?.读数).toContain("静默绕过");
  });

  it("入口：ready 退 0、broken 退非零，读数都打到 stdout", () => {
    const ok: string[] = [];
    expect(
      main({
        probe: () => probePosixHost(worldWith(["bash", "git", "node", "pnpm"])),
        out: (s: string) => ok.push(s),
      }),
    ).toBe(0);
    expect(ok.join("")).toContain("POSIX 宿主自证");

    const bad: string[] = [];
    expect(
      main({ probe: () => probePosixHost(worldWith([])), out: (s) => bad.push(s) }),
    ).toBe(1);
    expect(bad.join("")).toContain("bash");
  });

  it("只 import `node:*`（这一步跑在 `pnpm install` 之前）", () => {
    /* 与 `ci-toolchain-selfcheck.mjs` 同一条硬约束，理由逐字相同：那时 `node_modules`
     * 还没有，import 任何仓库内模块都会让这一步以 `Cannot find module` 收场 ——
     * 而它本来要回答的就是「这台机器上有什么」。 */
    const imports = [...SOURCE.matchAll(/^import .* from "([^"]+)";$/gm)].map(
      (m) => m[1] ?? "",
    );
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((s) => !s.startsWith("node:"))).toEqual([]);
  });

  it("入口形态：`fileURLToPath` 判「是不是直接运行」（不拼 `file://${argv[1]}`）", () => {
    /* 拼法在 Windows 上恒不相等（两斜杠 + 反斜杠 vs 三斜杠 + 正斜杠）⇒ `main()`
     * 一次都不跑、进程退 0 且零输出。本文件虽然只在 POSIX 上跑，但这个守卫是全仓级的：
     * 破一次就是一条需要逐文件解释的例外。主判据见 `tests/script-main-guard.test.ts`。 */
    expect(SOURCE).toContain("fileURLToPath(import.meta.url)");
    /* 反面形态：拿 `argv[1]` 去拼 `file://` 前缀（**不许**）。判之前先剥掉注释 ——
     * 说明里正当地会写出那个形状，把说明判成违规等于逼人删注释
     * （`ps7OnlySyntaxIn()` 对它自己那批判据的处理是同一条）。 */
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    expect(code).not.toMatch(/`file:\/\/\$\{/);
  });
});
