/**
 * `pnpm agent:index` —— 两个代码索引工具的就绪读数入口（ISSUE #2762）：索引没建时语义查询返回空而不报错，会被读成「仓库里没有现成实现」。
 * 判据钉来源：codegraph 未建索引退出码仍 0，只认 `initialized`（拿退出码会把「没建」读成「就绪」）；zvec-grep 只认 `zg status --check-ready` 退出码。
 * zvec 输出原样转发（非零且无「not ready」⇒ 归「没结论」，不折成「没就绪」）；工具不在/解析不了 ⇒ 退 2（不是绿）；合成：2 压过 1 压过 0。
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  combineVerdicts,
  probeCodegraph,
  probeZvec,
  renderProbe,
  runTool,
} from "../scripts/agent-index.mjs";
import { isPlainRecord } from "../src/lib/is-record";

const SCRIPT = join(process.cwd(), "scripts", "agent-index.mjs");

/** execFileSync 抛出的错误对象：字段可选，按宽松对象声明后再逐字段读。 */
type ExecErrorFields = { status?: number; stderr?: string; stdout?: string };
function isExecErrorFields(v: unknown): v is ExecErrorFields {
  return isPlainRecord(v);
}

/** 一次命令的读数形状（与 `runTool` 的返回值同形）。 */
type RunResult = {
  code: number | null;
  missing: boolean;
  stderr: string;
  stdout: string;
};

function fakeRun(result: RunResult) {
  return () => result;
}

function run(args: Array<string> = []) {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    const e: ExecErrorFields = isExecErrorFields(error) ? error : {};
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

describe("agent:index —— codegraph 的就绪读哪里", () => {
  test("**未初始化也是退出码 0**：就绪只认 `initialized`，不认退出码", () => {
    /* 这条是整份用例里最要紧的一条：实测 `codegraph status -j` 在没建索引时
     * 照样退 0，只把 `initialized` 写成 false。拿退出码当结论 = 静默假绿。 */
    const probe = probeCodegraph(
      fakeRun({
        missing: false,
        code: 0,
        stdout: JSON.stringify({ initialized: false, version: "1.6.0", lastIndexed: null }),
        stderr: "",
      }),
    );
    expect(probe.verdict).toBe("not-ready");
  });

  test("已建索引：`initialized` + 文件数 / 上次建索引都从它自己的字段读", () => {
    const probe = probeCodegraph(
      fakeRun({
        missing: false,
        code: 0,
        stdout: JSON.stringify({
          initialized: true,
          version: "1.6.0",
          indexPath: "G:/x/.codegraph",
          lastIndexed: "2026-10-30T00:00:00.000Z",
          fileCount: 1234,
          nodeCount: 5678,
          edgeCount: 9012,
          index: { state: "complete" },
          pendingChanges: 0,
          reindexRecommended: false,
        }),
        stderr: "",
      }),
    );
    expect(probe.verdict).toBe("ready");
    const lines = renderProbe(probe).join("\n");
    expect(lines).toContain("1234");
    expect(lines).toContain("2026-10-30T00:00:00.000Z");
    expect(lines).toContain("complete");
  });

  test("输出不是 JSON ⇒ 没取到读数（退 2 那一档），不是「没就绪」", () => {
    const probe = probeCodegraph(
      fakeRun({ missing: false, code: 0, stdout: "Not initialized\n", stderr: "" }),
    );
    expect(probe.verdict).toBe("unknown");
    expect(probe.reason).toContain("可解析");
  });

  test("命令不在 PATH ⇒ 没取到读数，且给出装法", () => {
    const probe = probeCodegraph(fakeRun({ missing: true, code: null, stdout: "", stderr: "" }));
    expect(probe.verdict).toBe("unknown");
    expect(renderProbe(probe).join("\n")).toContain("pnpm add -g @colbymchenry/codegraph");
  });
});

describe("agent:index —— zvec-grep 的就绪读哪里", () => {
  test("`--check-ready` 退 0 ⇒ 就绪", () => {
    const probe = probeZvec(fakeRun({ missing: false, code: 0, stdout: "ready\n", stderr: "" }));
    expect(probe.verdict).toBe("ready");
  });

  test("退非零且说了 not ready ⇒ 没就绪，输出原样转发（不吞 stderr）", () => {
    const probe = probeZvec(
      fakeRun({
        missing: false,
        code: 1,
        stdout: "? Workspace index is not configured\n  Policy undecided\n",
        stderr: "Error: Workspace index is not ready (state: undecided)\n",
      }),
    );
    expect(probe.verdict).toBe("not-ready");
    const lines = renderProbe(probe).join("\n");
    /* 两段都要在：状态在 stdout、结论在 stderr —— 丢任何一段都读不出现场。 */
    expect(lines).toContain("Policy undecided");
    expect(lines).toContain("state: undecided");
  });

  test("退非零但**没有**它那句 not ready ⇒ 没结论（别的故障不许折成「没就绪」）", () => {
    const probe = probeZvec(
      fakeRun({ missing: false, code: 2, stdout: "", stderr: "Segmentation fault\n" }),
    );
    expect(probe.verdict).toBe("unknown");
    expect(renderProbe(probe).join("\n")).toContain("Segmentation fault");
  });

  test("命令不在 PATH ⇒ 没取到读数，且给出装法", () => {
    const probe = probeZvec(fakeRun({ missing: true, code: null, stdout: "", stderr: "" }));
    expect(probe.verdict).toBe("unknown");
    expect(renderProbe(probe).join("\n")).toContain("pnpm add -g @zvec/zvec-grep");
  });
});

describe("agent:index —— 合成口径与缺席形状", () => {
  test("2 压过 1 压过 0（与仓库其余入口同一条）", () => {
    expect(combineVerdicts([])).toBe(0);
    expect(combineVerdicts([{ verdict: "ready" }, { verdict: "ready" }])).toBe(0);
    expect(combineVerdicts([{ verdict: "ready" }, { verdict: "not-ready" }])).toBe(1);
    expect(combineVerdicts([{ verdict: "not-ready" }, { verdict: "unknown" }])).toBe(2);
  });

  test("不存在的命令：`missing` 为真（两种平台的缺席形状都归这一格）", () => {
    /* POSIX 是 spawn ENOENT，Windows 走 cmd.exe 时是「is not recognized …」；
     * 两者都是「没取到读数」，不是「没就绪」。 */
    const res = runTool("comfyapp-definitely-not-a-command", ["status"]);
    expect(res.missing).toBe(true);
  });
});

describe("agent:index —— 入口本身", () => {
  test("不认识的旗标 ⇒ 退 2 并点名", () => {
    const { code, output } = run(["--fulll"]);
    expect(code).toBe(2);
    expect(output).toContain("--fulll");
    expect(output).toContain("不认识");
  });

  test("`--help` ⇒ 退 0，用法里有两个开关与三态退出码", () => {
    const { code, output } = run(["--help"]);
    expect(code).toBe(0);
    expect(output).toContain("--init");
    expect(output).toContain("0 = 两个工具都报就绪");
  });

  test("默认跑（只读诊断）：两个工具各出一组读数，退出码只在 0/1/2 里", () => {
    /* 不钉具体数字：这台机器建没建索引不该是端到端用例的前提。钉的是形状 ——
     * 两个工具都得被问到，而且读数必须是三态之一（崩了就没有输出可言）。 */
    const { code, output } = run([]);
    expect([0, 1, 2]).toContain(code);
    expect(output).toContain("codegraph：");
    expect(output).toContain("zg：");
    expect(output).toContain("查不到 ≠ 不存在");
  });
});
