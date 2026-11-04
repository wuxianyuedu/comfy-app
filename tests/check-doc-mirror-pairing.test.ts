/**
 * `check-doc-mirror-pairing.cjs`：改了 `SCOPED_DOCS` 的文档源必须同批带 `docs/generated/**` 镜像（规范 §13.5.5，pre-commit D0）。
 * 平台那格 `--check --autofix` 就地修，漏带从不出现；只有增量命中的 `check-doc-references` 照得出来——2026-10-21 三次红都落在
 * 下一个动文档面的人身上。夹具 `createGateRepo()`：被测输入即暂存区本身（拿真索引会污染并行检出），清单随 `copyGateDeps()` 带入。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { defineGateRepo, describe } from "./helpers/gate-repo";

/** 沙箱里用的两份真文档：一份在 `SCOPED_DOCS` 里（有镜像），一份不在（不该被判）。 */
const SOURCE = "docs/standards/15-附录.md";
const TWIN = "docs/generated/15-附录.md";
const UNSCOPED = "docs/audits/某次过程文件.md";

const { test, expect } = defineGateRepo({
  script: "check-doc-mirror-pairing.cjs",
  files: {
    [SOURCE]: "# 附录\n\n正文。\n",
    [TWIN]: "<!-- 生成态镜像 -->\n\n# 附录\n\n正文。\n",
    [UNSCOPED]: "# 过程文件\n",
  },
  /* 一个「文件都已提交、索引干净」的起点：这样每条用例里 `git add` 了什么，
   * 就等于本次提交带了什么 —— 被测输入到此为止，脚本读的正是这份暂存面。
   * （`commit()` 刻意不替调用点 `git add`，所以这里要自己把基线全量加上。） */
  setup: (repo) => {
    repo.git("init", "-q");
    repo.git("add", "--", ".");
    repo.commit("基线");
  },
});

describe("check-doc-mirror-pairing.cjs（D0 形态档）", () => {
  test("改了源、没带上镜像 → 拦，并点名是哪一对、出路是哪条命令", ({ repo }) => {
    repo.write(SOURCE, "# 附录\n\n改了正文。\n");
    repo.git("add", "--", SOURCE);
    const r = repo.run(["--staged"]);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain(SOURCE);
    expect(r.output).toContain(TWIN);
    /* 出路必须是执行者写得下的那一条命令，不是「检查一下」这类无从落地的话。 */
    expect(r.output).toContain("doc:render -- --only");
    expect(r.output).toContain("不要手改生成物");
  });

  test("源与镜像同批 → 放行（这正是修法本身）", ({ repo }) => {
    repo.write(SOURCE, "# 附录\n\n改了正文。\n");
    repo.write(TWIN, "<!-- 生成态镜像 -->\n\n# 附录\n\n改了正文。\n");
    repo.git("add", "--", SOURCE, TWIN);
    const r = repo.run(["--staged"]);
    expect(r.output, r.output).not.toContain("✗");
    expect(r.code).toBe(0);
  });

  test("只改镜像、没改源 → 不判（重渲染产物可以因任何原因单独提交）", ({ repo }) => {
    repo.write(TWIN, "<!-- 生成态镜像 -->\n\n改了产物。\n");
    repo.git("add", "--", TWIN);
    const r = repo.run(["--staged"]);
    expect(r.code, r.output).toBe(0);
  });

  test("不在 SCOPED_DOCS 里的 .md 改了 → 不判（误报一片的判据活不过一次评审）", ({ repo }) => {
    repo.write(UNSCOPED, "# 过程文件\n\n又改了一段。\n");
    repo.git("add", "--", UNSCOPED);
    const r = repo.run(["--staged"]);
    expect(r.code, r.output).toBe(0);
    expect(r.output).not.toContain(UNSCOPED);
  });

  test("删掉源而镜像没同批处理（改名 / 从 SCOPED_DOCS 摘登记那一形）同样拦", ({ repo }) => {
    repo.git("rm", "-q", SOURCE);
    const r = repo.run(["--staged"]);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain(SOURCE);
    expect(r.output).toContain(TWIN);
  });

  test("暂存区为空 ⇒ 这一条**没判**（退 2），不算「已通过」", ({ repo }) => {
    const r = repo.run(["--staged"]);
    /* 这是这条判据的**否定式**要求：空暂存被打印成「OK」时，下一个人在钩子输出里
     * 就分不出「判过了、没问题」与「压根没有输入可判」。
     * ⇒ 退 2（仓库三态：0 绿 / 1 红 / 2 没跑起来），不是退 0 ——
     * 「没有判决面」被计成「绿」，那正是 ISSUE #2265 要治的那一格。 */
    expect(r.code).toBe(2);
    expect(r.output).toContain("没有判决面");
    expect(r.output).not.toContain("OK：");
  });

  /* ── `--base` 形态：换判决面的来源，**判决链一字未改**（ISSUE #2265）───────── */
  test("--base 形态：相对基线改了源、没带镜像 ⇒ 同样拦", ({ repo }) => {
    repo.write(SOURCE, "# 附录\n\n改了正文。\n");
    repo.git("add", "--", SOURCE);
    repo.commit("改了源，没带镜像");
    const r = repo.run(["--base", "HEAD~1"]);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain(SOURCE);
    expect(r.output).toContain(TWIN);
  });

  test("--base 形态：判决**不因机器的 git 配置而变**（强制 core.quotePath=true）", ({ repo }) => {
    /* 这一条是 ISSUE #2272 的现场：机器之间本来就有差别 —— runner 的 git 是**全默认**
     * （`core.quotePath=true`，路径被转义加引号），本机全局配了 `false` ⇒ 同一份代码
     * 在平台上是「OK：本次没有……」（绿），在本机是红的。
     * ⇒ 这里强制成 runner 的形态跑一遍，判决必须**一样**。 */
    repo.write(SOURCE, "# 附录\n\n改了正文。\n");
    repo.git("add", "--", SOURCE);
    repo.commit("改了源，没带镜像");
    const r = repo.run(["--base", "HEAD~1"], {
      env: {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.quotepath",
        GIT_CONFIG_VALUE_0: "true",
      },
    });
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain(SOURCE);
    expect(r.output).toContain(TWIN);
  });

  test("--base 形态：源与镜像同批 ⇒ 放行", ({ repo }) => {
    repo.write(SOURCE, "# 附录\n\n改了正文。\n");
    repo.write(TWIN, "<!-- 生成态镜像 -->\n\n# 附录\n\n改了正文。\n");
    repo.git("add", "--", SOURCE, TWIN);
    repo.commit("源与镜像同批");
    const r = repo.run(["--base", "HEAD~1"]);
    expect(r.code, r.output).toBe(0);
    /* 读数里要看得见判决面从哪儿来 —— 换了判决面的判据必须说出来。 */
    expect(r.output).toContain("判决面：基线");
  });

  test("--base 形态：基线取不到 ⇒ 这一条**没判**（退 2），不是判红", ({ repo }) => {
    const r = repo.run(["--base", "no-such-ref-xyz"]);
    expect(r.code).toBe(2);
    expect(r.output).toContain("没判");
    expect(r.output).not.toContain("✗");
  });

  test("--base 形态：相对基线什么都没改 ⇒ 那是「测得没有改动」，绿并说清楚", ({ repo }) => {
    const r = repo.run(["--base", "HEAD"]);
    /* 基线取到了、diff 跑成功了、结果是空 ⇒ 「这次什么都没改」⇒ 没有可判的内容。
     * 把它读成「不知道」会让 master 上的本地复算永远退 2 —— 那正是
     * 「降档不许被读成全套过了」的忌讳。 */
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("判决面：基线");
  });
});

describe("接线", () => {
  test("这一步在 pre-commit 的 D0 里（判据写了却没有执行者 = 假保险）", () => {
    const hook = readFileSync(
      path.join(import.meta.dirname, "..", ".githooks", "pre-commit"),
      "utf8",
    );
    expect(hook).toContain(
      'run "文档源 ⇄ 生成态镜像同批" node scripts/check-doc-mirror-pairing.cjs --staged',
    );
  });

  test("映射只有一处：渲染器与这条判据都取 `doc-facts` 的 `generatedPathFor`", () => {
    const read = (rel: string) => readFileSync(path.join(import.meta.dirname, "..", rel), "utf8");
    const facts = read("scripts/doc-facts.cjs");
    const renderer = read("scripts/render-doc-placeholders.cjs");
    const pairing = read("scripts/check-doc-mirror-pairing.cjs");
    expect(facts).toContain("function generatedPathFor(");
    /* 渲染器**不再自己写一遍**这条映射 —— 两份 `path.join(产物目录, basename)`
     * 早晚会在「两份源映射到同一个产物名」那类形状上分叉，而那正是这条判据的对象。
     * 取用形态是 `docFacts.generatedPathFor`（夹具注入那批改动后，渲染器顶部统一
     * 从 doc-facts 取值，见 ISSUE #2415）。 */
    expect(renderer).not.toContain("function generatedPathFor(");
    expect(renderer).toContain("docFacts.generatedPathFor");
    expect(pairing).toContain("generatedPathFor");
  });

  /* ── 刻意空提交（ISSUE #2354：`pnpm ship --rerun-ci` 推空提交重新派生流水线）────── */
  test("空索引 + 说出来的意图 ⇒ 正面按 0 收，且念出为什么没有对象", ({ repo }) => {
    const r = repo.run(["--staged"], {
      env: { COMFY_INTENTIONAL_EMPTY_COMMIT: "1" },
    });
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("刻意的空提交");
    expect(r.output).toContain("没有可判的配对");
  });

  test("旗标在场而索引非空 ⇒ 旗标当场作废并念出来，照正常档判（不是跳过门禁的开关）", ({
    repo,
  }) => {
    repo.write(SOURCE, "# 附录\n\n改了正文。\n");
    repo.git("add", "--", SOURCE);
    const r = repo.run(["--staged"], {
      env: { COMFY_INTENTIONAL_EMPTY_COMMIT: "1" },
    });
    /* 这一条改的是源而没带镜像 ⇒ 该拦；旗标不许把它放过去。 */
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("旗标作废");
    expect(r.output).toContain("doc:render -- --only");
  });
});
