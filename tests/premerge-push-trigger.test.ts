/**
 * 「合并前的固定动作」挂到 push 上的四条边界（规范 §13.6.2.1，ISSUE #623）。立案现场：`pnpm
 * check:premerge` 唯一执行者是纪律，平台 squash 不跑本地钩子、也无 CI 兜底；最坏回潮是「接了线却没人
 * 守那条线」，所以既判决策也判钩子真在调它。并入固定清单：改 `.githooks/**` 让增量层放弃收窄，留原地等于不跑。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  decideBaseAttribution,
  decidePremergePush,
  exitForNotRun,
  isForeignRemotePush,
  mergeCandidates,
  parseRefLines,
  readProof,
  readRevisions,
  writeProof,
} from "../scripts/premerge-proof.mjs";

const HEAD = "a".repeat(40);
const UPSTREAM = "b".repeat(40);

/** @param {string} sha @param {string} [remoteSha] */
function refLine(localSha = HEAD, remoteSha = UPSTREAM) {
  return `refs/heads/feat/x\t${localSha}\trefs/heads/feat/x\t${remoteSha}`;
}

describe("ref 行解析与候选筛选（§13.6.2.1）", () => {
  it("一行四列都读出来，空行与半截行不算", () => {
    const refs = parseRefLines(`${refLine()}\n\nrefs/heads/y\tdeadbeef\n`);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.localSha).toBe(HEAD);
    expect(refs[0]?.remoteRef).toBe("refs/heads/feat/x");
  });

  it("master 本身、tag、以及删除（local 全零）都不是候选", () => {
    const refs = parseRefLines(
      [
        `refs/heads/master\t${HEAD}\trefs/heads/master\t${UPSTREAM}`,
        `refs/tags/v1\t${HEAD}\trefs/tags/v1\t${"0".repeat(40)}`,
        `(delete)\t${"0".repeat(40)}\trefs/heads/feat/gone\t${HEAD}`,
        refLine(),
      ].join("\n"),
    );
    const candidates = mergeCandidates(refs);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.remoteRef).toBe("refs/heads/feat/x");
  });
});

describe("过期判定：什么时候才值得花那 336 秒", () => {
  it("HEAD 与上游都没动 ⇒ 不跑，且给得出理由", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: {
        headSha: HEAD,
        upstreamSha: UPSTREAM,
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(verdict.verdict).toBe("skip");
  });

  it("本机从没复算过 ⇒ 跑", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: null,
    });
    expect(verdict.verdict).toBe("run");
    expect(verdict.reasons.join("；")).toContain("没有过合并前复算的记录");
  });

  it("提交动了（HEAD 变了）⇒ 跑，且理由里带上两颗 sha 供人核对", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: {
        headSha: "c".repeat(40),
        upstreamSha: UPSTREAM,
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(verdict.verdict).toBe("run");
    expect(verdict.reasons.join("；")).toContain(HEAD.slice(0, 8));
  });

  it("上游前移了 ⇒ 跑 —— 这一条才是「把红带进 master」真正的入口", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: {
        headSha: HEAD,
        upstreamSha: "d".repeat(40),
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(verdict.verdict).toBe("run");
    expect(verdict.reasons.join("；")).toContain("上游");
  });

  it("一次推多条分支时，证明只覆盖当前 HEAD ⇒ 不许免检", () => {
    const refs = parseRefLines([refLine(), refLine("e".repeat(40))].join("\n"));
    const verdict = decidePremergePush({
      candidates: mergeCandidates(refs),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: {
        headSha: HEAD,
        upstreamSha: UPSTREAM,
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(verdict.verdict).toBe("run");
    expect(verdict.reasons.join("；")).toContain("不在当前 HEAD 上");
  });

  it("没有目标分支 ref ⇒ 不跑也不拦（推 tag 不该被这一跳卡住）", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(`refs/tags/v1\t${HEAD}\trefs/tags/v1\t${HEAD}`)),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: null,
    });
    expect(verdict.verdict).toBe("skip");
    expect(verdict.reasons[0]).toContain("没有要合进 master 的分支");
  });

  it("取不到上游引用 ⇒ 不许读成「没必要跑」（那会让没 fetch 过的检出静默免检）", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: null,
      proof: null,
    });
    expect(verdict.verdict).toBe("unavailable");
    expect(verdict.reasons[0]).toMatch(/^取不到/);
  });
});

describe("「不跑」那两档的退出码（ISSUE #2386：skip 与 unavailable 不许撞在同一个值上）", () => {
  it("unavailable ⇒ 退 2 —— 跑不了不算绿，出口是 git fetch 而不是免检", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: null,
      proof: null,
    });
    const got = exitForNotRun(verdict, {
      proof: null,
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: null,
    });
    expect(got?.code).toBe(2);
    expect(got?.err).toContain("退 2");
  });

  it("skip 且证明仍成立 ⇒ 退 0 并念「跳过」（这才是「没必要跑」的原义）", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: {
        headSha: HEAD,
        upstreamSha: UPSTREAM,
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const got = exitForNotRun(verdict, {
      proof: {
        headSha: HEAD,
        upstreamSha: UPSTREAM,
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
    });
    expect(got?.code).toBe(0);
    expect(got?.out).toContain("跳过合并前复算");
  });

  it("run ⇒ 不接（null）：复算那半段归 runFromStdin，不在这一档冒充结论", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: null,
    });
    expect(verdict.verdict).toBe("run");
    expect(
      exitForNotRun(verdict, {
        proof: null,
        candidates: mergeCandidates(parseRefLines(refLine())),
        headSha: HEAD,
        upstreamSha: UPSTREAM,
      }),
    ).toBeNull();
  });
});

describe("归属决定：别线的红不挡路，其余一律挡（§13.6.2 / §11.12）", () => {
  it("全是 `baseline-red` ⇒ 放行，并把名单带出去（不挡路 ≠ 不说）", () => {
    const d = decideBaseAttribution({
      summary: "baseline-red",
      rows: [
        {
          label: "基础设施层文件长度棘轮",
          currentCode: 1,
          verdict: "baseline-red",
        },
        { label: "别的判据", currentCode: 0, verdict: "current-green" },
      ],
    });
    expect(d.allowed).toBe(true);
    expect(d.baselineOnly).toEqual(["基础设施层文件长度棘轮"]);
    expect(d.blocking).toEqual([]);
  });

  it("`yours` 混在里面 ⇒ 拦（这条线不许把自线的红算进别线的账）", () => {
    const d = decideBaseAttribution({
      rows: [
        { label: "A", currentCode: 1, verdict: "baseline-red" },
        { label: "B", currentCode: 1, verdict: "yours" },
      ],
    });
    expect(d.allowed).toBe(false);
    expect(d.blocking).toEqual(["B"]);
  });

  it("`load-flake` 与 `inconclusive` 都拦：拿不到测量 ≠ 测量是绿的", () => {
    for (const verdict of ["load-flake", "inconclusive"]) {
      const d = decideBaseAttribution({
        rows: [{ label: "X", currentCode: 1, verdict }],
      });
      expect(d.allowed).toBe(false);
      expect(d.blocking[0]).toContain("X");
    }
  });

  it("归属里出现没登记的状态值 ⇒ 保守拦，不猜它是别线", () => {
    const d = decideBaseAttribution({
      rows: [{ label: "X", currentCode: 1, verdict: "who-knows" }],
    });
    expect(d.allowed).toBe(false);
  });

  it("归属读不出 / 段报红而逐条里没有红项 ⇒ 都按「不构成证据」拦下", () => {
    expect(decideBaseAttribution(null).allowed).toBe(false);
    expect(decideBaseAttribution({ rows: [] }).allowed).toBe(false);
    expect(decideBaseAttribution({ rows: [] }).reason).toContain("两份读数不一致");
  });

  it("红项没有 label 时不写出 undefined", () => {
    const d = decideBaseAttribution({
      rows: [{ currentCode: 1, verdict: "yours" }],
    });
    expect(d.blocking[0]).toContain("(未命名判据)");
  });
});

describe("证明的读写（本机、不入库；红着不许记）", () => {
  it("写入后能原样读回，并带上时间与命令", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "comfy-premerge-proof-"));
    try {
      writeProof(dir, { headSha: HEAD, upstreamSha: UPSTREAM, who: "tester" });
      const proof = readProof(dir);
      expect(proof?.headSha).toBe(HEAD);
      expect(proof?.upstreamSha).toBe(UPSTREAM);
      expect(typeof proof?.verifiedAt).toBe("string");
      expect(String(proof?.how ?? proof?.verifiedAt)).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("没有记录 / 半截 JSON 都读成 null（代价是多跑一次，不是少跑一次）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "comfy-premerge-proof-"));
    try {
      expect(readProof(dir)).toBeNull();
      writeFileSync(path.join(dir, "comfy-premerge-proof.json"), '{"headSha":', "utf8");
      expect(readProof(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("接线在位（判据要有人跑，也要有人守那条线）", () => {
  const hook = readFileSync(".githooks/pre-push", "utf8");

  it("钩子真的调用这份脚本，并把「远端名 + 远端 URL」传下去（注释里的同名字样不算调用）", () => {
    // 锚定行首：把那一行前面加 `# ` 注掉之后，`toContain` 仍然命中，只有这里会红。
    // `"$1" "$2"` 是目的地那一问的输入（ISSUE #3025）：少了它们，推向镜像仓库的 push
    // 会拿到「取不到上游引用」的读数而被拦死。
    expect(hook).toMatch(/^node scripts\/premerge-proof\.mjs "\$1" "\$2" <"\$refs_in"/m);
  });

  it("stdin 只读一次、再分喂两处 —— 少一处就会有一方拿到空输入且不报错", () => {
    expect(hook).toMatch(/^cat >"\$refs_in" \|\| exit 1$/m);
    expect(hook).toMatch(/^git lfs pre-push "\$@" <"\$refs_in" \|\| exit \$\?$/m);
    expect(hook).toMatch(
      /^node scripts\/premerge-proof\.mjs "\$1" "\$2" <"\$refs_in" \|\| exit \$\?$/m,
    );
  });

  it("LFS 那一跳没有被这次接线挤掉", () => {
    expect(hook).toContain("git lfs pre-push");
    expect(hook).toMatch(/command -v git-lfs/);
  });

  it("台账认得 pre-push 这个执行者来源（否则接线会被读成「没人跑」）", () => {
    const ledger = readFileSync("scripts/check-gate-executors.cjs", "utf8");
    expect(ledger).toContain('".githooks/pre-push"');
  });

  it("复算本体只有一处实现 —— 钩子里不许长出第二套编排（§12.12）", () => {
    expect(hook).not.toMatch(/base-check|check-commit-claims|check-merged-side-loss/);
    expect(hook).toContain("premerge-proof.mjs");
  });
});

/**
 * 上游 sha 到底怎么取（现场：本检出一次真实 push，钩子报「取不到上游引用」退 2）。根因是引用名写死
 * `refs/remotes/origin/master`，而这份检出远端叫 `cnb` ⇒ 每次 topic push 都被判「没法复算」而拦下。
 * 另一面：远端名可变，「上游 = 要并进去的 master」不可变；`@{u}` 是自己跟自己比，会假过。
 */
describe("上游 sha 的取法：远端名不假定叫 origin，上游也不许是自己的分支", () => {
  const git = (args: Array<string>, cwd: string) => {
    const r = spawnSync(
      "git",
      [
        "-c",
        "user.name=tester",
        "-c",
        "user.email=tester@example.invalid",
        /* 宿主（开发机 / CI 容器）可能全局开着 `commit.gpgsign`，而临时仓库里
         * 没有可用密钥 —— 那会让 `git commit` 退 128，报错还指不到夹具。
         * 夹具**不许假定读者的 git 配置**（台账 R12-01，ISSUE #1817）：
         * 身份与签名策略都在这里就地钉死，不读全局。 */
        "-c",
        "commit.gpgsign=false",
        "-c",
        "tag.gpgsign=false",
        ...args,
      ],
      { cwd, encoding: "utf8" },
    );
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} 退 ${r.status}：${r.stderr}`);
    }
    return String(r.stdout).trim();
  };

  /**
   * 最小检出：`<tmp>/bare.git` 当远端（名字由调用方给）、`<tmp>/work` 是工作树，已推一条 `master` ⇒
   * 本地有 `refs/remotes/<remoteName>/master`，**没有 `origin`**。
   * @param {string} remoteName
   */
  function makeCheckout(remoteName: string) {
    const dir = mkdtempSync(path.join(tmpdir(), "comfy-premerge-upstream-"));
    const bare = path.join(dir, "bare.git");
    const work = path.join(dir, "work");
    mkdirSync(bare);
    mkdirSync(work);
    git(["init", "--bare", "--quiet", "--initial-branch=master", bare], dir);
    git(["init", "--quiet", "--initial-branch=master", work], dir);
    writeFileSync(path.join(work, "a.txt"), "1\n", "utf8");
    git(["add", "a.txt"], work);
    git(["commit", "--quiet", "-m", "base"], work);
    const baseSha = git(["rev-parse", "HEAD"], work);
    git(["remote", "add", remoteName, bare], work);
    git(["push", "--quiet", remoteName, "master"], work);
    return { dir, work, gitDir: path.join(work, ".git"), baseSha };
  }

  it("远端叫 cnb 时取到 cnb/master 的 sha（旧实现在这里恒 null ⇒ 每次 push 被退 2）", () => {
    const f = makeCheckout("cnb");
    try {
      // 前置：这份 fixture 里确实没有 origin —— 少了这一句，本条测不到「名字写死」那个前提
      const noOrigin = spawnSync(
        "git",
        ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/master"],
        { cwd: f.work },
      );
      expect(noOrigin.status).not.toBe(0);
      expect(readRevisions(f.gitDir, f.work)).toEqual({
        headSha: f.baseSha,
        upstreamSha: f.baseSha,
      });
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("`@{u}` 指向自己的分支时，上游仍是 master —— 不许自己跟自己比", () => {
    const f = makeCheckout("cnb");
    try {
      git(["checkout", "--quiet", "-b", "feat/x"], f.work);
      writeFileSync(path.join(f.work, "b.txt"), "2\n", "utf8");
      git(["add", "b.txt"], f.work);
      git(["commit", "--quiet", "-m", "on topic"], f.work);
      git(["push", "--quiet", "--set-upstream", "cnb", "feat/x"], f.work);
      // 前提成立：@{u} 已经是自己的分支，不是 master
      expect(git(["rev-parse", "--abbrev-ref", "@{u}"], f.work)).toBe("cnb/feat/x");
      const topicSha = git(["rev-parse", "HEAD"], f.work);
      const rev = readRevisions(f.gitDir, f.work);
      expect(rev.headSha).toBe(topicSha);
      expect(rev.upstreamSha).toBe(f.baseSha);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("只有本地 master、没有 remote 跟踪引用 ⇒ 取不到，判据读成「没法复算」而不是「没必要跑」", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "comfy-premerge-noremote-"));
    const work = path.join(dir, "work");
    mkdirSync(work);
    git(["init", "--quiet", "--initial-branch=master", work], dir);
    writeFileSync(path.join(work, "a.txt"), "1\n", "utf8");
    git(["add", "a.txt"], work);
    git(["commit", "--quiet", "-m", "base"], work);
    try {
      // 前提：本地 master 在场 —— 这一测的就是「base-check 那档本地兜底被这里刻意关掉」
      expect(git(["rev-parse", "--verify", "--quiet", "master"], work)).toBeTruthy();
      const rev = readRevisions(path.join(work, ".git"), work);
      expect(rev.upstreamSha).toBeNull();
      const verdict = decidePremergePush({
        candidates: mergeCandidates(parseRefLines(refLine())),
        headSha: rev.headSha,
        upstreamSha: rev.upstreamSha,
        proof: null,
      });
      expect(verdict.verdict).toBe("unavailable");
      expect(verdict.reasons[0]).toMatch(/^取不到/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * 目的地那一问（ISSUE #3025）：推向镜像/第三方远端时这批 ref 与「要不要合进本仓 master」无关 ——
 * 跳过复算，且不许把原因说成「没有要合进 master 的分支 ref」（那是行为，不是成因）。现场：平台检出
 * `git init` + 单 ref fetch，`refs/remotes/**` 为空 ⇒ 取不到上游 ⇒ 退 2 ⇒ 镜像格 push 被拦死。
 */
describe("push 的目的地不在本仓 remote 上 ⇒ 跳过复算（ISSUE #3025）", () => {
  it("URL 比对：命中本仓 remote（含 .git 后缀 / 尾斜杠 / 协议大小写差异）不算外来", () => {
    const known = ["https://cnb.cool/moon-read/comfy-app-t3.git"];
    expect(isForeignRemotePush("https://cnb.cool/moon-read/comfy-app-t3", known)).toBe(false);
    expect(isForeignRemotePush("HTTPS://cnb.cool/moon-read/comfy-app-t3.git/", known)).toBe(false);
    expect(isForeignRemotePush("https://cnb.cool/moon-read/comfy-app-t3.git/", known)).toBe(false);
  });

  it("镜像仓库的 URL 判成外来", () => {
    const known = ["https://cnb.cool/moon-read/comfy-app-t3.git"];
    expect(
      isForeignRemotePush("https://x-access-token:TOKEN@github.com/wuxianyuedu/comfy-app.git", known),
    ).toBe(true);
  });

  it("取不到 remote 清单 / 拿不到 push URL ⇒ 判「不是外来」（误判方向必须是多跑一次）", () => {
    expect(isForeignRemotePush("https://github.com/x/y.git", [])).toBe(false);
    expect(isForeignRemotePush(null, ["https://cnb.cool/moon-read/comfy-app-t3.git"])).toBe(false);
    expect(isForeignRemotePush("", ["https://cnb.cool/moon-read/comfy-app-t3.git"])).toBe(false);
  });

  it("外来的 push ⇒ skip 退 0，且理由念的是目的地、不是「没有分支」", () => {
    const candidates = mergeCandidates(parseRefLines(refLine()));
    const verdict = decidePremergePush({
      candidates,
      headSha: HEAD,
      /* 上游取不到正是平台检出形态下的读数 —— 外来远端这一判必须排在它前面。 */
      upstreamSha: null,
      proof: null,
      foreignPush: { url: "https://x-access-token:TOKEN@github.com/wuxianyuedu/comfy-app.git" },
    });
    expect(verdict.verdict).toBe("skip");
    expect(verdict.reasons[0]).toContain("github.com/wuxianyuedu/comfy-app");
    expect(verdict.reasons[0]).toContain("不在本仓任何 remote 上");
    const got = exitForNotRun(verdict, { proof: null, candidates, headSha: HEAD, upstreamSha: null });
    expect(got?.code).toBe(0);
  });

  it("本仓远端 + 上游取不到 ⇒ 仍是 unavailable 退 2（这一刀不许放宽）", () => {
    const candidates = mergeCandidates(parseRefLines(refLine()));
    const verdict = decidePremergePush({
      candidates,
      headSha: HEAD,
      upstreamSha: null,
      proof: null,
      foreignPush: null,
    });
    expect(verdict.verdict).toBe("unavailable");
    const got = exitForNotRun(verdict, { proof: null, candidates, headSha: HEAD, upstreamSha: null });
    expect(got?.code).toBe(2);
  });
});
