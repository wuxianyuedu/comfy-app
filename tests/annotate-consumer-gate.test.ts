/**
 * 「`ctx.annotate` 的消费方在场」门禁自测（规范 §11.21）。
 *
 * 判据的价值全在**判定口径**上，所以这里跑的是**真脚本**（临时仓库 + 只放被测文件），
 * 断言「该拦的拦、不该误伤的放过」。每条口径都有执行者：
 *
 *   ① **零站点**（该放）：本判据是纯闸门，对象是「下一次有人挂注释」。
 *   ② **有站点 + 台账缺**（该拦）：挂一把没人读的注释比不写更坏 ——
 *      实测 `--reporter=json` 的产物里注释一个字都没有，唯一的读数通道是
 *      programmatic API，而门禁链跑 vitest 用的是 CLI spawn。
 *   ③ **有站点 + 台账在场**（该放）：登记了「谁读、怎么读」才算有消费方。
 *   ④ **折行站点**（该拦）：prettier 折开 `ctx\n  .annotate(` 之后仍要被扫出来
 *      （同 §11.18.3.1 那条：只认行内字面量会整片漏出扫描面，且漏得静默）。
 *   ⑤ **夹具字符串 / 注释里的站点**（该放）：本文件自己就写着夹具字符串，
 *      判据去判自己的夹具是 §11.18.3.1 记过的坑。
 *   ⑥ **台账解析不了**（该拦）：判据自己不许静默降级 —— 静默退回「没有台账」
 *      会让有站点时判据空转（§11.18.3 首版那个 `include: []` 却退 0 的 bug 同族）。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(
  __dirname,
  "../scripts/check-annotate-consumer.cjs",
);

/** 在临时仓库里跑真脚本（cwd = 临时仓库根，只放被测文件）。 */
function gate(files: Record<string, string>): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "annotate-consumer-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const entry = path.join(root, "scripts", path.basename(SCRIPT));
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [entry], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const HEAD = 'import { describe, expect, it } from "vitest";\n';

/** 一条挂着注解的用例（站点在第 4 行）。 */
const WITH_SITE = `${HEAD}describe("p", () => {
  it("x", async (ctx) => {
    await ctx.annotate("理由", "known-failed");
    expect(1).toBe(1);
  });
});
`;

const LEDGER = `${JSON.stringify(
  { consumers: [{ who: "scripts/xxx.mjs", how: "createVitest() 的 task.annotations()" }] },
  null,
  2,
)}
`;

describe("annotate 消费方门禁：该放的形状（§11.21）", () => {
  it("零站点 → 通过（纯闸门，不是存量清理）", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}describe("p", () => { it("x", () => {}); });\n`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("纯闸门");
  });

  it("有站点 + 台账在场 → 通过（登记了「谁读、怎么读」）", () => {
    const r = gate({
      "tests/a.test.ts": WITH_SITE,
      "scripts/.annotate-consumers.json": LEDGER,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("1 处注解站点");
    expect(r.output).toContain("1 条登记");
  });

  it("站点写在字符串 / 注释里 → 不算站点（判据不去判自己的夹具）", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}export const FIXTURE = 'await ctx.annotate("理由", "type")';\n// ctx.annotate("注释里的也不算")\ndescribe("p", () => { it("x", () => {}); });\n`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("纯闸门");
  });
});

describe("annotate 消费方门禁：该拦的形状（§11.21）", () => {
  it("有站点但台账缺 → 阻断，并点名文件与行号", () => {
    const r = gate({ "tests/a.test.ts": WITH_SITE });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("tests/a.test.ts:4");
    expect(r.output).toContain("没有消费方");
  });

  it("台账存在但 consumers 是空数组 → 同样阻断（空台账 ≠ 有消费方）", () => {
    const r = gate({
      "tests/a.test.ts": WITH_SITE,
      "scripts/.annotate-consumers.json": '{ "consumers": [] }\n',
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("没有消费方");
  });

  it("折行站点（prettier 折开）也要被扫出来 —— 漏掉就是整片静默", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}describe("p", () => {
  it("x", async (ctx) => {
    await ctx
      .annotate("理由", "type");
    expect(1).toBe(1);
  });
});
`,
    });
    expect(r.ok).toBe(false);
    // 站点在第 4 行（`ctx` 那一行，`.annotate(` 折在第 5 行）；
    // 只认行内字面量 `ctx.annotate(` 的扫描会整片漏掉它、报「纯闸门」而放行。
    expect(r.output).toContain("tests/a.test.ts:4");
  });

  it("台账解析不了 → 判据自己判失败（不许空转照样报 OK）", () => {
    const r = gate({
      "tests/a.test.ts": WITH_SITE,
      "scripts/.annotate-consumers.json": "{ not json }",
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("解析");
  });

  it("台账形状不对（consumers 不是数组）→ 同样判失败", () => {
    const r = gate({
      "tests/a.test.ts": WITH_SITE,
      "scripts/.annotate-consumers.json": '{ "consumers": "xxx" }',
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("不是数组");
  });
});
