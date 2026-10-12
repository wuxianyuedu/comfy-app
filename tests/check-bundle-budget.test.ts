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
});
