/**
 * 提交门槛自检：把 scripts/check-ui-primitives.cjs 当黑盒跑在临时工作区上，
 * 验证「视图层自实现 UI 基元」这条棘轮（规范 §16.2.3）真的会阻断提交。
 *
 * 规范：docs/standards/16-shadcn-ui与表单校验.md §16.2.3（ISSUE #672）
 *
 * 为什么用子进程跑：门禁由 pre-commit 以 `node scripts/xxx.cjs` 调用，且内部以
 * `__dirname/..` 定位扫描根 —— 复用同一调用方式才等价于真实门禁。
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-ui-primitives.cjs");

let workdir = "";

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", "check-ui-primitives.cjs"), ...args],
      { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

function write(rel: string, content: string): void {
  const full = join(workdir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "ui-primitives-gate-"));
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  // 先探一次 umask/权限行为：某些沙箱会把新建目录设成不可写（drwxr-xr-x），
  // 那样 `--update` 落盘基线会 EACCES —— 显式补齐，测试不该被环境权限误红。
  chmodSync(join(workdir, "scripts"), 0o777);
  copyFileSync(SCRIPT, join(workdir, "scripts", "check-ui-primitives.cjs"));
  // vitest worker 里创建的临时脚本默认可能带不上可执行位，而门禁是用
  // `node <script>` 跑的 —— 显式补齐权限位，避免在只读/受限 umask 下误红。
  chmodSync(join(workdir, "scripts", "check-ui-primitives.cjs"), 0o755);
  for (const d of [
    "src/components/studio",
    "src/components/workshop",
    "src/components/ui",
    "src/app",
  ]) {
    mkdirSync(join(workdir, d), { recursive: true });
  }
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** 基线是首次 `--update` 写出的（门禁自身的常规用法）。 */
function seedBaseline(): void {
  const { code, output } = run(["--update"]);
  expect(code, output).toBe(0);
}

const BUTTON_VIEW =
  'export function V() {\n  return <button type="button">ok</button>;\n}\n';
const PORTAL_VIEW =
  'import { createPortal } from "react-dom";\nexport const P = () => createPortal(null, document.body);\n';
const SPIN_VIEW =
  'export function S() {\n  return <span className="animate-spin" />;\n}\n';
const SCROLLBAR_VIEW =
  'export function C() {\n  return <div className="[&::-webkit-scrollbar-thumb]:bg-red-500!" />;\n}\n';
const CLIPBOARD_VIEW =
  'export function K() {\n  const onCopy = () => void navigator.clipboard.writeText("a");\n  return <span onClick={onCopy}>copy</span>;\n}\n';
const DOWNLOAD_VIEW =
  'export function D() {\n  const save = () => URL.createObjectURL(new Blob(["x"]));\n  return <span onClick={save}>save</span>;\n}\n';

describe("check-ui-primitives.cjs（提交门槛，规范 §16.2.3）", () => {
  it("视图里手写 <button> 会被阻断（规范 P1）", () => {
    write("src/components/workshop/A.tsx", BUTTON_VIEW);
    run(["--update"]);
    write("src/components/workshop/A2.tsx", BUTTON_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P1");
    expect(output).toContain("src/components/workshop/A2.tsx");
  });

  it("视图里自建 createPortal 浮层会被阻断（规范 P2）", () => {
    write("src/components/studio/B.tsx", PORTAL_VIEW);
    run(["--update"]);
    write("src/components/studio/B2.tsx", PORTAL_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P2");
  });

  it("视图里自写 animate-spin / animate-pulse 会被阻断（规范 P3）", () => {
    write("src/components/studio/C.tsx", SPIN_VIEW);
    run(["--update"]);
    write("src/components/studio/C2.tsx", SPIN_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P3");
  });

  it("视图里自写 ::-webkit-scrollbar 外观直接阻断，不进棘轮（规范 P4）", () => {
    /* P4 与 P1~P3 不同：它不是「先冻结存量」的棘轮，而是**硬闸** ——
       自绘滚动条外观的唯一出口是 globals.css（`.custom-scrollbar` /
       `.soft-scrollbar`）。所以基线里没有这一条，第一处新增就直接断。 */
    seedBaseline();
    write("src/components/workshop/E.tsx", SCROLLBAR_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P4");
    expect(output).toContain("src/components/workshop/E.tsx");
  });

  it("P4 未清零时 --update 拒绝更新基线（硬闸不能靠放水绕过）", () => {
    seedBaseline();
    write("src/components/studio/F.tsx", SCROLLBAR_VIEW);
    const { code, output } = run(["--update"]);
    expect(code).toBe(1);
    expect(output).toContain("硬闸");
  });

  it("视图里自写剪贴板写入直接阻断，不进棘轮（规范 P5）", () => {
    /* 与 P4 同性质：`~/lib/browser-io` 的 copyText 是唯一出口（含降级链路），
       所以第一处自写就断，不存在「先冻结存量」的中间态。 */
    seedBaseline();
    write("src/components/studio/G.tsx", CLIPBOARD_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P5");
    expect(output).toContain("src/components/studio/G.tsx");
  });

  it("视图里自写 Blob 下载直接阻断，不进棘轮（规范 P6）", () => {
    seedBaseline();
    write("src/components/studio/H.tsx", DOWNLOAD_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("P6");
  });

  it("P5/P6 未清零时 --update 拒绝更新基线", () => {
    seedBaseline();
    write("src/components/studio/I.tsx", CLIPBOARD_VIEW);
    const { code, output } = run(["--update"]);
    expect(code).toBe(1);
    expect(output).toContain("硬闸");
  });

  it("P5/P6 的计数不进棘轮基线", () => {
    seedBaseline();
    const baseline = JSON.parse(
      readFileSync(
        join(workdir, "scripts", ".ui-primitives-baseline.json"),
        "utf8",
      ),
    ) as { rules: Record<string, string> };
    expect(baseline.rules.P5).toBeUndefined();
    expect(baseline.rules.P6).toBeUndefined();
  });

  it("P4 的计数不进棘轮基线（P4 只在 HARD_GATE_RULES 里判空）", () => {
    seedBaseline();
    const baseline = JSON.parse(
      readFileSync(
        join(workdir, "scripts", ".ui-primitives-baseline.json"),
        "utf8",
      ),
    ) as { rules: Record<string, string> };
    expect(baseline.rules.P4).toBeUndefined();
  });

  it("ui/ 基元自身实现放行（Button 里本来就是 <button>）", () => {
    write("src/components/ui/button.tsx", BUTTON_VIEW);
    seedBaseline();
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("0 处");
  });

  it("studio/** 的业务目录不放行（豁免目录已按 §16.2.4 归还）", () => {
    /* `studio/ui/**` 与 `studio/shared/**` 曾整体豁免（它们是「待合并的
       第二套 UI kit」）。归并完成后豁免必须撤掉 —— 再留一条按目录的模糊
       放行，等于让那两处的新增自实现在这里悄悄溜过。 */
    seedBaseline();
    write("src/components/studio/workflow-form/D.tsx", BUTTON_VIEW);
    write("src/components/studio/workflow-form/E.tsx", PORTAL_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("workflow-form/D.tsx");
    expect(output).toContain("workflow-form/E.tsx");
  });

  it("<feature>/hooks/ 放行（§16.2.1 第②层是逻辑层，不是视图）", () => {
    write("src/components/workshop/hooks/use-x.ts", SPIN_VIEW);
    seedBaseline();
    const { code } = run();
    expect(code).toBe(0);
  });

  it("测试文件放行（测试里的 DOM 与 mock 不算视图实现）", () => {
    write("src/components/workshop/A.test.tsx", BUTTON_VIEW);
    write("src/components/workshop/__tests__/B.tsx", PORTAL_VIEW);
    seedBaseline();
    const { code } = run();
    expect(code).toBe(0);
  });

  it("棘轮：已登记的存量放行，新增的仍阻断", () => {
    write("src/components/workshop/Known.tsx", BUTTON_VIEW);
    seedBaseline();
    expect(run().code).toBe(0);
    write("src/components/workshop/Fresh.tsx", BUTTON_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("src/components/workshop/Fresh.tsx");
    expect(output).not.toContain("Known");
  });

  it("棘轮：同一文件处数上升也阻断（只许降不许升）", () => {
    write("src/components/studio/G.tsx", BUTTON_VIEW);
    seedBaseline();
    write("src/components/studio/G.tsx", BUTTON_VIEW + BUTTON_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("上升");
  });

  it("--update 拒绝放宽基线（不得用 --update 掩盖新增）", () => {
    write("src/components/studio/H.tsx", BUTTON_VIEW);
    seedBaseline();
    write("src/components/studio/I.tsx", BUTTON_VIEW);
    const { code, output } = run(["--update"]);
    expect(code).toBe(1);
    expect(output).toContain("拒绝放宽基线");
  });

  it("治理后收紧：--strict 要求执行 --update，收紧后转绿", () => {
    write("src/components/studio/J.tsx", BUTTON_VIEW);
    seedBaseline();
    write("src/components/studio/J.tsx", "export const J = 1;\n");
    const strict = run(["--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.output).toContain("--update");
    expect(run(["--update"]).code).toBe(0);
    expect(run(["--strict"]).code).toBe(0);
  });

  it("--report 只盘点不判失败", () => {
    write("src/components/studio/K.tsx", BUTTON_VIEW + SPIN_VIEW);
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("P1");
    expect(output).toContain("P3");
  });

  it("基线文件缺失时给可行动提示而不是静默通过", () => {
    write("src/components/studio/L.tsx", BUTTON_VIEW);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("--update");
  });

  /* ── 注释里的 `<button>` 是说明，不是实现 ────────────────────────────────
   * 判据先剥注释：把一处手写按钮改成 `<Button>` 并顺手把理由（「原来是
   * `<button>` 手搓」）写进注释，是最自然不过的写法 —— 若不剥注释，该文件
   * 的计数会停在原地，棘轮永远降不下去，而代码其实已经合规。
   * 同款教训见 `check-theme-colors.cjs`（注释里的 `#346` 被误判成色值）。 */
  it("注释里提到 <button> 不计入 P1", () => {
    write(
      "src/components/studio/N.tsx",
      "/* 原来是 <button> 手搓，现改走 <Button>（ISSUE #672） */\n" +
        "// 也见 <button> 的默认 type\n" +
        "export const N = () => <Button>ok</Button>;\n",
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("studio/N.tsx");
  });

  it("代码里（含字符串字面量）的 <button> 仍然计入 P1", () => {
    write(
      "src/components/studio/O.tsx",
      'export const O = () => <button type="button">ok</button>;\n',
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("studio/O.tsx");
  });

  it("块注释跨多行时不会漏剥（<button> 落在中间那行）", () => {
    write(
      "src/components/studio/P.tsx",
      "/*\n * 说明：\n * 这里渲染一个 <button\n * 但现在走基元\n */\nexport const P = 1;\n",
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).not.toContain("studio/P.tsx");
  });

  it("写入的基线带 rules 说明与 total（清单不自证失效）", () => {
    write("src/components/studio/M.tsx", BUTTON_VIEW);
    seedBaseline();
    const baseline = JSON.parse(
      readFileSync(
        join(workdir, "scripts", ".ui-primitives-baseline.json"),
        "utf8",
      ),
    ) as { total: number; rules: Record<string, string> };
    expect(baseline.total).toBe(1);
    expect(baseline.rules.P1).toBeTruthy();
    expect(baseline.rules.P2).toBeTruthy();
    expect(baseline.rules.P3).toBeTruthy();
  });
});
