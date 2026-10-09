/**
 * 「`test.todo` 的消费方在场」门禁自测（规范 §11.24）。
 *
 * 判据的价值全在**判定口径**上，所以这里跑的是**真脚本**（临时仓库 + 只放被测文件），
 * 断言「该拦的拦、不该误伤的放过」。每条口径都有执行者：
 *
 *   ① **零站点**（该放）：本判据是纯闸门，对象是「下一次有人留一条还没做的用例」。
 *   ② **有站点 + 台账空**（该拦）：`test.todo` 退出码 0、不进失败计数，
 *      而门禁链跑 vitest 只看退出码 —— 它零成本且没有东西在读它。
 *   ③ **有站点 + 台账在场**（该放）：登记了「谁读、怎么读」才算有消费方。
 *   ④ **折行站点**（该拦）：prettier 折开 `it\n  .todo(` 之后仍要被扫出来
 *      （同 §11.18.3.1 / §11.21 那条：只认行内字面量会整片漏出扫描面，且漏得静默）。
 *   ⑤ **夹具字符串 / 注释里的站点**（该放）：本文件自己就写着夹具字符串，
 *      判据去判自己的夹具是 §11.18.3.1 记过的坑。
 *   ⑥ **台账缺 / 解析不了 / 形状不对**（该拦）：判据自己不许静默降级 ——
 *      静默退回「没有台账」会让有站点时判据空转（§11.18.3 首版那个 `include: []`
 *      却退 0 的 bug 同族；§11.21 建判据时它真的发生过）。
 *   ⑦ `describe.todo` / `test.todo` 同族（该拦）：整块不跑的后果更重，不能只认 `it.todo`。
 */
import { describe, expect } from "vitest";
import { defineGateRepo, type GateRepo } from "./helpers/gate-repo";

/**
 * 临时仓库由**共享 fixture** 搭（`tests/helpers/gate-repo.ts`，§11.16.1）。
 *
 * ⚠️ **每一格自己负责放台账** —— 真实仓库里它必须在场（判据零站点时也读它）。
 * 同族先例：`annotate-consumer-gate` 的手抄夹具不带台账，而判据零站点时在读到
 * 台账之前就 return，于是「台账压根不存在」这条路径**全绿通过**。
 */
const { test } = defineGateRepo({
  script: "check-test-todo.cjs",
  dirs: ["src", "tests"],
});

const HEAD = 'import { describe, expect, it } from "vitest";\n';

/** 一条 `it.todo`（`HEAD` 占第 1 行，站点在第 3 行）。 */
const WITH_SITE = `${HEAD}describe("p", () => {
  it.todo("将来要做的事");
});
`;

const LEDGER = `${JSON.stringify(
  { consumers: [{ who: "scripts/xxx.mjs", how: "读 --reporter=json 的 numTodoTests" }] },
  null,
  2,
)}
`;

const EMPTY_LEDGER = `${JSON.stringify({ consumers: [] }, null, 2)}\n`;

/** 放台账（真实仓库里它必须在场）。 */
function putLedger(repo: GateRepo, content = EMPTY_LEDGER): void {
  repo.write("scripts/.test-todo-consumers.json", content);
}

describe("test.todo 消费方门禁：该放的形状（§11.24）", () => {
  test("零站点 → 通过（纯闸门，不是存量清理）", ({ repo }) => {
    repo.write(
      "tests/a.test.ts",
      `${HEAD}describe("p", () => { it("x", () => {}); });\n`,
    );
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
    expect(r.output).toContain("1 处 todo 站点");
    expect(r.output).toContain("1 条登记");
  });

  test("站点写在字符串 / 注释里 → 不算站点（判据不去判自己的夹具）", ({
    repo,
  }) => {
    repo.write(
      "tests/a.test.ts",
      `${HEAD}export const FIXTURE = 'it.todo("字符串里的不算")';\n// it.todo("注释里的也不算")\ndescribe("p", () => { it("x", () => {}); });\n`,
    );
    putLedger(repo);
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("纯闸门");
  });
});

describe("test.todo 消费方门禁：该拦的形状（§11.24）", () => {
  test("有站点但台账为空 → 阻断，并点名文件与行号", ({ repo }) => {
    repo.write("tests/a.test.ts", WITH_SITE);
    putLedger(repo);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("tests/a.test.ts:3");
    expect(r.output).toContain("没有消费方");
  });

  /* 台账**文件不在**与台账**为空**是两件事，而只有前者是「判据宣称在守一条
     台账、台账压根不存在」。 */
  test("台账文件根本不在 → 阻断（零站点时也不许静默通过）", ({ repo }) => {
    repo.write(
      "tests/a.test.ts",
      `${HEAD}describe("p", () => { it("x", () => {}); });\n`,
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain(".test-todo-consumers.json 不存在");

    // 同样地，有站点时也必须是这一条（而不是「没有消费方」）—— 先把原因说对。
    repo.write("tests/a.test.ts", WITH_SITE);
    const r2 = repo.run();
    expect(r2.code).toBe(1);
    expect(r2.output).toContain(".test-todo-consumers.json 不存在");
  });

  test("`describe.todo` / `test.todo` 同族 → 也要被扫出来", ({ repo }) => {
    repo.write(
      "tests/a.test.ts",
      `${HEAD}describe.todo("整块还没做", () => {\n  it("x", () => {});\n});\ntest.todo("另一条");\n`,
    );
    putLedger(repo);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("tests/a.test.ts:2");
    expect(r.output).toContain("tests/a.test.ts:5");
  });

  test("折行站点（prettier 折开）也要被扫出来 —— 漏掉就是整片静默", ({
    repo,
  }) => {
    repo.write(
      "tests/a.test.ts",
      `${HEAD}describe("p", () => {\n  it\n    .todo("将来要做的事");\n});\n`,
    );
    putLedger(repo);
    const r = repo.run();
    expect(r.code).toBe(1);
    // 站点在第 3 行（`it` 那一行，`.todo(` 折在第 4 行）；
    // 只认行内字面量 `it.todo(` 的扫描会整片漏掉它、报「纯闸门」而放行。
    expect(r.output).toContain("tests/a.test.ts:3");
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
