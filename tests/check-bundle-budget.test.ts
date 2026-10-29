/**
 * 提交门槛自检：把 scripts/check-bundle-budget.cjs 当黑盒跑在临时工作区上，
 * 验证「client chunk 体积预算」这条棘轮（规范 §13.5.4）真的会阻断、也不是空转。
 *
 * 规范：docs/standards/13-提交与-code-review.md §13.5.4（ISSUE #1781）
 *
 * 为什么用子进程跑：判据由 `pnpm build` 收尾与 `pnpm check:bundle` 以
 * `node scripts/xxx.cjs` 调用，且内部以 `__dirname/..` 定位 `.next/static/chunks`
 * —— 复用同一调用方式才等价于真实门禁。临时工作区与 `run` / `write` 由
 * `tests/helpers/gate-repo.ts` 提供。
 *
 * ## 口径的两条「失效形态都是绿」的位置（本条被测的重点）
 *
 * ISSUE #1781 的第二轮实测推翻了第一版口径：Turbopack 的 chunk 名是**内容哈希**，
 * 同环境连续两次构建（含 `rm -rf .next` 全冷）文件名与 sha256 **全部一致** ——
 * 所以「同内容换名」在本仓从未被观测到，而逐文件按 basename 对账的唯一效果是
 * **在基线过期时产出一串无法复核的行**（源码动过之后，旧名字既不在新产物里、
 * 又没有留下可对照的内容）。
 *
 * 于是口径改成：**判定只看 gzip 与文件数两个总量**，逐文件账降级为**诊断**
 * （按 `sha256` 对齐：指纹相同 = 同一份内容换了名，不计变化）。下面两条用例钉的
 * 正是这两个位置各自的失效形态 —— 它们**都不会报红**，只会安静地变成一条
 * 「看起来在守性能、实际在数文件名」的装饰：
 *
 * 1. 「同内容换名」被当成变化 ⇒ `--report` 的诊断里必须出现「同内容换名」、
 *    且**不能**出现「新增内容」；
 * 2. 「raw 涨、gzip 不涨」被判红 ⇒ 那是可压缩冗余、不是用户可感知的劣化。
 */
import { execFileSync } from "node:child_process";
import { defineGateRepo, describe, expectGateRan } from "./helpers/gate-repo";
import { expectActionableRefusal } from "./helpers/ratchet-refusal";

/**
 * 主夹具是**真 git 检出**（一次 seed 提交）。
 *
 * 判据的 `--update` 会拒绝在「取不到修订号」的工作区里写基线（ISSUE #1988），
 * 所以「落一份基线、检查放行」这条主路径必须先有一个 HEAD。需要「不是 git 检出」
 * 那一档的用例自己 `repo.remove(".git")` —— 常态与反常各自显式，而不是让常态
 * 靠一份取不到修订号的基线撑着。
 */
const { test, expect } = defineGateRepo({
  script: "check-bundle-budget.cjs",
  dirs: [".next/static/chunks"],
  setup: (repo) => {
    repo.git("init", "-q");
    repo.git("config", "commit.gpgsign", "false");
    repo.git("config", "user.email", "gate@example.com");
    repo.git("config", "user.name", "gate");
    repo.write("README.md", "seed\n");
    repo.git("add", "-A");
    repo.git("commit", "-qm", "seed");
  },
});

/**
 * 同一份判据、但工作区是**真 git 检出**（造提交历史用）。
 *
 * 为什么单开一个：`baselineRev` 那一档要问的是「基线之后源码动过几次」，
 * 而哈希与计数只在有历史的检出里存在 —— 主夹具是**只有一次 seed 提交**的真检出，
 * 造不出「其后有 N 次提交」那种形态。两档都得有人钉住（数不出来时说清是哪一档，
 * 数得出来时不许静默不说）。
 */
const { test: testWithGit } = defineGateRepo({
  script: "check-bundle-budget.cjs",
  dirs: [".next/static/chunks"],
  workdir: "bundle-budget-git",
  setup: (repo) => {
    repo.git("init", "-q");
    repo.git("config", "commit.gpgsign", "false");
    repo.git("config", "user.email", "gate@example.com");
    repo.git("config", "user.name", "gate");
    repo.write("README.md", "seed\n");
    repo.git("add", "-A");
    repo.git("commit", "-qm", "seed");
  },
});

/** 在临时工作区里造一个 chunk（`.js`），返回它的相对路径。 */
function chunk(
  repo: { write: (r: string, c: string) => void },
  name: string,
  body: string,
) {
  repo.write(`.next/static/chunks/${name}`, body);
}

/** 造够下限（20 个）的 chunk，避免撞上「测量面退化」那一档。 */
function seedChunks(
  repo: { write: (r: string, c: string) => void },
  extra = 0,
): void {
  for (let i = 0; i < 20 + extra; i++) {
    chunk(repo, `08${String(i).padStart(2, "0")}.js`, `/* chunk ${i} */\n`);
  }
}

/**
 * 「判据那一半」的用例统一走**硬档**（ISSUE #2634）。
 *
 * 2026-10-29 业主口径把两条总量判据（gzip / chunk 文件数）**开发期暂撤**了：默认档
 * 照量照打、不参与判定、退 0。于是这个文件里那些「涨了要红」的用例如果继续用默认档，
 * 断言的就不再是判据、而是撤档 —— 所以它们一律带 `--enforce-totals`。
 *
 * 为什么是加旗标而不是把 `TOTALS_ENFORCED` 改回 `true` 再测：旗标走的是**同一段判定代码**，
 * 于是「撤档」本身也拿到了一条反向对照（同一夹具、同一份读数，默认档退 0、硬档退 1）；
 * 而去改文件里的常量，测的是「改代码之后代码还在」，那种判据下一次一定漂。
 * 撤档那一半的行为单独开一个 describe 钉（见下面「开发期暂撤」那组）。
 */
const enforce = (args: string[] = []): string[] => ["--enforce-totals", ...args];

describe("check-bundle-budget.cjs（提交门槛，规范 §13.5.4）", () => {
  test("产物不存在时跳过并不报错（守的是构建结果，不是构建本身）", ({
    repo,
  }) => {
    repo.remove(".next/static/chunks");
    const { code, output } = repo.run(enforce());
    expect(code, output).toBe(0);
    expect(output).toContain("跳过");
  });

  test("测量面退化（文件数低于下限）判红 —— 一条恒绿的判据不许存在", ({
    repo,
  }) => {
    chunk(repo, "only.js", "/* one */\n");
    const { code, output } = repo.run(enforce());
    expect(code, output).toBe(1);
    expect(output).toContain("测量面退化");
  });

  test("基线缺失时判红（先 --update 落一份实测初值）", ({ repo }) => {
    seedChunks(repo);
    const { code, output } = repo.run(enforce());
    expect(code, output).toBe(1);
    expect(output).toContain("基线文件缺失");
  });

  test("--update 落基线后检查放行；把基线掏空（伪造更紧的预算）应变红 —— 判据不是空转", ({
    repo,
  }) => {
    seedChunks(repo);
    const seeded = repo.run(["--update"]);
    expect(seeded.code, seeded.output).toBe(0);
    expect(repo.exists("scripts/.bundle-budget-baseline.json")).toBe(true);

    const ok = repo.run(enforce());
    expect(ok.code, ok.output).toBe(0);
    expect(ok.output).toContain("在预算内");

    /* 伪造一个「更紧」的基线：判据必须看得见（探针灵敏度那一档的等价形态）。 */
    const baseline = JSON.parse(
      repo.read("scripts/.bundle-budget-baseline.json"),
    ) as { metric: { gzip: number } };
    baseline.metric.gzip -= 4096;
    repo.write(
      "scripts/.bundle-budget-baseline.json",
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    const blocked = repo.run(enforce());
    expect(blocked.code, blocked.output).toBe(1);
    expect(blocked.output).toContain("gzip 总量上升");
  });

  test("新增 chunk 让文件数上升也判红（文件数比总量更敏感）", ({ repo }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);
    /* 保持字节总量不变、只加文件 —— 只有文件数那一档此刻会响。 */
    chunk(repo, "extra-one.js", "/* x */\n");
    const { code, output } = repo.run(enforce());
    expect(code, output).toBe(1);
    expect(output).toContain("chunk 文件数上升");
  });

  test("--update 拒绝抬高基线，除非显式 --allow-increase（例外流程要有认账动作）", ({
    repo,
  }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);
    /* 加一个更大的 chunk：总量与文件数都涨。 */
    chunk(repo, "big-guy.js", "/* ".concat("x".repeat(9999), " */\n"));

    const refused = repo.run(["--update"]);
    expect(refused.code, refused.output).toBe(1);
    expect(refused.output).toContain("拒绝抬高基线");
    /* 这一家的自洽形态是「例外流程另给一个显式认账旗标」（`--allow-increase`）：
     * 判的是那句话有没有把人指到一个**认了账才敲得动**的动作上，而不是指回
     * 刚刚拒绝过它的 `--update`。 */
    expectActionableRefusal(refused.output, "check-bundle-budget.cjs");

    const allowed = repo.run(["--update", "--allow-increase"]);
    expect(allowed.code, allowed.output).toBe(0);
    /* 认过账之后基线被抬高，检查放行。 */
    expect(repo.run(enforce()).code).toBe(0);
  });

  /* ── 「该谁签」是这两句红话里承重的那一格（ISSUE #2149）─────────────────────
   *
   * 判红之后要走的是「有人认这笔」，而两个出口（判红那档的收尾、`--update` 拒涨那档）
   * 过去都写成「评审确认后」—— 那个抽象的签字者从来不存在，于是六天内四笔账
   * （#1988 / #2082 / #2132 / #2149）**没有一笔是造成它的 PR 认的**，全挂在主干上
   * 把后面四格的出勤一起挡掉（§13.5.21：其中两格的唯一执行者就在那条链上）。
   * 所以这里钉的是话术的**指向**：必须点名谁签、必须给出「这笔不是你的怎么办」。
   * 反向自证靠同一次输出里必然出现的正面短语（断言不是恒真 —— 两句都删掉就两头红）。
   */
  test("认账那句点名「谁签」并给出「不是你的账就立案」（两处出口都不许写「评审确认后」）", ({
    repo,
  }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);
    /* 只把已有的一个 chunk 变大：文件数不变，落进「gzip 总量上升」那一档。 */
    chunk(repo, "0800.js", `/* ${"g".repeat(20000)} */\n`);

    const blocked = repo.run(enforce());
    expect(blocked.code, blocked.output).toBe(1);
    expect(blocked.output).toContain("谁把这批客户端字节带进来的谁签");
    expect(blocked.output).toContain("这不是你的账");
    expect(blocked.output).not.toContain("评审确认后");

    const refused = repo.run(["--update"]);
    expect(refused.code, refused.output).toBe(1);
    expect(refused.output).toContain("造成它的那条 PR");
    expect(refused.output).not.toContain("评审确认后");
  });

  test("--report 只出清单、不判失败（盘点用）", ({ repo }) => {
    seedChunks(repo);
    const { code, output } = repo.run(["--report"]);
    expect(code, output).toBe(0);
    expect(output).toContain("只出清单");
  });

  /* ── 下面四条钉的是「换口径之后，判据还在判它该判的东西」──────────────── */

  test("逐文件账按内容指纹对齐：同内容换名不计变化（诊断里点名、不当新增）", ({
    repo,
  }) => {
    /* 先把「要改名的那个」放进去、再落基线 —— 一次落定。
     * 分两步会撞上拒涨机制（新增文件让文件数上升，`--update` 按设计拒绝），
     * 那一刻红的是「拒涨」那一档、与本条要钉的口径无关。 */
    seedChunks(repo);
    const body = "/* ".concat("y".repeat(3000), " */\n");
    chunk(repo, "aa-original.js", body);
    expect(repo.run(["--update", "--allow-increase"]).code).toBe(0);

    repo.remove(".next/static/chunks/aa-original.js");
    chunk(repo, "zz-renamed.js", body);

    /* 判定：总量一个字节没变 ⇒ 绿。这是口径的核心（名字不是身份）。 */
    const checked = repo.run(enforce());
    expect(checked.code, checked.output).toBe(0);
    expect(checked.output).toContain("在预算内");

    /* 诊断：必须认出这是「同内容换名」，而不是「新增 1 个」。 */
    const report = repo.run(["--report"]);
    expect(report.code, report.output).toBe(0);
    expect(report.output).toContain("同内容换名");
    expect(report.output).not.toContain("新增内容");
  });

  test("老块内容小改会换哈希：诊断必须并排给出「消失」与净差，不许只报新增（ISSUE #2141）", ({
    repo,
  }) => {
    /* 现场形状：一笔改动让某个块涨几十字节 ⇒ Turbopack 给它换名，逐文件账里
     * 「新增 1 / 消失 1」是同**一块**的两面。只报「新增内容 30.6 KB」时，
     * 44 B 的小改在屏幕上长得像新增了 30 KB —— 那正是这一条要挡的读法。 */
    seedChunks(repo);
    const before = "/* ".concat("m".repeat(4000), " */\n");
    chunk(repo, "aa-old-name.js", before);
    expect(repo.run(["--update", "--allow-increase"]).code).toBe(0);

    const after = "/* ".concat("m".repeat(4000), " */X\n");
    repo.remove(".next/static/chunks/aa-old-name.js");
    chunk(repo, "bb-new-name.js", after);

    const { code, output } = repo.run(["--report"]);
    expect(code, output).toBe(0);
    /* 三面都要在：新增、配对消失、并排净差。缺任何一面，这句就又只剩吓人的那一半。 */
    expect(output).toContain("新增内容 1 个");
    expect(output).toContain("同时消失 1 个");
    expect(output).toMatch(/并排净差 \+\d+ B/);
    /* 而且它不许把「净差是几十字节」这件事藏起来：同一份输出里总量那一档也在（诊断与判定同屏）。 */
    expect(output).not.toMatch(/新增内容 \d+ 个[^\n]*最大的/);
  });

  test("只有消失（块变小到没有配对）也要说一句净差，不许静默", ({ repo }) => {
    seedChunks(repo);
    const big = "/* ".concat("z".repeat(4000), " */\n");
    chunk(repo, "aa-shrink.js", big);
    expect(repo.run(["--update", "--allow-increase"]).code).toBe(0);

    /* 换成一个更小的同内容块：名字变了、内容也变了 ⇒ 账上是「新增 1 + 消失 1」，
     * 但净差是**负的** —— 变小不判红，可它同样要能被读到。 */
    repo.remove(".next/static/chunks/aa-shrink.js");
    chunk(repo, "bb-smaller.js", "/* z */\n");
    const { code, output } = repo.run(["--report"]);
    expect(code, output).toBe(0);
    expect(output).toMatch(/并排净差 -\d+ B/);
  });

  test("跨环境/跨时间的改名不吃账：基线里存的是指纹，不是文件名", ({
    repo,
  }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);

    const baseline = JSON.parse(
      repo.read("scripts/.bundle-budget-baseline.json"),
    ) as { entries: Array<{ name: string; sha: string }> };
    /* 基线必须**带指纹**（诊断才可能对齐）—— 这一条钉的是「别退回只存名字」。 */
    expect(Array.isArray(baseline.entries)).toBe(true);
    expect(baseline.entries.length).toBe(20);
    expect(baseline.entries[0]!.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  test("raw 不参与判定：把基线 raw 压到 1 字节仍放行（gzip 才是用户要下载的）", ({
    repo,
  }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);

    /* 直接篡改基线里的 raw —— 若 raw 参与判定，此时必然报「raw 总量上升」。
     * 这一档是**契约**不是巧合：raw 是磁盘/内存形态，gzip 才是下载量，
     * 两者会分叉（可压缩冗余），拿 raw 判红只会制造误报。 */
    const baseline = JSON.parse(
      repo.read("scripts/.bundle-budget-baseline.json"),
    ) as { metric: { raw: number } };
    baseline.metric.raw = 1;
    repo.write(
      "scripts/.bundle-budget-baseline.json",
      `${JSON.stringify(baseline, null, 2)}\n`,
    );

    const { code, output } = repo.run(enforce());
    expect(code, output).toBe(0);
    expect(output).toContain("在预算内");
    expect(output).not.toContain("raw 总量上升");
  });

  test("增量小到不足 1 KB 时输出补字节数（不许把判红理由显示成 +0.0 KB）", ({
    repo,
  }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);

    /* 往一个已有 chunk 末尾追加随机字节：gzip 增量是正数、但远小于 1 KB
     * （随机内容不可压、增量≈raw 增量），KB 取整会把它打成 +0.0 ——
     * 而那正是判红理由本身，不许显示成零。 */
    chunk(
      repo,
      "0800.js",
      `/* ${Array.from({ length: 400 }, (_, i) => (i * 7919) % 256).join(",")} */\n`,
    );
    const { code, output } = repo.run(enforce());
    expect(code, output).toBe(1);
    expect(output).toMatch(/\+\d+ B/);
    expect(output).not.toContain("+0.0 KB");
  });

  /* ── 「基线过期」必须被说出来（ISSUE #1781 的现场）───────────────────── */

  test("--update 在非 git 检出里拒绝写基线（不许把 baselineRev 写成 null）", ({
    repo,
  }) => {
    /* 常态夹具已经 `git init` 过（`--update` 要真 HEAD 才肯写），这里把 .git 摘掉
     * 造出「不是 git 检出」那一档 —— 与 `merged-side-loss-gate` 同一手法。 */
    repo.remove(".git");
    seedChunks(repo);
    /* 主夹具不是 git 检出 ⇒ `headRev()` 取不到修订号。此时写出来的基线会带着
     * `baselineRev: null`：判据照旧跑、照旧绿，但判红时那句归因**永久失效**
     * （ISSUE #1988 的现场 —— master 上就躺着这样一份基线，此后每一跑都只报
     * 「基线修订号：取不到」）。失效形态是静默的，所以这里钉住它的反面：
     * 写不下去就当场拒绝，而不是安静地落一份掏空了的账。 */
    const { code, output } = repo.run(["--update"]);
    expect(code, output).toBe(1);
    expect(output).toContain("拒绝写入基线");
    expect(output).toContain("baselineRev");
    /* 一个字都没落盘 —— 拒绝不能是「先写再喊」。 */
    expect(repo.exists("scripts/.bundle-budget-baseline.json")).toBe(false);
  });

  test("基线里的修订号在本检出里不可达时，判红说清「基线过期」而不是「取不到」", ({
    repo,
  }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);

    /* 把 `baselineRev` 换成一个**形状对、本检出里不存在**的修订号 —— 这正是
     * ISSUE #1988 的现场：master 那份基线记的是 `b6c3c353`，而那个提交在检出里
     * 根本不存在（分支合入 + `git gc` 之后的老形态）。 */
    const baseline = JSON.parse(
      repo.read("scripts/.bundle-budget-baseline.json"),
    ) as { baselineRev?: string };
    baseline.baselineRev = "b6c3c353bcfb3c4109f5ceebeaac629731ad221b";
    repo.write(
      "scripts/.bundle-budget-baseline.json",
      `${JSON.stringify(baseline, null, 2)}\n`,
    );

    chunk(repo, "0800.js", `/* ${"z".repeat(4096)} */\n`);
    const { code, output } = repo.run(enforce());
    expect(code, output).toBe(1);
    /* 两档不许混成一句（§12.13.3 留给下一个按行数记账的棘轮的第二条）：
     * 「没记」的下一步是重记；「记了但不可达」的下一步是**先分清该不该认账**
     * 再重记 —— 混成一句「取不到，或重跑一次 --update」会把人直接推向后者。 */
    expect(output).toContain("在本检出里不可达");
    expect(output).toContain("基线过期");
    expect(output).toContain("别直接 --update 重记");
    expect(output).not.toContain("基线修订号：取不到");
  });

  test("旧格式基线（没有 baselineRev）判红仍说清取不到（不拿猜测顶替）", ({
    repo,
  }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);

    const baseline = JSON.parse(
      repo.read("scripts/.bundle-budget-baseline.json"),
    ) as { baselineRev?: string };
    delete baseline.baselineRev;
    repo.write(
      "scripts/.bundle-budget-baseline.json",
      `${JSON.stringify(baseline, null, 2)}\n`,
    );

    /* 造一次真实上涨：往一个已有 chunk 追加不可压内容。 */
    chunk(repo, "0800.js", `/* ${"z".repeat(4096)} */\n`);

    const { code, output } = repo.run(enforce());
    expect(code, output).toBe(1);
    /* 与上一条互为反面：这一档是「压根没记」，所以下一步才是「重跑一次 --update」。 */
    expect(output).toContain("基线修订号：取不到");
    expect(output).toContain("无法判断");
    expect(output).not.toContain("不可达");
  });
});

/**
 * 开发期暂撤那一档（ISSUE #2634，2026-10-29 业主口径）。
 *
 * 这组用例**只有撤档态存在**：把 `TOTALS_ENFORCED` 改回 `true` 的那一天，它们会全部红 ——
 * 那是设计的一部分，红话会指着这里，恢复的人必须**带着读数决定**删掉这一组还是留着
 * （留着的话，第一条断言就得翻成「默认档也判」）。所以这里刻意不断言「常量是 false」
 * 那种写法（那会把一次口径变更焊成长期判据），断言的是**默认档今天的行为**。
 */
describe("check-bundle-budget.cjs（开发期暂撤两条总量判据，ISSUE #2634）", () => {
  /** 造一份「超出基线」的现场：先按默认档落基线，再往 gzip 与文件数两边都加。 */
  const growBeyondBaseline = (repo: {
    run: (a?: string[]) => { code: number; output: string };
    write: (r: string, c: string) => void;
  }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);
    /* 新增一个 chunk（文件数 +1）且让内容比基线里任何一块都大（gzip 总量上升）——
     * 两条被暂撤的判据**同时**命中，正是 #2634 现场那种形态。 */
    chunk(repo, "99-growth.js", `/* ${"x".repeat(40000)} */\n`);
  };

  test("默认档：同一份超限读数退 0，判决行走 **stdout** 明写今天没判", ({ repo }) => {
    growBeyondBaseline(repo);
    const r = repo.run();
    /* 先判「真的跑到判据脚本」再判退 0：撤档这一档的 `code === 0` 与「脚本没起来」
     * 在读数上同形（夹具的 `code` 在取不到状态时兜 1，但 spawn 失败也可能是 0 长度输出），
     * 而这一格的全部价值就是「它跑了，并且说出自己没判」。 */
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    /* 撤档的**判决句**必须落在 stdout：退 0 的判据在很多消费者那里只转述 stdout
     * （`quality-gate.mjs` 的绿档、以及本夹具自己 —— `output` 在非 0 时才合并两条流，
     * 这是全仓门禁自测的形状，不为一格改它）。写在 stderr 的话，「今天没判」会被
     * 读成「它绿了，所以没东西可看」—— 那正是硬规则 27 禁止的「只转述自己的 stdout」。 */
    expect(r.raw.stdout).toContain("没判");
    expect(r.raw.stdout).toContain("#2634");
    /* 恢复条件与自查口也在 stdout，不靠人记得。 */
    expect(r.raw.stdout).toContain("TOTALS_ENFORCED");
    expect(r.raw.stdout).toContain("--enforce-totals");
    /* 「不许被读成通过」是这一档的全部价值（§13.5.25 那条「降档永远要被念出来」）。
     * 判的是**那条 ✓ 原文**没出现 —— 不能拿「在预算内」这个子串当判点，撤档那句话里
     * 恰好写着「这不是『已在预算内』」，按子串判会把自己也判红。 */
    expect(r.raw.stdout + r.raw.stderr).not.toContain("✓ 在预算内");
    /* 读数还得在（撤的是执行，不是量具）：将来签账的人拿到的仍是同一份现场。 */
    const both = r.raw.stdout + r.raw.stderr;
    expect(both).toContain("gzip 总量上升");
    expect(both).toContain("chunk 文件数上升");
    expect(both).toContain("不参与判定");
  });

  test("反向对照：同一份读数带 `--enforce-totals` 退 1 —— 撤的是执行，判据没被删", ({
    repo,
  }) => {
    growBeyondBaseline(repo);
    const { code, output } = repo.run(enforce());
    expect(code, output).toBe(1);
    expect(output).toContain("违规（阻断）");
    expect(output).not.toContain("没判");
  });

  test("暂撤不许顺手改基线：默认档跑完，基线文件逐字不变（棘轮仍在原地等恢复）", ({
    repo,
  }) => {
    growBeyondBaseline(repo);
    const before = repo.read("scripts/.bundle-budget-baseline.json");
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    /* 「边涨边重记基线」会把这次暂撤变成**永久**豁免 —— 恢复那天就没有对照物了。
     * 这条断言守的就是那一条：默认档一次运行不得动基线一个字节。 */
    expect(repo.read("scripts/.bundle-budget-baseline.json")).toBe(before);
  });

  test("--update 的拒涨棘轮一条没动（暂撤不延伸到基线那一本账）", ({ repo }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);
    chunk(repo, "99-growth.js", `/* ${"y".repeat(40000)} */\n`);
    /* 抬高基线仍要显式 `--allow-increase` —— 这一档与总量判据无关，撤档不该顺手放开它。 */
    const refused = repo.run(["--update"]);
    expect(refused.code, refused.output).toBe(1);
    expect(refused.output).toContain("拒绝抬高基线");
  });
});

describe("check-bundle-budget.cjs（基线过期要有归因，规范 §13.5.4 / §12.13.3）", () => {
  testWithGit(
    "基线之后有提交时，判红输出点名「其后有 N 次提交」",
    ({ repo }) => {
      seedChunks(repo);
      expect(repo.run(["--update"]).code).toBe(0);

      /* 基线落在 seed 那次提交上；再往前走一次提交，制造「基线之后源码动过」。 */
      repo.write("touch.txt", "later\n");
      repo.git("add", "-A");
      repo.git("commit", "-qm", "later");

      chunk(repo, "0800.js", `/* ${"z".repeat(4096)} */\n`);
      const { code, output } = repo.run(enforce());
      expect(code, output).toBe(1);
      /* 归因必须在**判红那一刻**说，而不是留给读者去 `git log` 基线日期：
       * 「涨了这点体积是不是那几次改动换来的」正是决定压回去 / 认账的那一步。 */
      expect(output).toContain("其后本检出上有 1 次提交");
      expect(output).toContain("基线之后的源码");
    },
  );

  testWithGit("基线就是 HEAD 时，说清上涨来自未提交的改动", ({ repo }) => {
    /* 造「基线记的就是 HEAD」那一档：先提交一次、让 `--update` 把基线落在这次提交上，
     * 之后**不再提交** —— 上涨只发生在工作区（§12.13.3：数不出来时不许拿猜顶替，
     * 而这一档是数得出来的那种「取自未提交的改动」）。 */
    seedChunks(repo);
    repo.git("add", "-A");
    repo.commit("artifacts");
    expect(repo.run(["--update"]).code).toBe(0);

    chunk(repo, "0800.js", `/* ${"z".repeat(4096)} */\n`);
    const { code, output } = repo.run(enforce());
    expect(code, output).toBe(1);
    expect(output).toContain("就是本检出的 HEAD");
    expect(output).toContain("未提交的改动");
  });

  /**
   * 合并提交那一档（§13.5.4 / §11.23.6）。
   *
   * `baselineRev` 恰是 HEAD 这件事**在合并里没有解释力**：HEAD 是两侧祖先里都没有的
   * 提交，索引里那份基线是「合并前某一侧」的读数，而产物是合并后源码的输出 —— 两者
   * 本就不可比。守住的是输出不许滑向「上涨来自未提交的改动」那句：它有依据的样子，
   * 实际是把「量不出」说成了一句结论。
   */
  testWithGit(
    "合并提交上基线恰是 HEAD 时不冒充「未提交的改动」",
    ({ repo }) => {
      seedChunks(repo);
      expect(repo.run(["--update"]).code).toBe(0);

      /* 造一个真合并：侧枝上改一个与产物无关的文件，主线上再追加一次提交，
       * 然后 `--no-ff` 合进来 —— HEAD 于是有两个父。 */
      repo.git("checkout", "-q", "-b", "side");
      repo.write("side.txt", "side\n");
      repo.git("add", "-A");
      repo.git("commit", "-qm", "side");
      repo.git("checkout", "-q", "-");
      repo.write("main.txt", "main\n");
      repo.git("add", "-A");
      repo.git("commit", "-qm", "main");
      repo.git("merge", "-q", "--no-ff", "--no-edit", "side");

      /* 合并后把基线改成「就记 HEAD」：这正是解冲突时取一侧/重记的形态。 */
      const baseline = JSON.parse(
        repo.read("scripts/.bundle-budget-baseline.json"),
      ) as Record<string, unknown>;
      /* 夹具的 `git()` 不回显 stdout，所以经过一次读文件 + 一次写回把修订号换成 HEAD。 */
      baseline.baselineRev = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo.dir,
        encoding: "utf8",
      }).trim();
      repo.write(
        "scripts/.bundle-budget-baseline.json",
        `${JSON.stringify(baseline, null, 2)}\n`,
      );

      chunk(repo, "0800.js", `/* ${"z".repeat(4096)} */\n`);
      const { code, output } = repo.run(enforce());
      expect(code, output).toBe(1);
      expect(output).toContain("HEAD 是合并提交");
      expect(output).toContain("合并后的完整产物链");
      expect(output).not.toContain("未提交的改动");
    },
  );

  /**
   * 「记了但不可达」那一档的**第二归因通道**（ISSUE #2082）。
   *
   * 旧形态在这一档只说一句「无法判断这批读数与基线之间源码动过几次」，然后把下一步
   * 推回「先分清这点体积该不该认」—— 而那一步需要的正是它刚说拿不到的东西。
   * 本仓 PR 走 squash 合并，`baselineRev` 记的分支提交在合入后不再有 ref 指向，
   * 所以**每一次判红都必然落到这一档**（master 上那份 `0a618c1c` 就是这么来的）。
   * 这几条用例各钉一个方向：数得出来必须报数、数出来是零必须说清「不是那之后的源码」，
   * 连日期都不可信时**不许冒充有归因**；以及 `--update` 落的锚点必须是主干可达的那一枚。
   */
  testWithGit(
    "基线修订号不可达时改按 generatedAt 归因，并把那几笔提交带出来",
    ({ repo }) => {
      seedChunks(repo);
      expect(repo.run(["--update"]).code).toBe(0);
      /* 基线之后追加一次**真动过 src/** 的提交 —— 归因通道读的就是这个面。 */
      repo.write("src/a.ts", "export const a = 1;\n");
      repo.git("add", "-A");
      repo.git("commit", "-qm", "feat: 往客户端加一个模块");
      const baseline = JSON.parse(
        repo.read("scripts/.bundle-budget-baseline.json"),
      ) as Record<string, unknown>;
      // 形状合法、本检出里不存在：squash 合入 + gc 之后的老形态。
      baseline.baselineRev = "b6c3c353bcfb3c4109f5ceebeaac629731ad221b";
      repo.write(
        "scripts/.bundle-budget-baseline.json",
        `${JSON.stringify(baseline, null, 2)}\n`,
      );

      chunk(repo, "0800.js", `/* ${"z".repeat(4096)} */\n`);
      const { code, output } = repo.run(enforce());
      expect(code, output).toBe(1);
      expect(output).toContain("改按基线日期");
      expect(output).toContain("1 次主干提交");
      expect(output).toContain("feat: 往客户端加一个模块");
      // 旧那句「无法判断」不许再出现 —— 它把动作推回原地，而这里有数可给。
      expect(output).not.toContain("无法判断这批读数与基线之间源码动过几次");
    },
  );

  testWithGit(
    "src/ 侧其后一次提交都没有时，把「0」当结论说出来而不是退化成量不到",
    ({ repo }) => {
      seedChunks(repo);
      expect(repo.run(["--update"]).code).toBe(0);
      const baseline = JSON.parse(
        repo.read("scripts/.bundle-budget-baseline.json"),
      ) as Record<string, unknown>;
      baseline.baselineRev = "b6c3c353bcfb3c4109f5ceebeaac629731ad221b";
      repo.write(
        "scripts/.bundle-budget-baseline.json",
        `${JSON.stringify(baseline, null, 2)}\n`,
      );
      chunk(repo, "0800.js", `/* ${"z".repeat(4096)} */\n`);
      const { code, output } = repo.run(enforce());
      expect(code, output).toBe(1);
      // 这条夹具的历史里只有 seed 与那次 --update 之前的提交，都没动 src/ ⇒ 数得出来，是 0。
      expect(output).toContain("0 次主干提交");
      expect(output).toContain("src/ 侧其后一次提交都没有");
    },
  );

  test("基线日期也不可信时不许冒充有归因（说「判断不了」而不是编一个数）", ({
    repo,
  }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);
    const baseline = JSON.parse(
      repo.read("scripts/.bundle-budget-baseline.json"),
    ) as Record<string, unknown>;
    baseline.baselineRev = "b6c3c353bcfb3c4109f5ceebeaac629731ad221b";
    delete baseline.generatedAt; // 第二通道唯一的输入没了 ⇒ 必须明说量不到
    repo.write(
      "scripts/.bundle-budget-baseline.json",
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    chunk(repo, "0800.js", `/* ${"z".repeat(4096)} */\n`);
    const { code, output } = repo.run(enforce());
    expect(code, output).toBe(1);
    expect(output).toContain("基线日期那条也量不到");
    expect(output).toContain("判断不了");
    expect(output).not.toContain("次主干提交");
  });

  testWithGit(
    "--update 落的锚点是主干可达的那一枚，不是会随 squash 消失的 HEAD",
    ({ repo }) => {
      // 把当前（seed）提交冒充成主干位置：`origin/master` 指在它上。
      const trunk = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo.dir,
        encoding: "utf8",
      }).trim();
      repo.git("update-ref", "refs/remotes/origin/master", trunk);
      // 分支上再走一步 —— HEAD 从此是「合入后没有 ref 指向它」的那一类。
      repo.write("src/a.ts", "export const a = 1;\n");
      repo.git("add", "-A");
      repo.git("commit", "-qm", "feat: 分支上的一笔");
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo.dir,
        encoding: "utf8",
      }).trim();

      seedChunks(repo);
      const seeded = repo.run(["--update"]);
      expect(seeded.code, seeded.output).toBe(0);
      expect(seeded.output).toContain("取的是主干可达的那一枚");
      const baseline = JSON.parse(
        repo.read("scripts/.bundle-budget-baseline.json"),
      ) as { baselineRev?: string };
      expect(
        baseline.baselineRev,
        "锚点记成了分支提交 —— 那正是 #2082 的病根",
      ).toBe(trunk);
      expect(baseline.baselineRev).not.toBe(head);
    },
  );

  test("问不到主干时退回 HEAD，并把「这一枚多半不可达」打在脸上", ({
    repo,
  }) => {
    seedChunks(repo);
    const seeded = repo.run(["--update"]);
    expect(seeded.code, seeded.output).toBe(0);
    expect(seeded.output).toContain("退回 HEAD");
    expect(seeded.output).toContain("第二归因");
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo.dir,
      encoding: "utf8",
    }).trim();
    const baseline = JSON.parse(
      repo.read("scripts/.bundle-budget-baseline.json"),
    ) as { baselineRev?: string };
    expect(baseline.baselineRev).toBe(head);
  });
});
