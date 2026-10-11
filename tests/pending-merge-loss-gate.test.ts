/**
 * 「双亲在、内容丢了一侧」提交前档的执行者自测（规范 §11.23.6 / ISSUE #1618）。
 *
 * 这一档与 1-1（`merged-side-loss-gate.test.ts`）**共用内核**
 * （`scripts/merged-side-loss-core.mjs` 的 `findEarlierVersion`），但触发时机不同：
 * 它跑在**合并进行中**（`MERGE_HEAD` 在场、结果在索引里），判的是**本次结果**。
 *
 * 判定口径最容易被写坏的方向有两个，所以每一条各配一组**真 git 仓库**样本：
 *   · 写宽了 → 把「对方那一版就该覆盖本侧」这种**正当**的取一侧也报成退回；
 *   · 写窄了 → 真事故（`ad81a912` / `bdabd26f` 那种形态全对的合并）一个都拦不住。
 *
 * 覆盖（对应 ISSUE #1618 的验收标准）：
 *   ① 双亲在、某文件整份取非 HEAD 侧 → **当场阻断**，话术指名文件（立案现场形态）。
 *   ② 正确保留两侧的合并 → 放行（正常提交不被误拦）。
 *   ③ 非合并提交 → **零输出**（普通提交每次都会走到它，不能加噪声/耗时）。
 *   ④ `--amend`（source=commit）→ 放行（父提交不从 MERGE_HEAD 来）。
 *   ⑤ 「只有对方动过那个文件」→ 放行（HEAD 侧没改过它，取对方那版是正当的）。
 *   ⑥ 生成物（`docs/api/**`）整份取一侧 → 不报（退回即常态）。
 *   ⑦ 非 git 目录 → 放行不崩。
 *   ⑧ 生成物 + 正常 + 取一侧混合 → 只报该报的那一份。
 * 另有一条判**本仓库的钩子接线**：`.githooks/prepare-commit-msg` 真的接上了这条判据。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";
import { vi } from "vitest";

/* 每条用例都要真跑 git（init / add / commit / merge / checkout），负载高的机器上
 * 默认超时经常不够 —— 文件级放宽到 30s，只影响本文件。 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const SCRIPT = "check-pending-merge-loss.mjs";
/** 这个脚本的**同级依赖**。清单只在这里出现一次：共享夹具与 ⑦ 那个「故意不带 git」的
 *  裸目录都要把它们带上，抄成两份的后果是「加第三份依赖时只有其中一处跟着改」，
 *  而表现是子进程 `MODULE_NOT_FOUND` —— 看着像判据坏了，不像漏拷。 */
const SIBLINGS = ["merged-side-loss-core.mjs", "merged-side-loss-git.mjs"];

const { test, expect } = defineGateRepo({
  script: SCRIPT,
  /* 判据用 `import "./merged-side-loss-core.mjs"` 拉内核、用 `merged-side-loss-git.mjs`
   * 取证 —— 同级导入只能靠夹具的 `copy` 带进来。 */
  copy: SIBLINGS.map((f) => ({ from: `scripts/${f}`, to: `scripts/${f}` })),
  setup: (repo: GateRepo) => {
    repo.git("init", "-q", "-b", "main", ".");
    repo.git("config", "user.email", "gate@example.com");
    repo.git("config", "user.name", "gate");
    repo.git("config", "commit.gpgsign", "false");
  },
});

/**
 * 造一个「解冲突后待提交」的合并现场：main 与 feat 都改了 `a.ts` 与 `b.ts`，
 * 解冲突时由调用方决定每个文件取谁那一版。
 *
 * 返回解冲突前的两版内容，便于用例把「本侧 / 对方侧」写清楚。
 */
function startConflict(repo: GateRepo) {
  repo.write("src/a.ts", "a=1\n");
  repo.write("src/b.ts", "b=1\n");
  repo.git("add", "-A");
  repo.commit("chore: 初始化");

  repo.git("checkout", "-q", "-b", "feat");
  repo.write("src/a.ts", "a=feat\n");
  repo.write("src/b.ts", "b=feat\n");
  repo.git("add", "-A");
  repo.commit("feat: 对方侧改了两个文件");

  repo.git("checkout", "-q", "main");
  repo.write("src/a.ts", "a=main\n");
  repo.write("src/b.ts", "b=main\n");
  repo.git("add", "-A");
  repo.commit("chore: 本侧也改了两个文件");

  /* 冲突是预期内的：merge 会以非零退出，这里只要现场，不要它成功。 */
  try {
    repo.git("merge", "feat");
  } catch {
    /* 冲突 → 正是要的现场 */
  }
}

describe("check-pending-merge-loss —— 提交前档（整份取非 HEAD 侧）", () => {
  test("① 某文件整份取非 HEAD 侧 → 阻断并指名文件", ({ repo }) => {
    startConflict(repo);
    /* a.ts 正确保留两侧；b.ts 整份取 feat（非 HEAD）那一版。 */
    repo.write("src/a.ts", "a=main+feat\n");
    repo.write("src/b.ts", "b=feat\n");
    repo.git("add", "-A");

    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("src/b.ts");
    /* a.ts 是正常解出来的，不该被算成取一侧。 */
    expect(output).not.toContain("src/a.ts");
  });

  test("② 正确保留两侧的合并 → 放行", ({ repo }) => {
    startConflict(repo);
    repo.write("src/a.ts", "a=main+feat\n");
    repo.write("src/b.ts", "b=main+feat\n");
    repo.git("add", "-A");

    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("OK");
  });

  test("③ 非合并提交 → 零输出（不加噪声/耗时）", ({ repo }) => {
    repo.write("src/a.ts", "a=1\n");
    repo.git("add", "-A");
    repo.commit("chore: 普通提交");

    const { code, output } = repo.run();
    expect(code).toBe(0);
    /* #1618 验收标准 3 明确要求这一档**零输出** —— 普通提交每次都会走到它。 */
    expect(output).toBe("");
  });

  test("④ --amend（source=commit）→ 放行", ({ repo }) => {
    startConflict(repo);
    /* 就算把 b.ts 整份取了对方那一版，amend 形态也不判 —— 父提交不从 MERGE_HEAD 来。 */
    repo.write("src/b.ts", "b=feat\n");
    repo.git("add", "-A");

    const { code, output } = repo.run(["commit"]);
    expect(code).toBe(0);
    expect(output).toContain("source=commit");
  });

  test("⑤ 只有对方动过那个文件 → 放行（HEAD 侧没改过它）", ({ repo }) => {
    /* 这一条是**误报防线**：feat 动了 c.ts、main 一个字没碰 —— 合并里取 feat 那版
     * 是正常且唯一的选择，绝不能被报成「整份取一侧」。 */
    repo.write("src/a.ts", "a=1\n");
    repo.write("src/c.ts", "c=1\n");
    repo.git("add", "-A");
    repo.commit("chore: 初始化");

    repo.git("checkout", "-q", "-b", "feat");
    repo.write("src/c.ts", "c=feat\n");
    repo.git("add", "-A");
    repo.commit("feat: 对方改 c.ts");

    repo.git("checkout", "-q", "main");
    repo.write("src/a.ts", "a=main\n");
    repo.git("add", "-A");
    repo.commit("chore: 本侧只改 a.ts");

    /* a.ts 与 c.ts 改的是不同文件 → 无冲突，自动合并。为造出「待提交的合并」，
     * 用 --no-commit 停在中途。 */
    repo.git("merge", "--no-commit", "--no-ff", "feat");

    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("OK");
  });

  test("⑥ 生成物整份取一侧 → 不报（退回即常态）", ({ repo }) => {
    repo.write("docs/api/modules/lib_x.html", "<html>v1</html>\n");
    repo.write("src/a.ts", "a=1\n");
    repo.git("add", "-A");
    repo.commit("chore: 初始化");

    repo.git("checkout", "-q", "-b", "feat");
    repo.write("docs/api/modules/lib_x.html", "<html>v-feat</html>\n");
    repo.write("src/a.ts", "a=feat\n");
    repo.git("add", "-A");
    repo.commit("feat: 对方改产物与 a.ts");

    repo.git("checkout", "-q", "main");
    repo.write("docs/api/modules/lib_x.html", "<html>v-main</html>\n");
    repo.write("src/a.ts", "a=main\n");
    repo.git("add", "-A");
    repo.commit("chore: 本侧也改产物与 a.ts");

    try {
      repo.git("merge", "feat");
    } catch {
      /* 冲突现场 */
    }
    /* 结果：产物整份取 feat 版（常态，不判）；a.ts 正确保留两侧。 */
    repo.write("docs/api/modules/lib_x.html", "<html>v-feat</html>\n");
    repo.write("src/a.ts", "a=main+feat\n");
    repo.git("add", "-A");

    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("OK");
  });

  test("⑦ 非 git 目录 → 放行不崩", () => {
    /* 这一条要的正是**没有 git** 的工作区，不走共享夹具（它的 setup 会 init 仓库）。
     * 自己造一个裸目录：判据取不到 git 事实时应放行，而不是抛错。 */
    const bare = mkdtempSync(join(tmpdir(), "pending-merge-loss-nogit-"));
    try {
      for (const f of [SCRIPT, ...SIBLINGS]) {
        copyFileSync(join(process.cwd(), "scripts", f), join(bare, f));
      }
      const output = execFileSync(process.execPath, [join(bare, SCRIPT)], {
        cwd: bare,
        encoding: "utf8",
      });
      expect(output).toContain("不在 git 检出里");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  test("⑧ 混合：只报该报的那一份", ({ repo }) => {
    startConflict(repo);
    repo.write("src/a.ts", "a=main+feat\n"); // 正确
    repo.write("src/b.ts", "b=feat\n"); // 整份取一侧
    repo.git("add", "-A");

    const { code, output } = repo.run(["--status"]);
    expect(code).toBe(0);
    expect(output).toContain("1 份疑似");
  });
});

describe("check-pending-merge-loss —— 钩子接线", () => {
  test(".githooks/prepare-commit-msg 接上了这条判据并透传 $2", () => {
    const hook = readFileSync(
      join(process.cwd(), ".githooks", "prepare-commit-msg"),
      "utf8",
    );
    /* 判据写得对、钩子没接上 = 没有执行者（§13.5.12 的立案现场）。
     * 少传 $2 会让 amend 那条误报防线失效，且是静默的。 */
    expect(hook).toContain("scripts/check-pending-merge-loss.mjs");
    expect(hook).toContain('"$2"');
    /* 与形态档（#1594）一前一后都在同一个入口里。 */
    expect(hook).toContain("scripts/check-merge-parents.mjs");
  });

  test("与 1-1 共用内核（不许抄成第二份检测实现）", () => {
    const gate = readFileSync(
      join(process.cwd(), "scripts", "check-pending-merge-loss.mjs"),
      "utf8",
    );
    expect(gate).toContain("./merged-side-loss-core.mjs");
    /* 检测核心只在核心里有；执行者里不许再出现「自己 walk 历史比 blob」的第二份。 */
    expect(gate).toContain("findEarlierVersion");
  });
});
