/**
 * 提交门槛自检：oxfmt 格式判据（ISSUE #575 第 9 项 / #1811 收尾 / 规范 §13.5）。
 *
 * 这一条在 ISSUE #1811 收尾时**从棘轮翻成硬闸**：存量已清零，于是棘轮车道没有
 * 成员 —— `--update` 写回去的永远是一份空账，留下的却是「手改 JSON 就能把新
 * 违规登记成已知存量」这条通道（§13.6.2 的两类对照）。基线文件已删、
 * `--update` / `--strict` 已不存在。
 *
 * 价值仍在**两个方向**都成立上：真的拦住脏文件，也放过干净文件（一个永远返回
 * 非空的扫描器会让一切都红）。用「临时工作区 + 只放被测文件」跑真脚本。
 *
 * 为什么用子进程而不是 import：脚本被 pre-commit 以 `node scripts/xxx.cjs`
 * 调用，且用 `process.cwd()` 定位扫描根 —— 复用同一调用方式才等价于真实门禁。
 *
 * 规范：docs/standards/13-提交与-code-review.md §13.5
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { defineGateRepo, describe } from "./helpers/gate-repo";
import { gitSandboxEnv } from "./helpers/git-sandbox-env";
import { vi } from "vitest";

/* 每条用例都要在临时工作区里真跑 git（init / add / commit）并**真起 prettier**
 * —— 门禁按 glob 各调一次 `prettier --list-different`，实测单次约 300~550ms。
 * 默认 5s 的用例超时在本机是「刚好够用」，CI 全量并行满载时会直接被击穿：现场
 * 是 `Test timed out in 5000ms`，且报错会落在**调度顺序**排在后面的任意一条用例
 * 上（看起来像「某条用例写得慢」，实际是整条固定成本顶着上限跑）。
 *
 * 这一处方与 `check-reformat-only.test.ts` 同源：那里把「每条用例起十几个
 * prettier」收敛成「整批一次」，这里没有可收敛的调用数（每条用例都要建一个独立
 * 仓库 + 基线），所以只能放宽整文件的超时。放宽只影响本文件。 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** 真实仓里 oxfmt 的入口（沙箱用例通过 `COMFYAPP_OXFMT_ENTRY` 借给它）。 */
const OXFMT_ENTRY = join(
  dirname(createRequire(join(process.cwd(), "noop.js")).resolve("oxfmt/package.json")),
  "bin",
  "oxfmt",
);

const { test, expect } = defineGateRepo({
  script: "check-format.cjs",
  dirs: ["src/lib"],
  /* 沙箱里没有 `node_modules`，不借这条接缝就会走「入口解析不到 → exit 2」
   * 那一档（那是脚本**正确**的 fail-closed 行为，不是本文件要验的形态）。
   * 「借不到」那一档由 `run(..., { env: { COMFYAPP_OXFMT_ENTRY: undefined } })`
   * 单独造（见下面两条 fail-closed 用例）。 */
  env: { COMFYAPP_OXFMT_ENTRY: OXFMT_ENTRY, COMFYAPP_FORMAT_DEBUG: "1" },
  /* `--staged` 那批用例要读 `git diff --cached` —— 临时工作区必须是个真的 git 仓库。 */
  setup: (repo) => {
    repo.git("init", "-q");
    repo.git("config", "user.email", "t@local");
    repo.git("config", "user.name", "t");
    repo.git("config", "commit.gpgsign", "false");
    repo.git("config", "tag.gpgsign", "false");
  },
});

// 脏内容：多余空格 + 多余空行，oxfmt 一定会改它。
const DIRTY = "export const PROBE={a:1,\n\n\n  b:2};\n";
const CLEAN = "export const PROBE = { a: 1, b: 2 };\n";
/* 另一种干净形态（`--staged` 判面收窄那条用例要暂存一份**干净的**改动）。 */
const CLEAN2 = "export const PROBE = { b: 2, a: 1 };\n";

/**
 * 「没有平台旗标」那一档的输入：**声明**不设它，而不是指望跑测试那一跳恰好没设。
 *
 * 平台的「受影响用例」运行器给每个 stage 进程都注入 `CNB_PULL_REQUEST_TARGET_SHA`
 * （ISSUE #2795）：继承来的基线在临时夹具仓库里不存在 ⇒ 判据 fail-closed 退 2，
 * 于是「本机绿、平台恒红」，而报错一个字都不指向「继承」这件事。
 */
const NO_PLATFORM_TARGET = { env: { CNB_PULL_REQUEST_TARGET_SHA: undefined } };

/** 读工作区 HEAD 的 sha（`--changed` 用例拿它当 `CNB_PULL_REQUEST_TARGET_SHA`）。 */
function gitSha(dir: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
}

describe("oxfmt 格式判据（硬闸）", () => {
  test("全库格式干净 → 通过", ({ repo }) => {
    repo.write("src/lib/keep.ts", CLEAN);
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("[ok] oxfmt 格式");
  });

  test("未过格式的文件 → 阻断，并指出是哪个文件", ({ repo }) => {
    repo.write("src/lib/keep.ts", CLEAN);
    repo.write("src/lib/fresh.ts", DIRTY);
    const r = repo.run();
    /* 失败信息带上判据自己的读数：本地绿 / CI 红的形态差，没有这批输出只能猜。 */
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("src/lib/fresh.ts");
    expect(r.output).toContain("个文件未过");
  });

  test("把原本干净的文件弄脏 → 同样阻断（没有存量额度）", ({ repo }) => {
    repo.write("src/lib/keep.ts", DIRTY);
    const r = repo.run();
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("src/lib/keep.ts");
  });

  test("翻硬闸后 --update / --strict 是断头的（不许有隐藏放宽通道）", ({ repo }) => {
    /* 少了这一格，「删了 --update」与「--update 还在但没人调」看起来一样。 */
    repo.write("src/lib/fresh.ts", DIRTY);
    for (const flag of ["--update", "--strict"]) {
      const r = repo.run([flag]);
      expect(r.code, `${flag} 不该放行脏文件`).toBe(1);
      /* 出路不该是「跑 --update 收紧基线」——那条路已经不存在（判据的输出里
       * 只能出现「本判据是硬闸（无基线、无 --update）」这半句声明）。 */
      expect(r.output, `${flag} 的出路不该指向 --update`).not.toContain("--update 收紧");
    }
  });

  test("prettier 入口取不到 → exit 2，且**不许**读成「全库干净」", ({ repo }) => {
    /* 这条钉的是原来的 fail-open（台账 E11）：门禁过去经 `pnpm exec` 找 prettier，
     * 命令找不到时退出 1、stdout 为空，而脚本把「空清单」当成「0 个文件未过」
     * 并打 `[format] OK` 退出 0 —— 依赖缺失 / 形态选错的机器上门禁就这样瞎掉。 */
    repo.write("src/lib/keep.ts", CLEAN);
    const r = repo.run([], { env: { COMFYAPP_OXFMT_ENTRY: undefined } });
    expect(r.code).toBe(2);
    expect(r.output).toContain("找不到 oxfmt 入口");
    expect(r.output).not.toContain("[ok] oxfmt 格式");
  });

  test("prettier 退出 1 却一行都没列出来 → exit 2（「没跑成」与「有差异」分开）", ({ repo }) => {
    /* 沙箱里放一个「只按退出码说话」的假入口：`--list-different` 返回 1 的含义是
     * 「有差异，清单在 stdout」，清单为空就说明这句话不可信。 */
    repo.write("src/lib/keep.ts", CLEAN);
    const stubRel = "scripts/fake-oxfmt.cjs";
    repo.write(stubRel, "process.exit(1);\n");
    const stub = join(repo.dir, stubRel);
    const r = repo.run([], { env: { COMFYAPP_OXFMT_ENTRY: stub } });
    expect(r.code).toBe(2);
    expect(r.output).toContain("不是「全库干净」");
    expect(r.output).not.toContain("[ok] oxfmt 格式");
  });

  test("oxfmt 清单带 ANSI 颜色码 → 照样认出文件（CI 侧 stdout 着色的形态）", ({ repo }) => {
    /* 真实发生的失效：CI 侧 oxfmt 给文件名上色
     * （`\u001b[38;2;…msrc/lib/fresh.ts\u001b[0m (0ms)`），带码的「文件名」过不了
     * 白名单的路径形态，整张清单被悄悄滤成空 —— 门禁当场读成「命中 0 个」。
     * 这条用例用假入口复刻那批字节，钉住「剥码在解析之前」。 */
    const stubRel = "scripts/fake-oxfmt-color.cjs";
    repo.write(
      stubRel,
      `process.stdout.write("${String.raw`\u001b[38;2;244;191;117;1m`}src/lib/fresh.ts${String.raw`\u001b[0m (1ms)\n"`});\nprocess.exit(1);\n`,
    );
    const stub = join(repo.dir, stubRel);
    const r = repo.run([], { env: { COMFYAPP_OXFMT_ENTRY: stub } });
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("src/lib/fresh.ts");
  });

  test("测试 / 脚本 / 根级配置 / 非源码产物落在白名单里 → 不误报", ({ repo }) => {
    // 白名单是「形态」而不是文件列表：新增的这类文件自动豁免。
    // 夹具预建了空的 `src/lib`：oxfmt 对「存在但一个可扫文件都没有」的根报
    // `Expected at least one target file`（exit 2），所以这里放一份干净源文件
    // —— 让 oxfmt 真扫起来，验证的才是「白名单里的脏文件不被误报」。
    repo.write("src/lib/keep.ts", CLEAN);
    repo.write("tests/fresh.test.ts", DIRTY);
    repo.write("scripts/fresh.mjs", DIRTY);
    repo.write("e2e/fresh.spec.ts", DIRTY);
    /* Rust 壳的构建输出：它被**嵌套的** src-tauri/.gitignore 忽略，而 prettier 只
     * 按仓库根读 .gitignore —— 不进白名单就会拿它阻断每一次提交（ISSUE #638 修好
     * pnpm 启动形态后本门禁第一次真正扫到全库时暴露的现象）。 */
    repo.write("src-tauri/target/debug/build/app-1/out/__global-api-script.js", DIRTY);
    const r = repo.run();
    expect(r.code).toBe(0);
  });
});

describe("glob 白名单判定（纯函数，不跑 prettier）", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = /* SAFETY: 类型断言已复核 */ require("../scripts/check-format.cjs") as {
    globToRegExp: (glob: string) => RegExp;
    isIgnored: (rel: string) => boolean;
  };

  test.for(
    /* 表里的路径只是**分类样例**，一律用不存在的夹具路径（ISSUE #2830）：写成真路径时，
     * 「按路径引用」那一档会把整份自测算成它们的消费方 —— 改一个 `src/**` 业务文件就拉起
     * 这 40 多秒的一跑。被测脚本自己（`scripts/check-format.cjs`）照旧写真实路径，那是消费关系。 */
    /* SAFETY: 类型断言已复核 */ [
      ["scripts/check-format.cjs", true],
      ["tests/anything.test.ts", true],
      ["e2e/fixture.spec.ts", true],
      ["docs/api/assets/main.js", true],
      ["fixture.config.js", true],
      ["fixture.config.ts", true],
      // 非源码产物（Rust 壳构建输出）豁免；glob 锚在 src-tauri 下，不是「任何 target 目录」
      ["src-tauri/target/release/build/app-x/out/__global-api-script.js", true],
      ["src-tauri/src/fixture-main.rs", false],
      ["src/lib/target/keep.ts", false],
      ["src/lib/fixture-endpoints.ts", false],
      ["src/components/ui/fixture-button.tsx", false],
      ["src/app/api/health/fixture-route.ts", false],
    ] as const,
  )("%s → ignored=%s", ([rel, expected]) => {
    expect(mod.isIgnored(rel)).toBe(expected);
  });

  test("`*.config.{ts,js}` 这一类花括号展开只匹配一层目录", () => {
    expect(mod.isIgnored("prettier.config.js")).toBe(true);
    expect(mod.isIgnored("src/lib/fixture.config.js")).toBe(false);
  });
});

/**
 * `--staged` 的输入面跳过（ISSUE #1747）。
 *
 * ⚠️ 这一档自 ISSUE #2010 起**不再是钩子里的那一条**（钩子那一步整体挪到了平台侧，
 * 平台侧跑的是全量档、不带 `--staged`）。它留下来是因为 `--staged` 仍是**人的动作**
 * ——提交前自查「我这一批改动有没有带脏文件进来」，而人不想为此扫全库。
 * 判据本体与前一档一字不差，判法也不变（下面这些用例判的是那个 flag 的语义，
 * 与谁在什么时候敲它无关）。
 *
 * 这一步的扫描面由 `GLOBS` 与 `IGNORE_GLOBS` 现算（实测只剩 `src/**` 与
 * `.storybook/**`），两个方向都要钉住：不在扫描面内 ⇒ 跳过（省下全库扫描），
 * 在扫描面内 ⇒ **照旧真扫**（跳过不是「让判据松掉」的后门）。
 *
 * 为什么断言 `code === 0` 之外还要看输出：「跳过」与「扫过之后没有脏文件」是同
 * 一个退出码，只看退出码的话，一条把 `--staged` 实现成「永远跳过」的改动能全绿
 * 通过 —— 那正是门禁静默失效的形态（§11.23 的「声明 ⇄ 读者」）。
 */
describe("oxfmt 格式判据 --staged 输入面跳过（ISSUE #1747）", () => {
  test("暂存文件全在扫描面外 → 跳过（不起 prettier）", ({ repo }) => {
    repo.write("src/lib/dirty.ts", DIRTY);
    repo.git("add", "-A");
    repo.commit("clean-baseline");
    // 改一个不在 prettier 靶子里的文件：`IGNORE_GLOBS` 收 `scripts/**`。
    repo.write("scripts/probe.cjs", "module.exports = {a:1,   b:2}\n");
    repo.git("add", "scripts/probe.cjs");
    const r = repo.run(["--staged"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("未触及扫描面");
    expect(r.output).not.toContain("运行 oxfmt");
  });

  test("暂存文件落在扫描面内 → 真扫（脏文件照旧阻断）", ({ repo }) => {
    repo.write("src/lib/dirty.ts", CLEAN);
    repo.git("add", "-A");
    repo.commit("clean-baseline");
    repo.write("src/lib/dirty.ts", DIRTY);
    repo.git("add", "src/lib/dirty.ts");
    const r = repo.run(["--staged"]);
    expect(r.code, r.output).toBe(1);
    expect(r.output).not.toContain("未触及扫描面");
    expect(r.output).toContain("src/lib/dirty.ts");
  });

  test("无暂存改动 → 跳过（不为空提交白扫全库）", ({ repo }) => {
    const r = repo.run(["--staged"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("未触及扫描面");
  });

  test("--staged 只判暂存的那一批：面外同仓的脏文件不再被扫", ({ repo }) => {
    /* 判面收窄的钉子（printWidth 80→100 迁移的地基，见判据文件头）：收窄前
     * 命中暂存面后回落**全库**扫 —— 迁移期间那份全库读数对未迁移的存量恒红，
     * 等于每一次碰 src 的提交都被别人的旧文件拦死。收窄后判的是「这一批带进来
     * 的是什么」：暂存的是干净改动 ⇒ 放行，哪怕工作区里还躺着没暂存的脏文件。 */
    repo.write("src/lib/keep.ts", CLEAN);
    repo.git("add", "-A");
    repo.commit("clean-baseline");
    repo.write("src/lib/keep.ts", CLEAN2);
    repo.git("add", "src/lib/keep.ts");
    repo.write("src/lib/fresh.ts", DIRTY);
    const r = repo.run(["--staged"]);
    expect(r.code, r.output).toBe(0);
    expect(r.output).not.toContain("src/lib/fresh.ts");
  });
});

/**
 * 合并态下的 `--staged` 输入面（ISSUE #2747）。
 *
 * 现场：PR 分支上 `git merge origin/master` 解冲突，`.githooks/pre-commit` 的 D0 这一步
 * 把**主干带来的全部存量未格式化文件**当成本次提交点名（实测那次：`git diff --cached`
 * 有 901 份、被点名 2 份，而那两份相对 `origin/master` 是零 diff），于是一次与本 PR
 * 无关的解冲突被别人的旧账拦死。同一判据的 `--changed` 档对同一条链给出相反结论
 * （「0 个在靶子内」）—— 两个入口不可能都对，错的是 `--staged` 这一头的输入面：
 * 合并未提交时 `git diff --cached` 是**相对第一父提交**的全量差异，不是「本次改动」。
 *
 * 四条用例钉四件事，缺任何一条都能静默通过：
 *   ① 收窄生效（主干存量不被点名）—— 平台基线那一档；
 *   ② 同一个面在**本地那一档**（没有平台旗标、走 merge-base 兜底）也成立 —— 现场就是本地；
 *   ③ 收窄**不是消音**：解冲突时动了「本分支自己面内」的文件，仍然被点名并阻断；
 *   ④ 对照：合并状态一消失（`MERGE_HEAD` 不在），同一批文件立刻回到判据面内。
 *      没有这一条，「把 `--staged` 实现成永远跳过」也能全绿。
 *
 * 一条边界（③ 的形状为什么要说清）：本分支**已提交**的改动，在合并那一刻不在
 * `git diff --cached` 里（它们是 HEAD 自己的内容），所以也不在收窄后的面内 ——
 * 它们由**自己那一次提交**的 `--staged` 判过，平台 `--changed` 那一档再按 merge-base
 * 三点 diff 判一遍；两档合起来才是完整一条链（判据文件头那段话）。本单修的是
 * 「合并那一刻把主干的账算进本次」这一格，不是把 `--staged` 扩成第二份全量。
 */
describe("oxfmt 格式判据 --staged 在合并态收窄输入面（ISSUE #2747）", () => {
  /** 合并来源那条分支的 tip sha（`CNB_PULL_REQUEST_TARGET_SHA` 的形状）。 */
  function shaOf(dir: string, ref: string): string {
    return execFileSync("git", ["rev-parse", ref], { cwd: dir, encoding: "utf8" }).trim();
  }

  /**
   * 夹具那份 `repo.git` / `repo.commit` 是 `stdio: "ignore"`（各自注释里写明了），
   * 于是这一族用例里「造历史」那一步一失败，屏幕上只剩一句 `Command failed`，
   * git 自己那句话读不到 —— 正是本文件反复在防的「报错指不到夹具」。
   * 造合并现场要六步 git，这里自带 stderr：失败时把 git 的原话抛出来。
   */
  function gitOf(dir: string, args: Array<string>): string {
    try {
      return execFileSync("git", args, {
        cwd: dir,
        encoding: "utf8",
        env: gitSandboxEnv(),
      }).trim();
    } catch (error) {
      const err = error as { message: string; stderr?: string };
      /* 空串 stderr 也算「没拿到那句话」（git 走 stdout-only 失败形态时就是这样），
       * 所以这里判的是「有没有内容」而不是「是不是 undefined」—— 用 `??` 会把空串端出去。 */
      const why = err.stderr && err.stderr.trim() !== "" ? err.stderr : err.message;
      throw new Error(`git ${args.join(" ")} 失败：${why}`, { cause: error });
    }
  }

  /**
   * 造两条线并停在「合并已解完、提交未落地」那一态：
   * master 上加一份**脏**文件（主干存量），分支上按 `mine` 加一份自己的文件。
   *
   * @returns 合并来源那一头的 sha（当 `CNB_PULL_REQUEST_TARGET_SHA` 用）
   */
  function toMergeState(
    repo: {
      dir: string;
      write: (rel: string, content: string) => void;
    },
    mine: string,
  ): string {
    const dir = repo.dir;
    repo.write("src/lib/keep.ts", CLEAN);
    gitOf(dir, ["add", "-A"]);
    gitOf(dir, ["commit", "-qm", "seed"]);
    /* `branch -M master`：把当前分支钉成**字面名** `master`（夹具的 `git init -q` 用
     * 宿主的默认分支名）。本地那一档要靠 `resolveMergeBaseRef` 的兜底链，而它认的是
     * `master` 这个名字 —— 不钉住它，换一台机器（默认分支叫 `main`）就换一条断言。 */
    gitOf(dir, ["branch", "-M", "master"]);
    gitOf(dir, ["checkout", "-q", "-b", "feat/x"]);
    repo.write("src/lib/mine.ts", mine);
    gitOf(dir, ["add", "-A"]);
    gitOf(dir, ["commit", "-qm", "mine"]);
    gitOf(dir, ["checkout", "-q", "master"]);
    repo.write("src/lib/legacy.ts", DIRTY);
    gitOf(dir, ["add", "-A"]);
    gitOf(dir, ["commit", "-qm", "legacy-on-master"]);
    const target = shaOf(dir, "HEAD");
    gitOf(dir, ["checkout", "-q", "feat/x"]);
    /* `--no-commit`：把仓库停在合并态（`MERGE_HEAD` 在场）—— 这正是被拦那一刻的形状。 */
    gitOf(dir, ["merge", "--no-commit", "--no-edit", "master"]);
    return target;
  }

  test("平台基线那一档：主干带来的脏存量不再被点名，屏幕上念出收窄了多少", ({ repo }) => {
    const target = toMergeState(repo, CLEAN2);
    const r = repo.run(["--staged"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: target },
    });
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("合并态（MERGE_HEAD 在场）");
    expect(r.output).toContain("暂存面 1 份 → 收窄到本分支带来的 0 份");
    expect(r.output).not.toContain("src/lib/legacy.ts");
  });

  test("本地那一档（没有平台旗标，走 merge-base 兜底）给出同一个面", ({ repo }) => {
    toMergeState(repo, CLEAN2);
    const r = repo.run(["--staged"], NO_PLATFORM_TARGET);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("暂存面 1 份 → 收窄到本分支带来的 0 份");
    expect(r.output).not.toContain("src/lib/legacy.ts");
  });

  test("收窄不是消音：合并时动了本分支自己面内的文件，照样被点名", ({ repo }) => {
    toMergeState(repo, CLEAN2);
    /* 解冲突那一步顺手把**本 PR 自己带的那份**文件改脏了（这条正是要判的形状）：
     * 它在「本分支相对目标带来的那一份」面内 ⇒ 收窄之后仍然留着它 ⇒ 阻断并点名。
     * 用 git 直接造这一步（不走 `repo.commit`）：这次改的是**未提交的暂存内容**，
     * 提交它就不是「合并那一刻」的形状了。 */
    repo.write("src/lib/mine.ts", DIRTY);
    gitOf(repo.dir, ["add", "src/lib/mine.ts"]);
    const r = repo.run(["--staged"], NO_PLATFORM_TARGET);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("src/lib/mine.ts");
    /* 只点名这一份 —— 主干那份仍不在面内（两条同时断言，才排除「整个跳过」与
     * 「把两份都端上来」这两个相反的错误实现）。 */
    expect(r.output).not.toContain("src/lib/legacy.ts");
  });

  test("对照：合并状态一消失，同一批主干文件回到判据面内", ({ repo }) => {
    toMergeState(repo, CLEAN2);
    gitOf(repo.dir, ["commit", "-qm", "merge-it"]);
    /* 把合并提交退回第一父：索引不动 ⇒ 暂存面 = 主干那份 delta，而 `MERGE_HEAD` 已不在。
     * 这一步之后判据必须**照旧**点名它 —— 收窄只绑在合并态，不是一副永久眼罩。 */
    gitOf(repo.dir, ["reset", "-q", "--soft", "HEAD^"]);
    const r = repo.run(["--staged"], NO_PLATFORM_TARGET);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("src/lib/legacy.ts");
    expect(r.output).not.toContain("合并态（MERGE_HEAD 在场）");
  });
});

/**
 * `--changed`：改动面档（printWidth 80→100 增量迁移的执行档，平台侧与 check:all 用）。
 *
 * 改动面取自 `changed-scope.mjs` 的 `resolveChangedFiles`（唯一出处，§12.18）：
 * 给了 `CNB_PULL_REQUEST_TARGET_SHA` 就按它三点 diff —— 所以每条用例自己给基线
 * sha，不依赖 git 的默认分支名，也不踩 `resolveMergeBaseRef` 的兜底链。
 *
 * 与 `--staged` 同一条纪律：跳过与「扫过之后没有脏文件」是同一个退出码，
 * 所以每条断言都同时看输出（§11.23 的「声明 ⇄ 读者」）。
 */
describe("oxfmt 格式判据 --changed 改动面档", () => {
  test("改动面里有未过格式的文件 → 阻断，并指出是哪个文件", ({ repo }) => {
    repo.write("src/lib/keep.ts", CLEAN);
    repo.git("add", "-A");
    repo.commit("clean-baseline");
    const base = gitSha(repo.dir);
    repo.write("src/lib/fresh.ts", DIRTY);
    repo.git("add", "-A");
    repo.commit("dirty");
    const r = repo.run(["--changed"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: base },
    });
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("src/lib/fresh.ts");
  });

  test("改动面全在扫描面外 → 跳过（不起 oxfmt）", ({ repo }) => {
    repo.write("src/lib/keep.ts", CLEAN);
    repo.git("add", "-A");
    repo.commit("clean-baseline");
    const base = gitSha(repo.dir);
    repo.write("scripts/probe.cjs", "module.exports = {a:1,   b:2}\n");
    repo.git("add", "-A");
    repo.commit("scripts-only");
    const r = repo.run(["--changed"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: base },
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain("未触及扫描面");
    expect(r.output).not.toContain("运行 oxfmt");
  });

  test("改动面里混着白名单文件 → 只判扫描面内的那份", ({ repo }) => {
    repo.write("src/lib/keep.ts", CLEAN);
    repo.git("add", "-A");
    repo.commit("clean-baseline");
    const base = gitSha(repo.dir);
    repo.write("src/lib/fresh.ts", CLEAN);
    repo.write("scripts/fresh.mjs", DIRTY);
    repo.git("add", "-A");
    repo.commit("mixed");
    const r = repo.run(["--changed"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: base },
    });
    expect(r.code, r.output).toBe(0);
  });

  test("改动面取不到（没有任何提交）→ exit 2，不冒充干净", ({ repo }) => {
    repo.write("src/lib/keep.ts", CLEAN);
    const r = repo.run(["--changed"]);
    expect(r.code).toBe(2);
    expect(r.output).toContain("改动面没算出来");
    expect(r.output).not.toContain("[ok] oxfmt 格式");
  });

  test("只判已提交的改动：未提交的脏文件不在改动面（提交那一刻由 --staged 判）", ({ repo }) => {
    /* 这是 `git diff <基线>...HEAD` 的定义边界，不是漏洞：改动面档跑在 push/CI
     * 那两跳上，那里的一切都已提交；提交瞬间的干净由 `--staged` 档背书。
     * 钉住它，防止将来有人把「未提交」悄悄混进改动面造成两档重复判。 */
    repo.write("src/lib/keep.ts", CLEAN);
    repo.git("add", "-A");
    repo.commit("clean-baseline");
    const base = gitSha(repo.dir);
    repo.write("src/lib/fresh.ts", DIRTY);
    const r = repo.run(["--changed"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: base },
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain("未触及扫描面");
  });
});
