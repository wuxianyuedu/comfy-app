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
import { defineGateRepo, describe } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-bundle-budget.cjs",
  dirs: [".next/static/chunks"],
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

describe("check-bundle-budget.cjs（提交门槛，规范 §13.5.4）", () => {
  test("产物不存在时跳过并不报错（守的是构建结果，不是构建本身）", ({
    repo,
  }) => {
    repo.remove(".next/static/chunks");
    const { code, output } = repo.run();
    expect(code, output).toBe(0);
    expect(output).toContain("跳过");
  });

  test("测量面退化（文件数低于下限）判红 —— 一条恒绿的判据不许存在", ({
    repo,
  }) => {
    chunk(repo, "only.js", "/* one */\n");
    const { code, output } = repo.run();
    expect(code, output).toBe(1);
    expect(output).toContain("测量面退化");
  });

  test("基线缺失时判红（先 --update 落一份实测初值）", ({ repo }) => {
    seedChunks(repo);
    const { code, output } = repo.run();
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

    const ok = repo.run();
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
    const blocked = repo.run();
    expect(blocked.code, blocked.output).toBe(1);
    expect(blocked.output).toContain("gzip 总量上升");
  });

  test("新增 chunk 让文件数上升也判红（文件数比总量更敏感）", ({ repo }) => {
    seedChunks(repo);
    expect(repo.run(["--update"]).code).toBe(0);
    /* 保持字节总量不变、只加文件 —— 只有文件数那一档此刻会响。 */
    chunk(repo, "extra-one.js", "/* x */\n");
    const { code, output } = repo.run();
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

    const allowed = repo.run(["--update", "--allow-increase"]);
    expect(allowed.code, allowed.output).toBe(0);
    /* 认过账之后基线被抬高，检查放行。 */
    expect(repo.run().code).toBe(0);
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
    const checked = repo.run();
    expect(checked.code, checked.output).toBe(0);
    expect(checked.output).toContain("在预算内");

    /* 诊断：必须认出这是「同内容换名」，而不是「新增 1 个」。 */
    const report = repo.run(["--report"]);
    expect(report.code, report.output).toBe(0);
    expect(report.output).toContain("同内容换名");
    expect(report.output).not.toContain("新增内容");
  });

  test("跨环境/跨时间的改名不吃账：基线里存的是指纹，不是文件名", ({ repo }) => {
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

    const { code, output } = repo.run();
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
    const { code, output } = repo.run();
    expect(code, output).toBe(1);
    expect(output).toMatch(/\+\d+ B/);
    expect(output).not.toContain("+0.0 KB");
  });
});
