/**
 * 「`task.meta` 的消费方在场」门禁自测（规范 §11.22）：跑**真脚本**断言「该拦的拦、不该误伤的放过」。
 * 关键口径：有站点但台账缺要拦（门禁链跑 vitest 没带 --reporter=json，写了没人读却像已登记）；折行站点仍要扫出，只认 `task.meta` 属性链以免误伤无关 meta。
 * 台账解析不了或**文件不在**也必须拦 —— 后者旧实现静默放行且从无执行者（零站点时先 return），全绿掩盖「台账压根不存在」（§11.23）。
 */
import { describe, expect } from "vitest";
import { defineGateRepo, type GateRepo } from "./helpers/gate-repo";

/**
 * 临时仓库由**共享 fixture** 搭（`tests/helpers/gate-repo.ts`，§11.16.1），取代本文件手抄的四件套
 * （mkdtemp / copyFileSync / execFileSync 归一 / 收尾 rm，§12.12 的字面孪生）。
 * ⚠️ **每一格自己负责放台账** —— 真实仓库里它必须在场。旧夹具不带台账，判据零站点时先 return，于是「台账压根不存在」这条路径全绿通过。
 */
const { test } = defineGateRepo({
  script: "check-task-meta-consumer.cjs",
  dirs: ["src", "tests"],
});

const HEAD = 'import { describe, expect, it } from "vitest";\n';

/** 一条往 task.meta 里写字段的用例（站点在第 4 行）。 */
const WITH_SITE = `${HEAD}describe("p", () => {
  it("x", (ctx) => {
    ctx.task.meta.tier = "artifact";
    expect(1).toBe(1);
  });
});
`;

const LEDGER = `${JSON.stringify(
  {
    consumers: [
      {
        who: "scripts/xxx.mjs",
        how: "带 --reporter=json --outputFile 跑后读 assertionResults[].meta",
      },
    ],
  },
  null,
  2,
)}
`;

const EMPTY_LEDGER = `${JSON.stringify({ consumers: [] }, null, 2)}\n`;

/**
 * 各格的公共动作：放台账 + 放被测用例。
 * 收成两个函数不是新的手搓样板：它们只做 fixture 的 `repo.write`，没有 mkdtemp / 收尾 / 子进程 ——
 * 那三样才是共享 fixture 要消掉的东西。
 */
/** 放台账（真实仓库里它必须在场）。 */
function putLedger(repo: GateRepo, content = EMPTY_LEDGER): void {
  repo.write("scripts/.task-meta-consumers.json", content);
}

describe("task.meta 消费方门禁：该放的形状（§11.22）", () => {
  test("零站点 → 通过（纯闸门，不是存量清理）", ({ repo }) => {
    repo.write("tests/a.test.ts", `${HEAD}describe("p", () => { it("x", () => {}); });\n`);
    putLedger(repo);
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("纯闸门");
    /* 通过的话术要点出台账在场 —— 「零站点」这个结论由「台账在、只是空」担保，
       不是由「台账根本没被读」担保（下面「台账文件根本不在」那格测的是后者）。 */
    expect(r.output).toContain("台账在场");
  });

  test("有站点 + 台账在场 → 通过（登记了「谁读、怎么读」）", ({ repo }) => {
    repo.write("tests/a.test.ts", WITH_SITE);
    putLedger(repo, LEDGER);
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("1 处 `task.meta` 站点");
    expect(r.output).toContain("1 条登记");
  });

  test("无关的 meta 用法不算站点（只认 `task.meta` 这条属性链）", ({ repo }) => {
    repo.write(
      "tests/a.test.ts",
      `${HEAD}export const META = { meta: { name: "x" } };\ndescribe("p", () => { it("x", () => { expect(Object.keys(META.meta)).toEqual(["name"]); }); });\n`,
    );
    putLedger(repo);
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("纯闸门");
  });

  test("站点写在字符串 / 注释里 → 不算站点（判据不去判自己的夹具）", ({ repo }) => {
    repo.write(
      "tests/a.test.ts",
      `${HEAD}export const FIXTURE = "ctx.task.meta.tier = 'artifact'";\n// ctx.task.meta.owner = "别线" 注释里的不算\ndescribe("p", () => { it("x", () => {}); });\n`,
    );
    putLedger(repo);
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("纯闸门");
  });
});

describe("task.meta 消费方门禁：该拦的形状（§11.22）", () => {
  test("有站点但台账为空 → 阻断，并点名文件与行号", ({ repo }) => {
    repo.write("tests/a.test.ts", WITH_SITE);
    putLedger(repo);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("tests/a.test.ts:4");
    expect(r.output).toContain("没有消费方");
  });

  /* 台账**文件不在**与台账**为空**是两件事，而只有前者是「判据宣称在守一条
     台账、台账压根不存在」。原先这一格不存在，于是那条路径从没被执行者走过 ——
     判据零站点时在读到台账之前就 return，全绿的却是「台账从没被创建过」。 */
  test("台账文件根本不在 → 阻断（零站点时也不许静默通过）", ({ repo }) => {
    repo.write("tests/a.test.ts", `${HEAD}describe("p", () => { it("x", () => {}); });\n`);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain(".task-meta-consumers.json 不存在");

    // 同样地，有站点时也必须是这一条（而不是「没有消费方」）—— 先把原因说对。
    repo.write("tests/a.test.ts", WITH_SITE);
    const r2 = repo.run();
    expect(r2.code).toBe(1);
    expect(r2.output).toContain(".task-meta-consumers.json 不存在");
  });

  test("折行站点（prettier 折开）也要被扫出来 —— 漏掉就是整片静默", ({ repo }) => {
    repo.write(
      "tests/a.test.ts",
      `${HEAD}describe("p", () => {\n  it("x", (ctx) => {\n    ctx\n      .task.meta.tier = "artifact";\n    expect(1).toBe(1);\n  });\n});\n`,
    );
    putLedger(repo);
    const r = repo.run();
    expect(r.code).toBe(1);
    // 站点在第 4 行（`ctx` 那一行，`.task.meta` 折在第 5 行）；
    // 只认行内字面量 `ctx.task.meta` 的扫描会整片漏掉它、报「纯闸门」而放行。
    expect(r.output).toContain("tests/a.test.ts:4");
  });

  test("台账解析不了 → 判据自己判失败（不许空转照样报 OK）", ({ repo }) => {
    repo.write("tests/a.test.ts", WITH_SITE);
    putLedger(repo, "{ not json }");
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("解析");
  });

  test("台账形状不对（consumers 不是数组）→ 同样判失败", ({ repo }) => {
    repo.write("tests/a.test.ts", WITH_SITE);
    putLedger(repo, '{ "consumers": "xxx" }');
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("不是数组");
  });
});
