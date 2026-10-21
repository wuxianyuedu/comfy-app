/**
 * `python-run.ts` 的判据：退避链、127/ENOENT 同因、按行切分（台账 A14 抽出来的那一层）。
 *
 * **平台字面量只许住在这里**。`platform` 是形参而不是 `process.platform`，为的是让
 * Windows 与 POSIX 两侧都能被正面断言 —— 真机只有一个平台，靠默认值就只剩一半判据在跑
 * （「Windows 上先 `python`」与「`py` 带 `-3`」这两条在 Linux 节点上永远测不到）。
 * 调用点（`src/app/api/custom-nodes/route.ts`）那侧的用例因此只钉「用的是不是这份顺序」，
 * 不再抄第二份名字表 —— 抄了就会长出 A14 那种「两处各答一次」的形态。
 */
import { describe, expect, it } from "vitest";

import { pythonCandidates } from "./python-candidates";
import {
  forEachOutputLine,
  isInterpreterMiss,
  missingInterpreterMessage,
  pythonAttempts,
} from "./python-run";

const SCRIPT = ["-u", "scripts/parse_custom_nodes.py"];

describe("退避链：顺序与启动参数都取自那份判据", () => {
  it("Windows 上是 python → py → python3，且只有 py 带 -3", () => {
    const attempts = pythonAttempts(SCRIPT, "win32");
    expect(attempts.map((a) => a.command)).toEqual(["python", "py", "python3"]);
    /* `-3` 必须排在脚本参数**前面**：`py` 把第一个非选项参数当脚本，
     * 拼在后面就成了「跑 -3 这个文件」。 */
    expect(attempts.find((a) => a.command === "py")?.args).toEqual([
      "-3",
      ...SCRIPT,
    ]);
    expect(attempts.find((a) => a.command === "python")?.args).toEqual(SCRIPT);
    expect(attempts.find((a) => a.command === "python3")?.args).toEqual(SCRIPT);
  });

  it("POSIX 上没有 py，也就不许凭空多出一个 -3", () => {
    for (const platform of ["linux", "darwin"] as NodeJS.Platform[]) {
      const attempts = pythonAttempts(SCRIPT, platform);
      expect(attempts.map((a) => a.command)).toEqual(["python3", "python"]);
      expect(attempts.every((a) => !a.args.includes("-3"))).toBe(true);
    }
  });

  it("长度就是「全部试完」那条边界：调用点不再自写 length - 1", () => {
    for (const platform of ["win32", "linux"] as NodeJS.Platform[]) {
      expect(pythonAttempts(SCRIPT, platform)).toHaveLength(
        pythonCandidates(platform).length,
      );
    }
    /* 最后一档必须还在链上（A14 的第二处旧形状：127 的退避写成 `< length - 1`，
     * 最后一个候选根本没轮到，那句「未找到解释器」因此不可达）。 */
    expect(pythonAttempts(SCRIPT, "win32").at(-1)?.command).toBe("python3");
  });

  it("脚本参数原样透到每个候选之后（内核不改写调用点给的 argv）", () => {
    const args = ["-u", "x.py", "--paths", "a,b"];
    for (const attempt of pythonAttempts(args, "win32")) {
      if (attempt.command === "py") continue;
      expect(attempt.args).toEqual(args);
    }
  });
});

describe("「没有这个解释器」的两种形状必须同因", () => {
  it("ENOENT 与退出码 127 都算缺解释器（换下一个候选）", () => {
    expect(isInterpreterMiss({ errno: "ENOENT" })).toBe(true);
    expect(isInterpreterMiss({ exitCode: 127 })).toBe(true);
    /* 两个键同时给也不许漏：真机上 spawn 报错与退出码可以都到达监听器。 */
    expect(isInterpreterMiss({ errno: "ENOENT", exitCode: 127 })).toBe(true);
  });

  it("别的失败形状**不许**被算成缺解释器", () => {
    /* EACCES 换下一个候选是错的（同一台机上四个名字都不可执行）；脚本自己退 1/3
     * 更不是「没装 Python」—— 把它算进去会让一次真实的解析失败变成「轮完所有解释器」。 */
    expect(isInterpreterMiss({ errno: "EACCES" })).toBe(false);
    expect(isInterpreterMiss({ exitCode: 1 })).toBe(false);
    expect(isInterpreterMiss({ exitCode: 3 })).toBe(false);
    expect(isInterpreterMiss({ exitCode: 0 })).toBe(false);
    expect(isInterpreterMiss({ exitCode: null })).toBe(false);
    expect(isInterpreterMiss({})).toBe(false);
  });
});

describe("缺解释器那句用户可见出口", () => {
  it("两侧各钉一条字面量：顺序与判据一致，也不许多报没试过的名字", () => {
    expect(missingInterpreterMessage("win32")).toBe(
      "未找到 Python 解释器（已尝试 python / py / python3）",
    );
    /* 写死旧顺序「python3 / python / py」的那份文案在这里红；而把三个名字到处报的
     * 那份在 POSIX 上会点名一个压根没试过的 `py` —— 两个方向都要挡住，否则这句话
     * 就成了误导用户去装另一个解释器的依据。 */
    expect(missingInterpreterMessage("linux")).toBe(
      "未找到 Python 解释器（已尝试 python3 / python）",
    );
  });
});

describe("按行切分：半行要拼回来，末尾不足一行也要算一行", () => {
  /** 一条可编程的假流（与子进程 stdout 的监听面同形）。 */
  function fakeStream() {
    const cbs: Record<string, ((arg: unknown) => void)[]> = {};
    return {
      stream: {
        on: (ev: string, cb: (arg: unknown) => void) => {
          (cbs[ev] ??= []).push(cb);
        },
      } as NodeJS.ReadableStream,
      push: (chunk: string) => {
        for (const cb of cbs.data ?? []) cb(Buffer.from(chunk));
      },
      end: () => {
        for (const cb of cbs.end ?? []) cb(undefined);
      },
    };
  }

  it("一次 data 不等于一行：跨 chunk 的行拼回来", () => {
    const { stream, push } = fakeStream();
    const lines: string[] = [];
    forEachOutputLine(stream, (l) => lines.push(l));
    push("PROGRESS::scan|msg=前半");
    push("后半段\n第二行\n");
    expect(lines).toEqual(["PROGRESS::scan|msg=前半后半段", "第二行"]);
  });

  it("末尾不足一行的那一段在 end 时补发（解析器只在末尾打一次的结果 JSON 就是这一形）", () => {
    const { stream, push, end } = fakeStream();
    const lines: string[] = [];
    forEachOutputLine(stream, (l) => lines.push(l));
    push('{"packages":[]}');
    expect(lines, "没到换行就还不该交出去").toEqual([]);
    end();
    expect(lines).toEqual(['{"packages":[]}']);
  });

  it("空行与只有空白的行不交出去（否则界面上会出现空进度）", () => {
    const { stream, push, end } = fakeStream();
    const lines: string[] = [];
    forEachOutputLine(stream, (l) => lines.push(l));
    push("\n   \n留着\n\n");
    end();
    expect(lines).toEqual(["留着"]);
  });

  it("字符串 chunk 也接得住（流的编码由调用点决定，内核不许假设 Buffer）", () => {
    const cbs: ((arg: unknown) => void)[] = [];
    const lines: string[] = [];
    forEachOutputLine(
      {
        on: (_ev: string, cb: (arg: unknown) => void) => cbs.push(cb),
      } as unknown as NodeJS.ReadableStream,
      (l) => lines.push(l),
    );
    for (const cb of cbs) cb("一行\n");
    expect(lines).toEqual(["一行"]);
  });

  it("只挂 `data` 与 `end` 两个监听（不替调用点多挂，也不许漏挂）", () => {
    /* 这一档是形态约束：内核只挂这两个，缺哪个就是哪个不触发，不许在这里抛 ——
     * 抛出去会把一次正常的解析变成「流内部起进程失败」。 */
    const seen: string[] = [];
    const stream = {
      on: (ev: string) => {
        seen.push(ev);
      },
    } as unknown as NodeJS.ReadableStream;
    expect(() => forEachOutputLine(stream, () => undefined)).not.toThrow();
    expect(seen).toEqual(["data", "end"]);
  });
});
