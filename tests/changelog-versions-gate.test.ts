/**
 * 「待发段落的来源锚 ⇄ 条目归属」双向判据的门禁自测（规范 §13.10.6）。
 *
 * 判据 `scripts/check-changelog-versions.cjs` 的价值全在**三件事都真的被核到**上：
 *   ① 锚的**形状**（写歪了 ⇒ 红。这一格是本轮实测撞出来的：严格识别锚的那条正则
 *      认不出歪锚 ⇒ 回 `null` ⇒ 走到「这一段没有锚」那一支 ⇒ **整份判据静默放过**，
 *      而「写了但写歪」比「没写」更坏 —— 它看上去像一条来源记录）；
 *   ② 锚解析不解析得开（日期 / 分支名 / 不存在的短哈希都不行）；
 *   ③ **跨锚分裂**：同一个 ISSUE 号既在待发段落里、又在它**之前**（文件里排在它下面）
 *      的已发布段落里 ⇒ 报出来。那是最贵的失效形态（归属被切成两半，两端都没写错）。
 *
 * 三件事各自有一组「该拦的」，外加「不该误伤的」与「判据自己不许静默降级」。
 *
 * ⚠️ **待发段落 = `[Unreleased]` / `[未发布]`**，带日期的 `## [x.y.z] - <日期>` **不算**：
 * 把它算进去，第 ③ 条那句「锚之前的已发布段落」就永远是空集（实测过：`earlier` 恒为 0），
 * 判据会一直绿而什么都没核。所以另有一组用例专门钉这条口径 —— 它是**判据自己的**
 * 静默失效面，只有用例看得见。
 */
import { execFileSync } from "node:child_process";

import { defineGateRepo, describe } from "./helpers/gate-repo";

/* 判据靠 `__dirname/..` 定位仓库根，脚本必须落在 `scripts/` 下；
 * `CHANGELOG.md` 是它的唯一输入，每个工作区自己造一份。
 * ⚠️ 锚必须解析成**本仓库历史里真实存在的提交** —— 用例拿 `git rev-parse HEAD`
 * 现算（不写死哈希：写死一个短哈希会在某个历史被 gc 掉之后变成假红）。 */
const { test, expect } = defineGateRepo({
  script: "check-changelog-versions.cjs",
  dir: "scripts",
  workdir: "changelog-versions",
  setup: (repo) => {
    repo.git("init", "-q", ".");
    repo.write("seed.txt", "seed\n");
    repo.git("add", "-A");
    repo.commit("seed");
  },
});

/**
 * 工作区 HEAD 的短哈希 —— 锚必须解析成一个**真实存在的**提交，所以现算。
 *
 * 夹具的 `repo.git()` 只转 `stdio: "ignore"`（它服务的是「造状态」而不是「读数」），
 * 所以这里自己起一次 git 把 stdout 拿回来：写死一个短哈希会在某个历史被 gc 之后
 * 变成假红，而那条红指向的是「锚解析不出提交」—— 读起来像判据坏了。
 */
function headSha(repo: { dir: string }): string {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repo.dir,
    encoding: "utf8",
  }).trim();
}

/**
 * 造一份 CHANGELOG：`unreleased` 与 `released` 两段各自给条目。
 * @param opts.pendingAnchor 待发段落下面那一行锚（`""` = 不写锚）
 * @param opts.releasedBody 已发布段落的正文
 */
function changelog(
  opts: {
    pendingAnchor?: string;
    pendingBody?: string;
    releasedBody?: string;
    releasedTitle?: string;
  } = {},
): string {
  const {
    pendingAnchor = "",
    pendingBody = "- 新的一条（ISSUE #1693）。\n",
    releasedBody = "首个版本基线。\n",
    releasedTitle = "## [0.1.0] - 2026-08-31",
  } = opts;
  return [
    "# 更新日志",
    "",
    "## [Unreleased]",
    ...(pendingAnchor ? [pendingAnchor] : []),
    "",
    "### Added",
    "",
    pendingBody.trimEnd(),
    "",
    releasedTitle,
    "",
    releasedBody.trimEnd(),
    "",
  ].join("\n");
}

describe("changelog-versions —— 锚的形状", () => {
  test("合规的锚 + 归属不分裂 ⇒ 通过", ({ repo }) => {
    const sha = headSha(repo);
    repo.write(
      "CHANGELOG.md",
      changelog({ pendingAnchor: `<!-- since: ${sha} — 第一批 -->` }),
    );
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("来源锚与条目归属一致");
  });

  test("写了锚但形状写歪（提交换成日期）⇒ 红 —— 这一格曾经整份静默放过", ({
    repo,
  }) => {
    repo.write(
      "CHANGELOG.md",
      changelog({ pendingAnchor: "<!-- since: 2026-09-12 — 第一批 -->" }),
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("锚形状不对");
  });

  test("没写锚 ⇒ **不拦**（锚不是每段的必修项，第一次并入时由脚本补）", ({
    repo,
  }) => {
    repo.write("CHANGELOG.md", changelog());
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("来源锚与条目归属一致");
  });

  test("锚写了但那个提交不存在（短哈希凑的）⇒ 红", ({ repo }) => {
    repo.write(
      "CHANGELOG.md",
      changelog({ pendingAnchor: "<!-- since: deadbee — 第一批 -->" }),
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("解析不出提交");
  });
});

describe("changelog-versions —— 跨锚分裂（本条判据的主判据）", () => {
  test("同一个 ISSUE 号同时出现在待发与已发布段落 ⇒ 红", ({ repo }) => {
    const sha = headSha(repo);
    repo.write(
      "CHANGELOG.md",
      changelog({
        pendingAnchor: `<!-- since: ${sha} — 第一批 -->`,
        pendingBody: "- 某某能力（ISSUE #355）。\n",
        releasedBody: "首个版本基线（含 ISSUE #355 的初版）。\n",
      }),
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("#355");
    expect(output).toContain("切成了两半");
  });

  test("待发段落里的号在**已发布段落**里没有出现 ⇒ 通过（负控制）", ({
    repo,
  }) => {
    const sha = headSha(repo);
    repo.write(
      "CHANGELOG.md",
      changelog({
        pendingAnchor: `<!-- since: ${sha} — 第一批 -->`,
        pendingBody: "- 某某能力（ISSUE #1693）。\n",
        releasedBody: "首个版本基线（含 ISSUE #355 的初版）。\n",
      }),
    );
    const { code } = repo.run();
    expect(code).toBe(0);
  });

  test("**带日期的版本段落不算待发段落** —— 算进去这条判据就恒空转", ({
    repo,
  }) => {
    /* 这是判据自己的静默失效面：把 `## [0.2.0] - 2026-10-01` 也算成待发段落，
     * 「锚之前的已发布段落」就永远是空集（实测 `earlier` 恒为 0），
     * 上面那条「同时出现 ⇒ 红」当场变成永远绿。 */
    repo.write(
      "CHANGELOG.md",
      [
        "# 更新日志",
        "",
        "## [Unreleased]",
        `<!-- since: ${headSha(repo)} — 第一批 -->`,
        "",
        "### Added",
        "",
        "- 不算待发的那种：定版已经切过了（ISSUE #42）。",
        "",
        "## [0.2.0] - 2026-10-01",
        "",
        "### Added",
        "",
        "- 定版段落里的条目（不含那个号）。",
        "",
        "## [0.1.0] - 2026-08-31",
        "",
        "首个版本基线（含 ISSUE #42 的初版）。",
        "",
      ].join("\n"),
    );
    /* `[0.2.0]` 是**已发布**段落 ⇒ 待发段落（`[Unreleased]`）里那个 #42 与
     * `[0.1.0]` 的 #42 命中分裂 —— 而 `[0.2.0]` 里的条目**不算**待发。 */
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("#42");
  });
});

describe("changelog-versions —— 判据自己不许静默降级", () => {
  test("CHANGELOG.md 读不到 ⇒ 红（不是「没有段落要查、于是放过」）", ({
    repo,
  }) => {
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("读不到 CHANGELOG.md");
  });

  test("一个待发段落都没有 ⇒ 红", ({ repo }) => {
    repo.write(
      "CHANGELOG.md",
      "# 更新日志\n\n## [0.1.0] - 2026-08-31\n\n基线。\n",
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("一个待发段落都没有");
  });

  test("只有版本段落、没有未发布标题 ⇒ 红，且报错点名 `[Unreleased]`", ({
    repo,
  }) => {
    repo.write(
      "CHANGELOG.md",
      "# 更新日志\n\n## [0.2.0] - 2026-10-01\n\n### Added\n\n- 一条。\n",
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("[Unreleased]");
  });

  test("`## [未发布]`（中文写法）也算待发段落", ({ repo }) => {
    const sha = headSha(repo);
    repo.write(
      "CHANGELOG.md",
      `# 更新日志\n\n## [未发布]\n<!-- since: ${sha} — 第一批 -->\n\n### Added\n\n- 一条。\n`,
    );
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("1 个段落");
  });

  test("--report 只出清单、不判失败", ({ repo }) => {
    repo.write(
      "CHANGELOG.md",
      "# 更新日志\n\n## [0.1.0] - 2026-08-31\n\n基线。\n",
    );
    const { code, output } = repo.run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("待发段落的来源锚");
  });
});
