/**
 * check-deps-freshness.mjs 的契约测试（规范 §13.5.6 同族：判据自己也要有判据）。
 *
 * 它判的是**「远端改过依赖而本地没同步」能不能被看见**这件事本身，所以用例必须在
 * 真 git 仓库上跑 —— 「远端」不是一个可 mock 的模块，它就是
 * `refs/remotes/origin/master` 这条引用加一条它自己的 reflog。夹具用共享的
 * `defineGateRepo`（§11.16.1），`setup` 里把它 `git init` 好、造一次提交、
 * 再把那条远端引用指过去。
 *
 * 覆盖的七条分界（都是「一眼看着该红、其实绿」或反过来的那种）：
 *   1. 远端改了 `package.json` 的版本声明 → 红，且话术里有可执行出口；
 *   2. 远端改了 lockfile 的**解析结果** → 红，且明细指到具体包与版本；
 *   3. 远端只动 lockfile 的注释 / 顺序 → **不报**（实质 diff，不是字符串比）；
 *   4. 没有远端引用 / 没有取证时间 → `[未校验]`，**不给出**「一致」这个结论；
 *   5. `--offline` 不读 git → 只判本地自洽那一层；
 *   6. 不是 git 检出 → exit 2（环境故障，不是「依赖没问题」）；
 *   7. `--staged` 的触发面：没碰依赖面 → 零输出退 0；碰了 → 照判并点出文件名。
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
  installDrift: { state: string } | null;
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
