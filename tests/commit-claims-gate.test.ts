/**
 * 「提交信息里的机械可核声明 ⇄ 这次提交的树事实」的执行者自测（规范 §11.23.5）。
 *
 * 判据的价值全在**判定口径**上 —— 本条最容易被写成的样子是一条「天天响的闸」：
 * 提交信息是自然语言，宽一点就误报一片、窄一点就什么都拦不住。所以这里每一条
 * 口径各配一组真样本（都取自在真历史里实测过的形态），跑的是**真脚本 + 真 git 仓库**：
 * 内存里假装「某次提交的树」等于把本判据唯一的输入重新实现一遍。
 *
 * 覆盖：
 *   ① 该认的：`§x.y … 照旧保留` 而树里没有这一节 → 拦（立案现场 `ad81a912` 的形态）。
 *   ② 该认的（为真）：树里**有**这一节 → 放。
 *   ③ 引号里的复述不认（`1f629434` 那句引用别人的反话并当场反驳它）。
 *   ④ 裸「保留」不认（`保留共有段落` / `保留本分支的脚本` 是正常叙述）。
 *   ⑤ **保留的宾语不是那一节**时不认（`§3.6.1 的 p71-allow 例外块照原文保留`）。
 *   ⑥ 多个 §号共享一个「照旧保留」时逐个都认（立案现场那句是 `§13.5.13 / §13.6.3 两节…`）。
 *   ⑦ 取不到提交 / 非 git 目录 → 退出码 2（**没跑起来**，与「判据红了」分开）。
 *   ⑧ `--report` 恒 0（盘点档，不判失败）。
 */
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-commit-claims.mjs",
  workdir: "commit-claims",
  setup: (repo: GateRepo) => {
    repo.git("init", "-q", "-b", "main", ".");
  },
});


/** 放一份规范文档，`sections` 里的每个编号都写成一个标题行。 */
function docsWith(repo: GateRepo, sections: string[]) {
  repo.write(
    "docs/standards/13-提交与-code-review.md",
    sections.map((s) => `#### ${s} 某个小节的标题\n\n正文。\n`).join("\n"),
  );
  repo.git("add", ".");
}

describe("check-commit-claims —— 机械可核声明 ⇄ 树事实", () => {
  test("① 自称「照旧保留」而树里没有这一节 → 拦（立案现场形态）", ({ repo }) => {
    docsWith(repo, ["13.6.1"]);
    repo.commit(
      [
        "fix(gate): 解决四处冲突",
        "",
        "master 新增的 §13.5.13 / §13.6.3 两节与各处插记照旧保留。",
      ].join("\n"),
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("§13.5.13");
    expect(output).toContain("§13.6.3");
  });

  test("② 树里真有这一节 → 放", ({ repo }) => {
    docsWith(repo, ["13.6.3"]);
    repo.commit("fix: 保留那一节\n\nmaster 新增的 §13.6.3 两节与各处插记照旧保留。\n");
    const { code } = repo.run();
    expect(code).toBe(0);
  });

  test("③ 引号里的复述不算声明（1f629434 那句「实测那两节一次都不出现」）", ({ repo }) => {
    docsWith(repo, []);
    repo.commit(
      [
        "fix: 找回被回退的 master 内容",
        "",
        "它的提交信息还自称「master 新增的 §13.5.13 / §13.6.3 两节照旧保留」——",
        "实测那两节一次都不出现。",
      ].join("\n"),
    );
    const { code } = repo.run();
    expect(code).toBe(0);
  });

  test("④ 裸「保留」不认（正常叙述，不是在承诺某一节还在）", ({ repo }) => {
    docsWith(repo, []);
    repo.commit(
      [
        "refactor: 冲突仅因两侧都要在那段之后接内容",
        "",
        "处置 = 保留共有段落，其后接 PR 的 §11.9.1。",
        "- 保留本分支的 check-click-keyboard.cjs（§6.11 键等价物棘轮）",
      ].join("\n"),
    );
    const { code } = repo.run();
    expect(code).toBe(0);
  });

  test("⑤ 保留的宾语不是那一节 → 不认（「例外块照原文保留」）", ({ repo }) => {
    docsWith(repo, []);
    repo.commit(
      [
        "refactor(studio): 目录随迁",
        "",
        "（只剩内容区消费，§3.6.1 的 p71-allow 例外块照原文保留）",
      ].join("\n"),
    );
    const { code } = repo.run();
    expect(code).toBe(0);
  });

  test("⑥ 多个 §号共享一个「照旧保留」时逐个都核", ({ repo }) => {
    docsWith(repo, ["13.6.3"]);
    repo.commit(
      [
        "fix: 四处冲突",
        "",
        "master 新增的 §13.5.13 / §13.6.3 两节与各处插记照旧保留。",
      ].join("\n"),
    );
    /* §13.6.3 在场、§13.5.13 不在场 ⇒ 仍拦，且**只点名缺的那一个**。 */
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("§13.5.13");
    expect(output).not.toContain("自称 §13.6.3");
  });

  test("⑦ 取不到提交 → 退出码 2（没跑起来，不构成证据）", ({ repo }) => {
    docsWith(repo, []);
    repo.commit("chore: 随便一条\n");
    const { code, output } = repo.run(["deadbeefdeadbeef"]);
    expect(code).toBe(2);
    expect(output).toContain("取不到提交");
  });

  test("⑧ --report 恒 0（盘点档）", ({ repo }) => {
    docsWith(repo, []);
    repo.commit("fix: 反事实声明\n\nmaster 新增的 §13.5.13 两节照旧保留。\n");
    const { code, output } = repo.run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("§13.5.13");
  });
});
