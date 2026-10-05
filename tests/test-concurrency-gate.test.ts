/**
 * 「并发档位用在哪儿」门禁自测（规范 §11.19）。
 *
 * 判据的价值全在**判定口径**上，所以这里跑的是**真脚本**（临时仓库 + 只放被测文件），
 * 断言「该拦的拦、不该误伤的放过」。每条口径都有执行者：
 *
 *   ① **并发 × `expect.poll`**（该拦）：实测两者互斥 —— 并发档里若同文件其它用例
 *      先让出事件循环，`expect.poll` 报 `must be called inside a test`（20/20 红），
 *      而把两条用例次序反转则 0/20 红。
 *   ② **并发但没有隔离声明**（该拦）：没有声明的并发文件等于「没人判断过这些用例
 *      之间有没有共享可变状态」。
 *   ③ **折行站点**（该拦）：prettier 把 `it.concurrent(\n  "…",\n  …)` 折开之后
 *      仍要被扫出来 —— 只认行内字面量会整片漏出扫描面（§11.18.3.1 那条的同族）。
 *   ④ **声明只写标签不写理由**（该拦）：`// 并发档：` 后面空着，与没有声明等价。
 *   ⑤ **字符串 / 注释里的站点**（该放）：本文件自己就写着夹具字符串，
 *      判据去判自己的夹具是 §11.18.3.1 记过的坑。
 *   ⑥ **只有串行用例的文件**（该放）：没有并发站点就不该被管。
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../scripts/check-test-concurrency.cjs");

/** 在临时仓库里跑真脚本（cwd = 临时仓库根，只放被测文件）。 */
function gate(files: Record<string, string>): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "test-concurrency-"));
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

describe("并发档门禁：该拦的形状（§11.19）", () => {
  it("并发站点 × expect.poll → 阻断，并点名两侧行号", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}describe("x", () => {
  it.concurrent("并发的一条", async () => {
    let n = 0;
    await new Promise((r) => setTimeout(r, 20));
    await expect.poll(() => n).toBe(1);
  });
});
`,
    });
    expect(r.ok).toBe(false);
    // 站点行（`it.concurrent` 在第 3 行）与 poll 行（第 6 行）都要点名
    expect(r.output).toContain("tests/a.test.ts:6");
    expect(r.output).toContain("第 3 行");
  });

  it("并发站点但没有隔离声明 → 阻断", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}describe("x", () => {
  it.concurrent("并发的一条", async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("没有任何隔离声明");
    expect(r.output).toContain("// 并发档：");
  });

  it("`.` 两侧折行的站点也要被扫出来（prettier 对超长链会这样折）", () => {
    /* ⚠️ 折行要折在 `it` 与 `.concurrent` **之间** —— 只把**参数**折开不算
     * （`it.concurrent(` 仍是行内字面量，认字面量的实现照样命中）。
     * 这条是变异核验照出来的：首版造的是「折参数」，于是「把站点正则改回
     * 行内字面量」那个变异**照样全绿**，即这一格没有执行者。 */
    const r = gate({
      "tests/a.test.ts": `${HEAD}describe("x", () => {
  it
    .concurrent("一条并发用例", async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("没有任何隔离声明");
  });

  it("声明只写标签不写理由 → 与没有声明等价，阻断", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}// 并发档：
describe("x", () => {
  it.concurrent("并发的一条", async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("没有任何隔离声明");
  });
});

describe("并发档门禁：不该误伤的形状（§11.19）", () => {
  it("只有串行用例的文件 → 放过（没有并发站点就不该被管）", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}describe("x", () => {
  it("串行的一条", async () => {
    let n = 0;
    await new Promise((r) => setTimeout(r, 20));
    await expect.poll(() => n).toBe(1);
  });
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("0 处并发站点");
  });

  it("并发 + poll + 声明齐全、但 poll 在**另一个**文件 → 放过", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}// 并发档：每条用例自建 runner，无模块级可变状态
describe("x", () => {
  it.concurrent("并发的一条", async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
});
`,
      "tests/b.test.ts": `${HEAD}describe("y", () => {
  it("串行的一条", async () => {
    let n = 0;
    await expect.poll(() => n).toBe(1);
  });
});
`,
    });
    expect(r.ok).toBe(true);
  });

  it("夹具字符串 / 注释里的站点不算站点（判据不去判自己的夹具）", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}// 这条注释里写着 it.concurrent( 与 expect.poll( 两个词
const FIXTURE = \`
  it.concurrent("夹具", async () => {
    await expect.poll(() => 1).toBe(1);
  });
\`;
describe("x", () => {
  it("串行的一条", () => {
    expect(FIXTURE).toContain("it.concurrent");
  });
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("0 处并发站点");
  });

  it("声明写在文件头、含理由 → 放过", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}// 并发档：全文件只用 createConsoleRunner() 自建实例，没有模块级状态
describe("x", () => {
  it.concurrent("并发的一条", async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("1 处并发站点");
  });
});

describe("字符串状态机：挖掉非代码区间（§11.19.4）", () => {
  /* 为什么**直接**钉这个纯函数、而不是「造个临时仓库跑一遍」：它的失效形态
   * （漏挖 → 判据去判自己的夹具）在整份文件上**不稳定复现** —— 同一个形状在
   * 「前面有没有别的代码」时会得到不同结果（实测：`${fn({ a: 1 }) ?? ""}` 单独出现时
   * 漏挖，前面接一段 import + 注释之后又掩对了）。而它是一个纯输入输出的函数，
   * 直接喂字符串才是能稳定钉住它的方式。
   *
   * 这一格是**提交门槛当场拦下来的**：自测 8 条全绿而钩子报红 ——
   * 判据本体错、自测没覆盖到，正是「判据在场 ≠ 判据在跑」的又一面。 */
  /* `createRequire` 而不是 `await import`：那个脚本是 CJS（`module.exports`），
   * 而 eslint 禁止裸 `require()`。两者的语义在这里一样（跑一次就拿到导出），
   * 取 `createRequire` 是因为它**同步** —— 不必让一条纯函数用例变成 async。 */
  const requireCjs = createRequire(import.meta.url);
  const { maskNonCode } = requireCjs(
    "../scripts/check-test-concurrency.cjs",
  ) as { maskNonCode: (src: string) => string };

  it("模板串的整体被挖掉（含里面的站点字样）", () => {
    const masked = maskNonCode(
      'const F = `it.concurrent("x", () => {});`;\nconst G = 1;',
    );
    expect(masked).not.toContain("concurrent");
    expect(masked).toContain("const G = 1;");
  });

  it("`${…}` 插值里的花括号与字符串不破坏弹栈（漏挖的根因）", () => {
    /* 触发形状要同时有：`{`（进深度计数，把插值层的 `}` 数对）+ 字符串字面量
     * （闭合后回哪个态是本格判据）。站点要落在**模板串还没闭合**的位置 ——
     * 模板闭合之后再写站点，漏挖与否本来就都会命中（那是判据该管的真站点）。 */
    const masked = maskNonCode(
      'const S = `pre ${fn({ a: 1 }) ?? ""} ' +
        'it.concurrent("漏出来的站点", () => {});`;\nconst T = 2;',
    );
    expect(masked, "插值没弹栈 —— 站点整片漏出扫描面").not.toContain(
      "concurrent",
    );
    expect(masked).toContain("const T = 2;");
  });

  it("嵌套模板串也要挖干净", () => {
    const masked = maskNonCode("const A = `x ${`y ${B} z`} w`;\nlet C = 1;");
    expect(masked).not.toContain("concurrent");
    expect(masked).not.toContain("y ");
    expect(masked).toContain("let C = 1;");
  });

  it("行注释与块注释里出现站点字样也不算", () => {
    const masked = maskNonCode(
      '// it.concurrent("x", () => {});\n/* expect.poll(() => 1) */\nlet D = 1;',
    );
    expect(masked).not.toContain("concurrent");
    expect(masked).not.toContain("poll");
    expect(masked).toContain("let D = 1;");
  });
});
