/**
 * 「合并取错一侧 / 整份退回」事后复算判据执行者自测（§11.23.5 / ISSUE #1617）。价值全在口径：宽一点把正当并线差异
 * 报成退回（实测 `0c38dce0` vs `af589681`）、窄一点什么都拦不住；跑真脚本 + 真 git 仓库，内存里假装历史就是把唯一输入重实现。
 * 覆盖验收：取一侧拦、正常前移零命中；分叉线/非 git/缺基线退出码 2（没跑起来，非「红了」）；`--report` 恒 0、生成物排除、一次遍历不漏报。
 */
import { execFileSync } from "node:child_process";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

/** 读一条 git 命令的输出（夹具的 `git()` 只跑不返回 —— 这里要 sha）。 */
function out(dir: string, ...args: Array<string>): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

const { test, expect } = defineGateRepo({
  script: "check-merged-side-loss.mjs",
  workdir: "merged-side-loss",
  /* 判据用 `import "./merged-side-loss-core.mjs"` 拉共用内核（与 1-2 的提交前档
   * 同一份实现）—— 同级动态导入只能靠夹具的 `copy` 带进来。
   * `merged-side-loss-git.mjs` 是这一族的 git 取证层（批量读法），同级 import，
   * 同样必须列进来。 */
  copy: [
    {
      from: "scripts/merged-side-loss-core.mjs",
      to: "scripts/merged-side-loss-core.mjs",
    },
    {
      from: "scripts/merged-side-loss-git.mjs",
      to: "scripts/merged-side-loss-git.mjs",
    },
  ],
  setup: (repo: GateRepo) => {
    repo.git("init", "-q", "-b", "main", ".");
  },
});

/** 造一次「主干改过 f、然后分支整份取回旧版」的提交，返回它的 sha。 */
function revertSideTake(repo: GateRepo): { bad: string; good: string } {
  repo.write("src/a.ts", "export const a = 1;\n");
  repo.write("src/b.ts", "export const b = 1;\n");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "chore: 初始化");

  // 主干侧前移：a.ts 与 b.ts 都改了。
  repo.write("src/a.ts", "export const a = 2;\n");
  repo.write("src/b.ts", "export const b = 2;\n");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "feat: 主干前移");
  const baseline = out(repo.dir, "rev-parse", "HEAD");

  // 一次「取错一侧」的提交：b.ts 整份取回旧版（a.ts 正常前移）。
  repo.write("src/a.ts", "export const a = 3;\n");
  repo.write("src/b.ts", "export const b = 1;\n");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "merge: 解冲突时 b.ts 整份取了分支侧");
  return { good: baseline, bad: out(repo.dir, "rev-parse", "HEAD") };
}

describe("check-merged-side-loss —— 整份退回的事后复算", () => {
  test("① 整份取一侧 → 拦（立案现场形态）", ({ repo }) => {
    const { good, bad } = revertSideTake(repo);
    const { code, output } = repo.run([bad, "--baseline", good]);
    expect(code).toBe(1);
    expect(output).toContain("src/b.ts");
    // a.ts 正常前移（结果版是新写的 3），不该被算成退回。
    expect(output).not.toContain("src/a.ts");
  });

  test("② 正常前移的提交 → 零命中", ({ repo }) => {
    repo.write("src/a.ts", "export const a = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: 初始化");
    const good = out(repo.dir, "rev-parse", "HEAD");
    repo.write("src/a.ts", "export const a = 2;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "feat: 正常前移");
    const head = out(repo.dir, "rev-parse", "HEAD");

    const { code } = repo.run([head, "--baseline", good]);
    expect(code).toBe(0);
  });

  test("③ 分叉线上比较 → 2（没跑起来，不是红了）", ({ repo }) => {
    repo.write("src/a.ts", "export const a = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: 初始化");

    // 从同一点分出两条线。
    repo.git("checkout", "-q", "-b", "side");
    repo.write("src/a.ts", "export const a = 2;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "feat: 侧线");
    const side = out(repo.dir, "rev-parse", "HEAD");

    repo.git("checkout", "-q", "main");
    repo.write("src/a.ts", "export const a = 3;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "feat: 主线");
    const main = out(repo.dir, "rev-parse", "HEAD");

    // side 不是 main 的祖先 → 判据必须拒绝比较，而不是报一片差异。
    const { code, output } = repo.run([main, "--baseline", side]);
    expect(code).toBe(2);
    expect(output).toContain("祖先");
  });

  test("④ 缺 --baseline → 2 并给出取法", ({ repo }) => {
    repo.write("src/a.ts", "x\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: 初始化");
    const { code, output } = repo.run(["HEAD"]);
    expect(code).toBe(2);
    expect(output).toContain("--baseline");
  });

  test("⑤ 生成物排除：docs/api 退回成旧版不报", ({ repo }) => {
    repo.write("docs/api/modules/lib_x.html", "<html>v1</html>\n");
    repo.write("src/a.ts", "export const a = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: 初始化");
    const good = out(repo.dir, "rev-parse", "HEAD");

    repo.write("docs/api/modules/lib_x.html", "<html>v2</html>\n");
    repo.write("src/a.ts", "export const a = 2;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "docs: 重生文档");

    // 结果把产物整份取回 v1（常态），但源文件正常前移 → 不该报。
    repo.write("docs/api/modules/lib_x.html", "<html>v1</html>\n");
    repo.write("src/a.ts", "export const a = 3;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "merge: 解冲突");
    const bad = out(repo.dir, "rev-parse", "HEAD");

    const { code } = repo.run([bad, "--baseline", good]);
    expect(code).toBe(0);
  });

  test("⑥ 非 git 目录 → 2", ({ repo }) => {
    // 夹具已在 setup 里 git init；删掉 .git 造「不是 git 检出」。
    repo.remove(".git");
    const { code, output } = repo.run(["HEAD", "--baseline", "HEAD"]);
    expect(code).toBe(2);
    expect(output).toContain("没跑起来");
  });

  test("⑦ 基线取不到 → 2", ({ repo }) => {
    repo.write("src/a.ts", "x\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: 初始化");
    const { code, output } = repo.run(["HEAD", "--baseline", "deadbeef"]);
    expect(code).toBe(2);
    expect(output).toContain("基线提交取不到");
  });

  test("⑧ --report 恒 0（盘点档，不判失败）", ({ repo }) => {
    const { good, bad } = revertSideTake(repo);
    const { code, output } = repo.run([bad, "--baseline", good, "--report"]);
    expect(code).toBe(0);
    expect(output).toContain("src/b.ts");
  });

  test("⑨ 退回成「只在被并进来的那条线上出现过」的版本 → 仍要认出来", ({ repo }) => {
    /* 形状：侧线把 f 改成 v2 → 主线改成 v3 → 用 `merge -s ours` 并进来（第一父本逐字相同）→ 之后某次提交把 f 写回 v2。
     * 这是真退回，但**逐文件** `git log -- f` 看不见 v2：单路径遍历在那个合并处按 TREESAME 剪枝，只跟第一父本，
     * 被并进来的那条线整条不访问。所以先自证「盲区确实在」（旧读数得到 v2 的提交不在清单里），
     * 再断言改成一次 `--name-only` 遍历后判据仍报出它。 */
    repo.write("src/f.ts", "export const f = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: v1");

    repo.git("checkout", "-q", "-b", "side");
    repo.write("src/f.ts", "export const f = 2;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "feat: 侧线把 f 改成 v2");
    const sideCommit = out(repo.dir, "rev-parse", "HEAD");

    repo.git("checkout", "-q", "main");
    repo.write("src/f.ts", "export const f = 3;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "feat: 主线把 f 改成 v3");
    repo.git("merge", "-q", "--no-ff", "-s", "ours", "side", "-m", "merge: 这一版整单取自己");
    const baseline = out(repo.dir, "rev-parse", "HEAD");

    /* 盲区自证：逐文件那条读法里，v2 那次提交根本不在候选清单上。 */
    const perFile = out(
      repo.dir,
      "log",
      "--format=%H",
      "--no-merges",
      baseline,
      "--",
      "src/f.ts",
    ).split("\n");
    expect(perFile).not.toContain(sideCommit);

    repo.write("src/f.ts", "export const f = 2;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "fix: f 写成 v2（取自被并进来那条线）");
    const bad = out(repo.dir, "rev-parse", "HEAD");

    const { code, output } = repo.run([bad, "--baseline", baseline]);
    expect(code).toBe(1);
    expect(output).toContain("src/f.ts");
  });

  test("⑩ 结果版与基线版只差空白/断行 ⇒ 不是退回，且减掉的要点名（ISSUE #2999）", ({ repo }) => {
    /* 现场形状（printWidth 迁移）：基线版是 80 列链式排版，结果版是 100 列单行 ——
     * 逐字节不同（`diff -w` 也不为空：断行结构变了），却与**链式化之前**的某一版
     * 逐字节相同。判据要抓的是「丢了别线的成果」，而相对基线非空白内容一个字没少。
     * 判别是「剥掉全部空白后逐字相等」—— 用例把两半都钉住：这一半（排版巧合）放行
     * 且念出减除读数，⑪ 那一半（真退回）照拦。 */
    repo.write("src/g.ts", "export const g = call(1);\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: 单行 v1（后来的结果版与它逐字节相同）");

    /* 基线：把 g 链式化（等价于被格式化重排过）—— 内容没变，只有排版。
     * ⚠️ 结尾**不许**多一个逗号：判别是「剥掉全部空白后逐字相等」，而逗号不是空白
     * —— `call(\n  1,\n)` 剥完是 `call(1,)`，与结果版的 `call(1)` 不等，这一格会被判成
     * 真退回（2026-11-05 GA 上这条用例就是这么红的）。夹具要钉的是「只差空白/断行」，
     * 所以这里只能改断行。 */
    repo.write("src/g.ts", "export const g = call(\n  1\n);\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "style: 链式排版");
    const good = out(repo.dir, "rev-parse", "HEAD");

    // 结果：改回单行 —— 逐字节等于 v1，但相对基线只是断行不同。
    repo.write("src/g.ts", "export const g = call(1);\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "style: 改回单行排版");
    const relaid = out(repo.dir, "rev-parse", "HEAD");

    const { code, output } = repo.run([relaid, "--baseline", good]);
    expect(code, `output=${output}`).toBe(0);
    expect(output).toContain("只差空白/断行");
    expect(output).toContain("src/g.ts");
  });

  test("⑪ 排版减除不吞真退回：相对基线少了内容的照样拦（ISSUE #2999 的另一半）", ({ repo }) => {
    repo.write("src/h.ts", "export const h = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: v0（将要被退回的那一版）");

    // 基线：内容真的变多（主干前移）。
    repo.write("src/h.ts", "export const h = 2;\nexport const extra = 3;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "feat: 主干前移");
    const good = out(repo.dir, "rev-parse", "HEAD");

    // 退回成 v0（逐字节）—— 剥掉空白后与基线版**不等**（少了 `= 2` 与 extra），
    // 排版减除不许把它吞掉。
    repo.write("src/h.ts", "export const h = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "fix: 整份退回成 v0");
    const bad = out(repo.dir, "rev-parse", "HEAD");

    const { code, output } = repo.run([bad, "--baseline", good]);
    expect(code, `output=${output}`).toBe(1);
    expect(output).toContain("src/h.ts");
    expect(output).not.toContain("只差空白/断行");
  });

  test("⑫ 台账清零（entries: []）⇒ 不是退回，且减掉的要点名（ISSUE #2994）", ({ repo }) => {
    /* 现场形状：台账由它自己的判据管方向（`--update` 只许降），「清零」是棘轮
     * 要求的正当收紧 —— 而空台账逐字节等于建表那一刻的版本，在这一格上**必然**
     * 命中（那份文件的历史上只出现过空与有条目两种内容）。判别：结果版是
     * 「entries 为空数组」的 JSON ⇒ 减掉并点名。 */
    repo.write("ledger.json", '{"ruleVersion":1,"entries":[]}\n');
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: 建台账（空）");
    // 进一条账，再以这笔为基线 —— 棘轮意义上的「有账」状态。
    repo.write("ledger.json", '{"ruleVersion":1,"entries":[{"id":"a"}]}\n');
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "feat: 进一条账");
    const good = out(repo.dir, "rev-parse", "HEAD");

    // 清零：逐字节回到建表那一刻的空台账。
    repo.write("ledger.json", '{"ruleVersion":1,"entries":[]}\n');
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "fix: 台账清零（棘轮只许降，正当收紧）");
    const bad = out(repo.dir, "rev-parse", "HEAD");

    const { code, output } = repo.run([bad, "--baseline", good]);
    expect(code, `output=${output}`).toBe(0);
    expect(output).toContain("台账类文件的**空态**");
    expect(output).toContain("ledger.json");
  });

  test("⑬ 台账减除不吞非台账的真退回：普通文件退回旧版照样拦（ISSUE #2994 的边界）", ({ repo }) => {
    /* 同一批改动里混着一份普通源码文件被整份退回 —— 台账那格减掉、源码那份照拦：
     * 空态判别只认「entries 为空数组的 JSON」，不外溢到别的形状。 */
    repo.write("ledger.json", '{"ruleVersion":1,"entries":[]}\n');
    repo.write("src/k.ts", "export const k = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: 建台账 + 源码 v1");

    repo.write("ledger.json", '{"ruleVersion":1,"entries":[{"id":"a"}]}\n');
    repo.write("src/k.ts", "export const k = 2;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "feat: 进账 + 源码前移");
    const good = out(repo.dir, "rev-parse", "HEAD");

    repo.write("ledger.json", '{"ruleVersion":1,"entries":[]}\n');
    repo.write("src/k.ts", "export const k = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "fix: 台账清零，但源码被整份退回");
    const bad = out(repo.dir, "rev-parse", "HEAD");

    const { code, output } = repo.run([bad, "--baseline", good]);
    expect(code, `output=${output}`).toBe(1);
    expect(output).toContain("src/k.ts");
    expect(output).toContain("台账类文件的**空态**");
    expect(output).toContain("ledger.json");
  });
});
