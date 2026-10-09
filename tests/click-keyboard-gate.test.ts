/**
 * 「鼠标点得开、键盘点不开」门禁自测（规范 06 §6.11）。
 *
 * 本文件自己**不进扫描面**（`scripts/check-click-keyboard.cjs` 的
 * `FIXTURE_SKIP`）：下面的被测字符串里有真的站点，判它等于判自己的量具
 * （§11.14.2 的通用口径，同 `tests/form-field-wiring-gate.test.ts`）。
 *
 * 逐条钉判定口径：
 *   ① 非原生元素 + `onClick` + 无键 → 站点，该拦
 *   ② 原生标签 / 首字母大写的组件 → 放行（键语义在别处）
 *   ③ 元素上有 `onKeyDown` 或 `{...simpleKeyHandler(...)}` → 放行
 *   ④ **其他展开不算覆盖**（`{...props}` / `{...hoverEvents}`）→ 仍算站点
 *   ⑤ 拖放容器（`onDrop` / `onDragOver` 同元素）→ 放行
 *   ⑥ `onClick` 体里只有 `stopPropagation` / `preventDefault` → 放行（守卫）
 *   ⑦ 棘轮：不超过基线就放行
 *   ⑧ `--update` 拒绝把基线往上涨
 */
import { join } from "node:path";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-click-keyboard.cjs",
  dirs: ["src"],
  /* 判据走 TS AST，要能解析 typescript —— 临时工作区旁边没有 node_modules，
   * 靠 NODE_PATH 指回源码仓库（脚本真的依赖这个输入，不是顺手给的口子）。 */
  env: { NODE_PATH: join(process.cwd(), "node_modules") },
});

/** 在 `src/` 下写一个文件（判据只扫视图层）。 */
function write(repo: GateRepo, body: string): void {
  repo.write(join("src", "a.tsx"), body);
}

/** 预置棘轮基线（不传则不写基线文件 = 起点 0 处）。 */
function setBaseline(
  repo: GateRepo,
  total: number,
  files: Record<string, number> = {},
): void {
  repo.write(
    join("scripts", ".click-keyboard-baseline.json"),
    JSON.stringify({ total, files }),
  );
}

describe("点击键盘门禁：该拦的形状（§6.11）", () => {
  test("① 非原生元素 + `onClick` + 无键 → 阻断，并点名站点与章节", ({
    repo,
  }) => {
    write(
      repo,
      `export function A() {
  return <div onClick={() => go()}>点我</div>;
}
`,
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("涨了：1 处");
    expect(r.output).toContain("src/a.tsx");
    expect(r.output).toContain("§6.11");
  });

  test("①′ 整行可点的 `li` / `span` 同样算站点", ({ repo }) => {
    write(
      repo,
      `export function A() {
  return (
    <ul>
      <li onClick={() => pick(1)}>一</li>
    </ul>
  );
}
`,
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("1 处");
  });

  test("④ **其他展开不算覆盖**（`{...props}`）→ 仍算站点", ({ repo }) => {
    write(
      repo,
      `export function A(props) {
  return <div onClick={() => go()} {...props} />;
}
`,
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("1 处");
  });

  test("④′ `{...hoverEvents}`（悬浮钩子，非键）→ 仍算站点", ({ repo }) => {
    write(
      repo,
      `export function A({ hoverEvents }) {
  return <div onClick={() => go()} {...hoverEvents} />;
}
`,
    );
    expect(repo.run().code).toBe(1);
  });
});

describe("点击键盘门禁：该放的形状（§6.11）", () => {
  test("② 原生 `<button>` 放行", ({ repo }) => {
    write(
      repo,
      `export function A() {
  return <button onClick={() => go()}>点我</button>;
}
`,
    );
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("OK —— 0 处");
  });

  test("②′ 首字母大写的组件（`<Button>`）放行 —— 键语义在它的实现里", ({
    repo,
  }) => {
    write(
      repo,
      `export function A() {
  return <Button onClick={() => go()}>点我</Button>;
}
`,
    );
    expect(repo.run().code).toBe(0);
  });

  test("③ 元素上有 `onKeyDown` 放行", ({ repo }) => {
    write(
      repo,
      `export function A() {
  return <div role="tab" tabIndex={0} onClick={() => go()} onKeyDown={(e) => e} />;
}
`,
    );
    expect(repo.run().code).toBe(0);
  });

  test("③′ `{...simpleKeyHandler(...)}` 属性展开放行（§16.2.4.57 的出口）", ({
    repo,
  }) => {
    write(
      repo,
      `export function A() {
  return (
    <div
      role="checkbox"
      tabIndex={0}
      onClick={() => toggle()}
      {...simpleKeyHandler(["Space", "Enter"], () => toggle())}
    />
  );
}
`,
    );
    expect(repo.run().code).toBe(0);
  });

  test("⑤ 拖放容器（同元素有 `onDrop` / `onDragOver`）放行", ({ repo }) => {
    write(
      repo,
      `export function A() {
  return (
    <div onClick={() => go()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()} />
  );
}
`,
    );
    expect(repo.run().code).toBe(0);
  });

  test("⑥ `onClick` 体里只有 `stopPropagation` → 放行（守卫，不是交互）", ({
    repo,
  }) => {
    write(
      repo,
      `export function A() {
  return <div onClick={(event) => event.stopPropagation()}>x</div>;
}
`,
    );
    expect(repo.run().code).toBe(0);
  });

  test("⑥′ `onClick` 体里 `preventDefault` + `stopPropagation` 也算守卫", ({
    repo,
  }) => {
    write(
      repo,
      `export function A() {
  return (
    <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>x</div>
  );
}
`,
    );
    expect(repo.run().code).toBe(0);
  });
});

describe("点击键盘门禁：棘轮（§6.11）", () => {
  const SITE = `export function A() {\n  return <div onClick={() => go()}>x</div>;\n}\n`;

  test("⑦ 站点数不超过基线 → 放行", ({ repo }) => {
    write(repo, SITE);
    setBaseline(repo, 1, { "src/a.tsx": 1 });
    expect(repo.run().code).toBe(0);
  });

  test("⑦′ 比基线少（已收口）→ 放行并提醒收紧", ({ repo }) => {
    write(repo, SITE);
    setBaseline(repo, 5);
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("--update");
  });

  test("⑧ `--update` 拒绝把基线往上涨", ({ repo }) => {
    write(repo, SITE);
    setBaseline(repo, 0);
    const r = repo.run(["--update"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("拒绝把基线往上涨");
  });

  test("⑧′ `--update` 在净数不涨时直接收紧", ({ repo }) => {
    write(repo, SITE);
    setBaseline(repo, 3);
    const r = repo.run(["--update"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("基线已收紧到 1 处");
  });

  test("⑨ `--report` 只出清单不判失败，且把豁免站点一并打出来", ({ repo }) => {
    write(repo, SITE);
    const r = repo.run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("盘点：1 处");
    expect(r.output).toContain("已登记豁免");
  });
});
