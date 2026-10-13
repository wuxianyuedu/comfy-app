/**
 * 提交门槛自检：把 scripts/check-overlay-z.cjs 当黑盒跑在临时工作区上，
 * 验证「浮层层级刻度」这条**硬闸**（规范 16 §16.2.5）真的会阻断提交。
 *
 * 规范：docs/standards/16-shadcn-ui与表单校验.md §16.2.5（ISSUE #672 / #1811）
 *
 * 这一条在 ISSUE #1811 收尾时**从棘轮翻成硬闸**（Z3 的存量清零，棘轮车道
 * 无成员）。所以这里没有 `seedBaseline`：基线文件已删、`--update` 已不存在，
 * 用例改判「命中即退 1」与「`--update` 是断头的」。
 *
 * 为什么用子进程跑：门禁由 pre-commit 以 `node scripts/xxx.cjs` 调用，且内部以
 * `__dirname/..` 定位扫描根 —— 复用同一调用方式才等价于真实门禁。临时工作区与
 * `run` / `write` 由 `tests/helpers/gate-repo.ts` 提供（门禁自测的共用夹具，
 * 收尾挂在 fixture 的 `use` 之后）。
 */
import { defineGateRepo, describe } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-overlay-z.cjs",
  dirs: ["src/components/studio", "src/components/ui", "src/app"],
});

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
    repo.write("src/components/studio/A.tsx", INLINE_Z);
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("Z1");
    expect(output).toContain("src/components/studio/A.tsx");
  });

  test("任意值写法 z-[<数字>] 会被阻断（Z2 硬闸，规范 03 §3.2）", ({
    repo,
  }) => {
    repo.write("src/components/studio/B.tsx", ARBITRARY_Z);
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("Z2");
  });

  test("刻度之外的裸数字档 z-9999 会被阻断（Z3 硬闸：又编一档）", ({ repo }) => {
    repo.write("src/components/studio/C.tsx", NUMERIC_TONE);
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("Z3");
  });

  test("刻度内的具名档放行：z-modal / z-popup / z-canvas-ui …", ({ repo }) => {
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
    repo.write(
      "src/components/ui/legacy.tsx",
      'export function V() {\n  return <div className="fixed z-50" />;\n}\n',
    );
    const { code, output } = repo.run();
    expect(code, output).toBe(0);
  });

  test("测试文件放行（测试里的 DOM 与 mock 不算视图实现）", ({ repo }) => {
    repo.write("src/components/studio/A.test.tsx", NUMERIC_TONE);
    const { code, output } = repo.run();
    expect(code, output).toBe(0);
  });

  test("历史形态翻硬闸后不再有 --update 通道（断头用例）", ({ repo }) => {
    /* 判据此前是棘轮：`--update` 能把读数写进基线。翻硬闸后那条通道必须消失 ——
     * 传 `--update` 既不落盘任何 JSON，也不放宽判定（命中仍然退 1）。
     * 少了这一格，「删了 --update」与「--update 还在但没人调」看起来一样。 */
    repo.write("src/components/studio/F.tsx", NUMERIC_TONE);
    const updated = repo.run(["--update"]);
    expect(updated.code).toBe(1);
    expect(repo.exists("scripts/.overlay-z-baseline.json")).toBe(false);

    /* 断言判据真的在计数：不传旗标也必须红。 */
    const plain = repo.run();
    expect(plain.code).toBe(1);
    expect(plain.output).toContain("Z3");
  });

  test("--report 只出清单不判失败（排批次用）", ({ repo }) => {
    repo.write("src/components/studio/G.tsx", NUMERIC_TONE);
    const { code, output } = repo.run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("--report 模式");
    expect(output).toContain("G.tsx");
  });

  test("无违规时判据是绿的（清零后的自证）", ({ repo }) => {
    /* 与上面几格互为反向：一个永远返回空的扫描器会让「清单为空」全绿，
     * 所以「有违规必红」与「无违规必绿」两条都要有。 */
    repo.write("src/components/studio/H.tsx", SCALE_TONE);
    const { code, output } = repo.run();
    expect(code, output).toBe(0);
    expect(output).toContain("0 处");
  });
});
