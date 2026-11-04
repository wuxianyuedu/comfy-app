/**
 * 「`test.todo` 的消费方在场」门禁自测（规范 §11.24）。价值全在**判定口径**上，故跑**真脚本**（临时仓库 + 只放被测文件）。该拦：有站点而台账空（`test.todo` 退出码 0、不进失败计数，门禁链只看退出码 ⇒ 零成本且没东西在读）；折行站点（prettier 折开 `it\n  .todo(` 仍要扫出来，只认行内字面量会整片静默漏出，§11.18.3.1 / §11.21）；台账缺 / 解析不了 / 形状不对（不许静默降级到「没有台账」，§11.18.3 首版 `include: []` 却退 0 同族）；`describe.todo`/`test.todo` 同族。
 * 该放：零站点（纯闸门）；有站点 + 台账在场（登记了「谁读、怎么读」才算有消费方）；夹具字符串 / 注释里的站点（判自己的夹具是 §11.18.3.1 记过的坑）；扫描期间文件消失（须数出来，见下面用例）。
 */
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect } from "vitest";
import { defineGateRepo, type GateRepo } from "./helpers/gate-repo";

/**
 * 临时仓库由**共享 fixture** 搭（`tests/helpers/gate-repo.ts`，§11.16.1）。⚠️ **每一格自己负责放台账**
 * —— 真实仓库里它必须在场（判据零站点时也读它）。先例：`annotate-consumer-gate` 的手抄夹具不带台账，
 * 而判据零站点时在读到台账之前就 return，于是「台账压根不存在」这条路径**全绿通过**。
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
  {
    consumers: [{ who: "scripts/xxx.mjs", how: "读 --reporter=json 的 numTodoTests" }],
  },
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
    expect(r.output).toContain("1 处 todo 站点");
    expect(r.output).toContain("1 条登记");
  });

  test("站点写在字符串 / 注释里 → 不算站点（判据不去判自己的夹具）", ({ repo }) => {
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
    repo.write("tests/a.test.ts", `${HEAD}describe("p", () => { it("x", () => {}); });\n`);
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

  test("折行站点（prettier 折开）也要被扫出来 —— 漏掉就是整片静默", ({ repo }) => {
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

/**
 * ⑧ 「列到名字、读时已没」这一支只能在进程内判：临时仓库 + 子进程造不出这个时刻（能造只能靠删文件的时机，那是概率窗口，判据不许长在上面）。
 * 现场与口径同 `tests/test-it-each-gate.test.ts` 的同名用例 —— `tests/global-setup-cleanup.test.ts` 会在 `tests/` 下临时造探针再删，两个 vitest 同跑时本扫描会撞上空档，于是 D 组带着一个 Node 栈崩掉。
 */
/* SAFETY: 类型断言已复核 */
const { readForScan } = createRequire(import.meta.url)("../scripts/check-test-todo.cjs") as {
  readForScan: (abs: string) => string | null;
};

describe("扫描期间文件消失（并发探针）", () => {
  test("读不到的文件返回 null，而不是把整个 D 组带崩", () => {
    const gone = path.resolve(__dirname, ".setup-cleanup-probe-0-0.test.tsx");
    expect(readForScan(gone)).toBeNull();
  });
});
