/**
 * check-deps-freshness.mjs 的契约测试（规范 §13.5.6 同族：判据自己也要有判据）。
 *
 * 它判的是**「远端改过依赖而本地没同步」能不能被看见**这件事本身，所以用例必须在
 * 真 git 仓库上跑 —— 「远端」不是一个可 mock 的模块，它就是
 * `refs/remotes/origin/master` 这条引用加一条它自己的 reflog。夹具用共享的
 * `defineGateRepo`（§11.16.1），`setup` 里把它 `git init` 好、造一次提交、
 * 再把那条远端引用指过去。
 *
 * 覆盖的八条分界（都是「一眼看着该红、其实绿」或反过来的那种）：
 *   1. 远端改了 `package.json` 的版本声明 → 红，且话术里有可执行出口；
 *   2. 远端改了 lockfile 的**解析结果** → 红，且明细指到具体包与版本；
 *   3. 远端只动 lockfile 的注释 / 顺序 → **不报**（实质 diff，不是字符串比）；
 *   4. 没有远端引用 / 没有取证时间 → `[未校验]`，**不给出**「一致」这个结论；
 *   5. `--offline` 不读 git → 只判本地自洽那一层；
 *   6. 不是 git 检出 → exit 2（环境故障，不是「依赖没问题」）；
 *   7. `--staged` 的触发面：没碰依赖面 → 零输出退 0；碰了 → 照判并点出文件名；
 *   8. **合并已解完、提交还没落地**（`MERGE_HEAD` 在场）→ ② 不判（远端那份依赖面就在
 *      这次合并里），而不是给解冲突的人一条**永远解不开**的红。
 *   9. ③ 的**第二维**（ISSUE #1721）：两份 lockfile 逐字对得上、而某个被声明的包在这棵
 *      树上**解析不到**（只以传递依赖的旧版本落在包自己的私有层里）→ 红，且话术说的是
 *      「解析不到」而**不是**「安装记录与声明对不上」（后者会把人送去核对一份本来就对的
 *      文件）。反向对照两条：依赖压根没装（`no-install`）与依赖树完好时不误报。
 *
 * 外加一条**基准**用例：分叉之后自己在分支上加依赖，不算「远端改过依赖」——
 * 那正是 ② 取分叉点而不取 `origin/master` 的理由（拿后者会反向误报）。
 */
import { defineGateRepo, describe } from "./helpers/gate-repo";

/** 「远端」的依赖声明（= 工作区要同步到的目标）。 */
const PKG_REMOTE = `{"name":"x","dependencies":{"a":"1.0.0"}}\n`;
/** 本地还停在旧的那一套（模拟「远端升过版、本地没同步」）。 */
const PKG_STALE = `{"name":"x","dependencies":{"a":"0.9.0"}}\n`;
/** 与 `PKG_STALE` 配套的一小份 lockfile（解析结果里只有 `a@0.9.0`）。 */
const LOCK_STALE = [
  "lockfileVersion: '9.0'",
  "importers:",
  "  .:",
  "    dependencies:",
  "      a:",
  "        specifier: 0.9.0",
  "        version: 0.9.0",
  "packages:",
  "  a@0.9.0: {}",
  "",
].join("\n");

/** 与 `PKG_REMOTE` 配套的一小份 lockfile（解析结果里只有 `a@1.0.0`）。 */
const LOCK_REMOTE = [
  "lockfileVersion: '9.0'",
  "importers:",
  "  .:",
  "    dependencies:",
  "      a:",
  "        specifier: 1.0.0",
  "        version: 1.0.0",
  "packages:",
  "  a@1.0.0: {}",
  "",
].join("\n");

/** `--json` 输出的形状（判据自己定义的契约，用例按它断言）。 */
interface FreshnessReport {
  code: number;
  remoteChecked: boolean;
  remoteAgeMs: number | null;
  remoteDrifts: { file: string; kind: string }[];
  installDrift: { state: string; unresolved?: string[] } | null;
}

/**
 * 解析 `--json` 输出。
 *
 * 不写成 `JSON.parse(output) as FreshnessReport`：那是**类型断言**，它只是让编译器
 * 闭嘴、解析出来的东西仍然可以是任意形状（§05 对 `as` 的口径）。这里走运行时收窄 ——
 * 判据改坏了形状时用例会在这一行就红，而不是在后面某个 `undefined` 上。
 * （`remoteDrifts` 的元素形状不逐项核：用例要断言的是**它空不空**与**点到哪个文件**，
 * 逐项建 schema 只会多一份要跟着判据改的清单。） */
function parseReport(output: string): FreshnessReport {
  const raw: unknown = JSON.parse(output);
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`--json 输出不是一个对象：${output}`);
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.remoteDrifts)) {
    throw new Error(`--json 输出缺少 remoteDrifts 数组：${output}`);
  }
  return {
    code: typeof r.code === "number" ? r.code : -1,
    remoteChecked: r.remoteChecked === true,
    remoteAgeMs: typeof r.remoteAgeMs === "number" ? r.remoteAgeMs : null,
    remoteDrifts: r.remoteDrifts as FreshnessReport["remoteDrifts"],
    installDrift: (r.installDrift ?? null) as FreshnessReport["installDrift"],
  };
}

const { test, expect } = defineGateRepo({
  script: "check-deps-freshness.mjs",
  workdir: "deps-freshness-gate",
  // 判据 import 了 lockfile / launcher-core 的同级模块，得一并拷进工作区。
  copy: [
    { from: "scripts/lockfile", to: "scripts/lockfile" },
    {
      from: "scripts/launcher-core/worktree.mjs",
      to: "scripts/launcher-core/worktree.mjs",
    },
  ],
  setup: (repo) => {
    repo.git("init", "-q", "-b", "master", ".");
    repo.git("config", "user.email", "gate@example.com");
    repo.git("config", "user.name", "gate");
    /* 宿主可能全局开着 `commit.gpgsign` 而没有可用密钥 —— 夹具不许假定读者的
     * git 配置（台账 R12-01 / ISSUE #1817），就地关掉签名。 */
    repo.git("config", "commit.gpgsign", "false");
    repo.git("config", "tag.gpgsign", "false");
    // ① 分叉点提交：本地分支从**旧的依赖**这里分出来（= 用户当初 clone 到的样子）。
    repo.write("package.json", PKG_STALE);
    repo.write("pnpm-lock.yaml", LOCK_STALE);
    repo.write("pnpm-workspace.yaml", "minimumReleaseAge: 0\n");
    repo.git("add", "-A");
    repo.commit("分叉点：旧依赖");
    repo.git("tag", "fork-point");
    repo.git("update-ref", "refs/remotes/origin/master", "HEAD");

    // ② 「远端」往前走一步：改了依赖声明与解析结果。工作区**不动** → 本地还停在
    //    分叉点那套旧依赖上，正是要判的「远端改过依赖而本地没同步」。
    repo.write("package.json", PKG_REMOTE);
    repo.write("pnpm-lock.yaml", LOCK_REMOTE);
    repo.git("add", "-A");
    repo.commit("远端：升级依赖");
    // `--create-reflog`：判据的取证时间是**那条引用自己的** reflog mtime，
    // 少了它这一层就永远读成「未校验」，用例会测不到 ②。
    repo.git(
      "update-ref",
      "--create-reflog",
      "refs/remotes/origin/master",
      "HEAD",
    );
    // 本地 HEAD 留在分叉点（模拟「远端已经前进、本地还没拉」—— 这才是要判的现场：
    // 工作区那套依赖是**当前 HEAD** 声明的那套，而远端已经换过了）。
    repo.git("reset", "--hard", "fork-point");
  },
});

describe("check-deps-freshness 契约", () => {
  test("远端改了依赖声明 → 红，并给出可执行的出口", ({ repo }) => {
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("package.json");
    expect(output).toContain("远端");
    expect(output).toContain("pnpm install");
    expect(output).toContain("sync-after-pull");
  });

  test("远端改了解析结果 → 红，明细指到具体包与版本", ({ repo }) => {
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("pnpm-lock.yaml");
    // 明细来自 `renderLockDiff`（既有实现）—— 这里判的是**它真的被接上了**，
    // 而不是「有差异」这半句：没有明细的红会让人只看到「不一致」三个字。
    expect(output).toContain("a@1.0.0");
    expect(output).toContain("0.9.0 -> 1.0.0");
  });

  test("远端只动了 lockfile 的注释 → 不报（实质 diff，不是字符串比）", ({
    repo,
  }) => {
    // 现场重搭一次：分叉点与「远端」的 lockfile **只差一句注释**，解析结果一字未变。
    // 直接改远端那份的文本（分叉点已有的是 `LOCK_STALE`，先把它对齐成 `LOCK_REMOTE`
    // 再只加注释）—— 判的是 ② 用不用实质 diff，不是别的。
    repo.git("reset", "--hard", "fork-point");
    repo.write("pnpm-lock.yaml", LOCK_REMOTE);
    repo.git("add", "-A");
    repo.commit("分叉点：换成 LOCK_REMOTE");
    repo.git("tag", "-f", "fork-point");
    repo.write("pnpm-lock.yaml", `# 远端顺手加的注释\n${LOCK_REMOTE}\n`);
    repo.git("add", "-A");
    repo.commit("远端：只加注释");
    repo.git("update-ref", "refs/remotes/origin/master", "HEAD");
    repo.git("reset", "--hard", "fork-point");
    const { output } = repo.run(["--json"]);
    // 只判远端那一层：`code` 整体仍可能是 1（夹具里没装 node_modules，③ 必红），
    // 拿它当判据会把「② 修好了」与「③ 也装好了」混成同一件事。
    expect(parseReport(output).remoteDrifts).toEqual([]);
  });

  test("没有远端引用 → 打 [未校验]，且**不给出**「一致」这个结论", ({
    repo,
  }) => {
    repo.git("update-ref", "-d", "refs/remotes/origin/master");
    const { output } = repo.run();
    expect(output).toContain("[未校验]");
    // 判的是**结论**，不是字面量：没有远端时不许出现「依赖与远端一致」这句判决
    // （「未看」与「看了且没有」必须在输出形态上分得开）。
    expect(output).not.toContain("依赖与远端一致");
    // 远端不看，但本地自洽那一层照判。
    expect(output).toContain("本地依赖与当前检出的声明不一致");
  });

  test("远端引用在但没有取证时间 → [未校验]，且比对仍照跑", ({ repo }) => {
    repo.remove(".git/logs/refs/remotes/origin/master");
    const { output } = repo.run();
    expect(output).toContain("[未校验]");
    // ref 本身还在 → 「远端改过依赖」这一层仍可判，只是可信度降级。
    expect(output).toContain("package.json");
  });

  test("--offline 不读 git，只判本地自洽那一层", ({ repo }) => {
    repo.write("package.json", PKG_REMOTE);
    const { code, output } = repo.run(["--offline"]);
    // 工作区没装 node_modules → 本地那一层必红，但话术里不出现远端比对。
    expect(code).toBe(1);
    expect(output).toContain("[未校验] --offline");
    expect(output).not.toContain("origin/master");
  });

  test("不是 git 检出 → exit 2（环境故障，不是「依赖没问题」）", ({ repo }) => {
    repo.remove(".git");
    const { code } = repo.run();
    expect(code).toBe(2);
  });

  /* ── ③ 的第二维：声明了、却解析不到（ISSUE #1721）──────────────────────────
   *
   * 立案现场：本地依赖树停在「装 axe-core 之前」—— 它只以传递依赖的旧版本被
   * `@storybook/addon-a11y` 拖进来、落在**包自己的私有层**，顶层既没有提升出来的
   * 那一份、也没有任何可解析路径。而 ③ 原来的口径是**两份 lockfile 的文本 diff**，
   * 那一格在这种情况下是绿的：`node_modules/.pnpm/lock.yaml` 与仓库那份逐字相同。
   *
   * 夹具因此按真实布局摆三层：顶层 `node_modules/`（声明依赖解析的就是它）、
   * `node_modules/.pnpm/lock.yaml`（③ 文本层的输入）、`node_modules/.modules.yaml`
   * （「装过」的证据，也是解析层决定要不要表态的开关）。探针包固定是
   * `typescript` / `next` / `axe-core` 三条，所以要造的正是这三者里**少一个**。
   */

  /**
   * 让工作区看起来「装过」，且**两份 lockfile 逐字一致**（③ 的文本层判 fresh）。
   *
   * 一致性这一步是这一组用例的前提，不是顺手：③ 的文本层也写 `state`，两侧同时漂移
   * 时拿到的是 `drift` 而不是 `unresolved` —— 那样测的就是「文本层还在不在」，
   * 而不是本组要问的「解析层单独能不能报红」。
   */
  const markInstalled = (repo: {
    write: (rel: string, content: string) => void;
  }) => {
    repo.write("node_modules/.modules.yaml", "nodeLinker: hoisted\n");
    repo.write("node_modules/.pnpm/lock.yaml", LOCK_STALE);
    repo.write("pnpm-lock.yaml", LOCK_STALE);
  };

  test("声明了却解析不到（lockfile 逐字对得上）→ 红，且说的是「解析不到」不是「对不上」", ({
    repo,
  }) => {
    // 声明与两侧 lockfile 都对齐（`PKG_STALE` / `LOCK_STALE` 是一套）⇒ 文本层不可能
    // 有实质差异，于是 `installDrift.state` 只可能来自解析层，判据不会与文本层混淆。
    repo.write("package.json", PKG_STALE);
    markInstalled(repo);
    // 只把 `typescript` 与 `next` 放到位：`axe-core` 缺失 = 解析不到。
    // `installDep` 而不是 `mkdir`：见夹具里那条注释（临时目录的祖先里可能有别人的
    // `node_modules`，Node 会一路向上找，`mkdir` 顶替会让这条用例测到环境噪声）。
    repo.installDep("typescript");
    repo.installDep("next");
    const { code, output } = repo.run(["--offline"]);
    expect(code).toBe(1);
    const report = parseReport(repo.run(["--offline", "--json"]).output);
    expect(report.installDrift?.state).toBe("unresolved");
    expect(report.installDrift?.unresolved).toEqual(["axe-core"]);
    // 话术要点：这一档**不能**说「装的不是你声明的那套」—— 它俩恰好对得上，
    // 那句话会把读的人送去核对一份本来就对的文件。
    expect(output).toContain("解析不到");
    expect(output).toContain("axe-core");
    expect(output).toContain("pnpm install");
    expect(output).not.toContain("装不是你当前检出声明的那套依赖");
  });

  test("依赖压根没装（无 .modules.yaml）→ 仍走 no-install，解析层不抢答", ({
    repo,
  }) => {
    // 对着一棵不存在的树报「这三个包都解析不到」是**准确的噪声**：动作一样是重装，
    // 但结论读起来完全不同（「没装」vs「装错了」）。这一档归 `no-install`。
    // 两侧 lockfile 对齐、只去掉 `.pnpm/lock.yaml`（=「安装记录不在」）：
    // 文档里那个「读过磁盘也确实漂移过、后来才装对」的现场就是这样被定性成没装的。
    repo.write("pnpm-lock.yaml", LOCK_STALE);
    const report = parseReport(repo.run(["--offline", "--json"]).output);
    expect(report.installDrift?.state).toBe("no-install");
  });

  test("探针清单与 reference-facts 的登记行逐项同源（只有一份权威定义）", async () => {
    // 两处各记一份必然分叉，而分叉之后「哪一份是真的」没有判据能回答。所以这里
    // 判的是**同源**：`docs/reference-facts.md` 的 `deps.resolveProbes` 那一行是
    // 权威定义（`scripts/doc-facts.cjs` 反向解析它），判据里的字面量必须与它逐项相等。
    // 这条用例同时挡住了「解析器失灵 ⇒ 读出空清单 ⇒ 一切照旧绿」那一档
    // （§12.16 的同款教训：一个永远返回空数组的解析器会让所有断言全绿）。
    const facts = (await import("../scripts/doc-facts.cjs")) as unknown as {
      FACTS: { key: string; extract: () => unknown }[];
    };
    const probesFact = facts.FACTS.find((f) => f.key === "deps.resolveProbes");
    expect(probesFact, "FACTS 里缺 deps.resolveProbes 登记项").toBeDefined();
    const declared = probesFact?.extract();
    expect(Array.isArray(declared)).toBe(true);
    const worktree = (await import(
      "../scripts/launcher-core/worktree.mjs"
    )) as unknown as { RESOLVE_PROBES: string[] };
    expect(worktree.RESOLVE_PROBES).toEqual(declared);
    // 清单非空也是判据的一部分：空的探针清单会让解析层**永远判绿**，
    // 而那正是它要拦的那件事。
    expect(worktree.RESOLVE_PROBES.length).toBeGreaterThan(0);
  });

  test("依赖树完好（三个探针都在）→ 解析层不误报", ({ repo }) => {
    // 反向对照：把三条探针都放到位 ⇒ 解析层静默。少了这条，「探针永远返回缺失」
    // 这种失灵（§12.16 的同款教训：一个永远报红的判据会被学会绕开）测不出来。
    repo.write("package.json", PKG_STALE);
    markInstalled(repo);
    for (const name of ["typescript", "next", "axe-core"]) {
      repo.installDep(name);
    }
    const report = parseReport(repo.run(["--offline", "--json"]).output);
    expect(report.installDrift).toBeNull();
  });

  test("--staged 未命中依赖面 → 零输出退 0（不给无关提交加时间）", ({
    repo,
  }) => {
    repo.write("src/a.ts", "export const a = 1;\n");
    repo.git("add", "src/a.ts");
    const { code, output } = repo.run(["--staged"]);
    expect(code).toBe(0);
    expect(output).toBe("");
  });

  test("--staged 命中依赖面 → 照判，并点出是哪个文件触发的", ({ repo }) => {
    repo.write(
      "pnpm-workspace.yaml",
      "minimumReleaseAge: 0\nallowBuilds: {}\n",
    );
    repo.git("add", "pnpm-workspace.yaml");
    const { code, output } = repo.run(["--staged"]);
    expect(code).toBe(1);
    expect(output).toContain("pnpm-workspace.yaml");
    expect(output).toContain("动了依赖面");
  });

  test("合并已解完、尚未落地（MERGE_HEAD 在场）→ ② 不判，话术说清是「已合并」而非「未校验」", ({
    repo,
  }) => {
    /* 立案现场：解冲突的人把 `origin/master` 合了进来、依赖面与远端逐字一致，
     * 提交却被这条判据拦下 —— 出口让他「把 origin/master 合并进来」，而他刚做完
     * 那件事。根因是 `git commit` 落地前 HEAD **还没动**，`--is-ancestor` 看不见
     * 远端已进来、`merge-base` 回的仍是合并前的分叉点。 */
    /* 造一个**真要合并**的现场（`merge --no-commit` 只在两侧都有各自的新提交时
     * 才留下 `MERGE_HEAD`）：远端从分叉点往前一步、本地也在自己这边往前走一步，
     * 于是它们真的分叉了，合并必须产生一个合并提交。
     * 远端那一步**只动一个与依赖无关的文件** —— ② 要判的是「远端有没有改依赖」，
     * 这次没有；把它设成「远端改了依赖」会让 ② 本来就该报红，测不出 MERGE_HEAD 那一态。 */
    repo.git("checkout", "-q", "-b", "remote-side", "fork-point");
    repo.write("docs/remote.md", "远端往前一步\n");
    repo.git("add", "-A");
    repo.commit("远端：只改文档，不动依赖面");
    repo.git("update-ref", "refs/remotes/origin/master", "HEAD");
    repo.git("checkout", "-q", "master");
    repo.write("docs/local.md", "本地往前一步\n");
    repo.git("add", "-A");
    repo.commit("本地：自己这边也往前一步");
    // `--no-ff` 在这里是必需的（两侧都有新提交，本来也快进不了；写出来是把
    // 「这次合并必须留 MERGE_HEAD」这条意图钉在用例里）。
    repo.git("merge", "--no-ff", "--no-commit", "remote-side");
    // 只判 ② 那一层：夹具里没装 node_modules，③ 必红（`code` 整体是 1）——
    // 拿它当判据会把「② 修好了」与「③ 也装好了」混成同一件事（同本文件里
    // 「只动了 lockfile 的注释」那条的口径）。
    // 反向对照：没有 MERGE_HEAD 时这同一条比对是会红的（见下面那条用例的现场）。
    expect(parseReport(repo.run(["--json"]).output).remoteDrifts).toEqual([]);
    // 话术在人读的那一档（`--json` 只出数据、不出散文）。
    const { output } = repo.run();
    expect(output).toContain("已合并");
    // 「没看」与「远端已经在本次合并里」必须在输出形态上分得开（同 ④ 那条口径）。
    expect(output).not.toContain("未校验");
  });

  test("MERGE_HEAD 不在场时这一态不生效（自己改依赖照旧要判 ②）", ({ repo }) => {
    // 反向对照：同一个「远端停在分叉点」的现场，只是没有在合并 —— `remoteDrifts`
    // 为空是因为**远端真没动依赖**，不是因为把 ② 关掉了。这里让远端前进过依赖，
    // 预期仍然报出来。
    repo.git("reset", "--hard", "fork-point");
    repo.write("package.json", PKG_REMOTE);
    repo.git("add", "-A");
    repo.commit("远端：升级依赖");
    repo.git("update-ref", "refs/remotes/origin/master", "HEAD");
    repo.git("reset", "--hard", "fork-point");
    const { output } = repo.run(["--json"]);
    expect(parseReport(output).remoteDrifts.map((d) => d.file)).toContain(
      "package.json",
    );
  });

  test("分叉之后自己在分支上加依赖 → 不算「远端改过依赖」（基准是分叉点）", ({
    repo,
  }) => {
    // 现场重搭：远端**停在分叉点**（它没再动依赖），而我在自己的分支上把 `a` 从
    // 0.9.0 换成 0.8.0。拿 `origin/master` 直接比工作区会把它报成「远端改过依赖」
    // （反向误报）；基准取分叉点时，远端在依赖面上一字未动 ⇒ 这一层不报。
    repo.git("update-ref", "refs/remotes/origin/master", "fork-point");
    repo.git("reset", "--hard", "fork-point");
    repo.write("package.json", `{"name":"x","dependencies":{"a":"0.8.0"}}\n`);
    repo.git("add", "-A");
    repo.commit("我的分支：降级 a 到 0.8.0");
    const { output } = repo.run(["--json"]);
    expect(parseReport(output).remoteDrifts).toEqual([]);
  });
});
