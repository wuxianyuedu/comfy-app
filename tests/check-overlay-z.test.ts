/**
 * 提交门槛自检：把 scripts/check-overlay-z.cjs 当黑盒跑在临时工作区上，
 * 验证「浮层层级刻度」这条棘轮（规范 16 §16.2.5）真的会阻断提交。
 *
 * 规范：docs/standards/16-shadcn-ui与表单校验.md §16.2.5（ISSUE #672）
 *
 * 为什么用子进程跑：门禁由 pre-commit 以 `node scripts/xxx.cjs` 调用，且内部以
 * `__dirname/..` 定位扫描根 —— 复用同一调用方式才等价于真实门禁。临时工作区与
 * `run` / `write` 由 `tests/helpers/gate-repo.ts` 提供（门禁自测的共用夹具，
 * 收尾挂在 fixture 的 `use` 之后）。
 */
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-overlay-z.cjs",
  dirs: ["src/components/studio", "src/components/ui", "src/app"],
});

/** 基线是首次 `--update` 写出的（门禁自身的常规用法）。 */
function seedBaseline(repo: GateRepo): void {
  const { code, output } = repo.run(["--update"]);
  expect(code, output).toBe(0);
}

const INLINE_Z =
  "export function V() {\n  return <div style={{ zIndex: 7 }} />;\n}\n";
const ARBITRARY_Z =
  'export function V() {\n  return <div className="fixed z-[10000]" />;\n}\n';
const NUMERIC_TONE =
  'export function V() {\n  return <div className="fixed z-9999" />;\n}\n';
const SCALE_TONE =
  'export function V() {\n  return <div className="fixed z-modal" />;\n}\n';

describe("check-overlay-z.cjs（提交门槛，规范 §16.2.5）", () => {
  test("行内数字 zIndex 会被阻断（Z1 硬闸）", ({ repo }) => {
    seedBaseline(repo);
    repo.write("src/components/studio/A.tsx", INLINE_Z);
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("Z1");
    expect(output).toContain("src/components/studio/A.tsx");
  });

  test("任意值写法 z-[<数字>] 会被阻断（Z2 硬闸，规范 03 §3.2）", ({
    repo,
  }) => {
    seedBaseline(repo);
    repo.write("src/components/studio/B.tsx", ARBITRARY_Z);
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("Z2");
  });

  test("刻度之外的裸数字档 z-9999 会被阻断（Z3：又编一档）", ({ repo }) => {
    seedBaseline(repo);
    repo.write("src/components/studio/C.tsx", NUMERIC_TONE);
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("Z3");
  });

  test("刻度内的具名档放行：z-modal / z-popup / z-canvas-ui …", ({ repo }) => {
    seedBaseline(repo);
    repo.write("src/components/studio/D.tsx", SCALE_TONE);
    for (const tone of [
      "z-base",
      "z-canvas-ui",
      "z-canvas-max",
      "z-popup",
      "z-toast",
      "z-overlay",
    ]) {
      repo.write(
        `src/components/studio/D-${tone}.tsx`,
        `export function V() {\n  return <div className="fixed ${tone}" />;\n}\n`,
      );
    }
    const { code, output } = repo.run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });

  test("注释里的旧形态不计入（说明性注释不是实现）", ({ repo }) => {
    seedBaseline(repo);
    repo.write(
      "src/components/studio/E.tsx",
      [
        "/* 此前这里是 `z-9999` 与 style={{ zIndex: 7 }}，现改走刻度表。 */",
        "export function V() {",
        '  return <div className="fixed z-modal" />;',
        "}",
        "",
      ].join("\n"),
    );
    const { code, output } = repo.run();
    expect(code, output).toBe(0);
  });

  test("ui/ 基元目录放行（shadcn 工具生成、尽量不手改，§16.1）", ({ repo }) => {
    seedBaseline(repo);
    repo.write(
      "src/components/ui/legacy.tsx",
      'export function V() {\n  return <div className="fixed z-50" />;\n}\n',
    );
    const { code, output } = repo.run();
    expect(code, output).toBe(0);
  });

  test("测试文件放行（测试里的 DOM 与 mock 不算视图实现）", ({ repo }) => {
    seedBaseline(repo);
    repo.write("src/components/studio/A.test.tsx", NUMERIC_TONE);
    const { code, output } = repo.run();
    expect(code, output).toBe(0);
  });

  test("棘轮只许降不许升：存量上升被阻断，且 --update 拒绝放宽", ({ repo }) => {
    repo.write("src/components/studio/F.tsx", NUMERIC_TONE);
    seedBaseline(repo);
    repo.write("src/components/studio/F2.tsx", NUMERIC_TONE);
    const blocked = repo.run();
    expect(blocked.code).toBe(1);
    expect(blocked.output).toContain("新增 Z3");

    const updated = repo.run(["--update"]);
    expect(updated.code).toBe(1);
    expect(updated.output).toContain("拒绝放宽基线");
  });

  test("--report 只出清单不判失败（排批次用）", ({ repo }) => {
    repo.write("src/components/studio/G.tsx", NUMERIC_TONE);
    const { code, output } = repo.run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("--report 模式");
    expect(output).toContain("G.tsx");
  });

  test("治理后 --update 收紧基线", ({ repo }) => {
    repo.write("src/components/studio/H.tsx", NUMERIC_TONE);
    seedBaseline(repo);
    repo.write("src/components/studio/H.tsx", SCALE_TONE);
    const tightened = repo.run(["--update"]);
    expect(tightened.code, tightened.output).toBe(0);
    expect(tightened.output).toContain("基线已更新：1 → 0");
    expect(repo.run().code).toBe(0);
  });

  test("--strict 下基线未收紧即失败（强制跟上治理进度）", ({ repo }) => {
    seedBaseline(repo);
    const { code, output } = repo.run(["--strict"]);
    expect(code, output).toBe(0);
  });
});
