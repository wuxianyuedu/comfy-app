/**
 * `check-mirror-attendance.mjs` 的用例（ISSUE #3046）：`run` 全用假件、一次网络请求都不发；
 * 「现在」由 `now` 钉住（沿用 `tests/check-daily-attendance.test.ts` 的纪律）—— 不钉住它这一档
 * 就会随真实时间自己变红，成为「随时间漂移的平台状态判据」。
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WINDOW_HOURS,
  EGRESS_SIGNAL,
  MIRROR_STAGE_NAME,
  classifyMirrorText,
  egressWindowSignal,
  judgeMirrorAttendance,
  main,
  readMirrorCell,
} from "../scripts/check-mirror-attendance.mjs";
import { explainRemoteProbeFailure } from "../scripts/ci-github-mirror-push.mjs";

/* 钉住的「现在」：2026-11-02T06:00:00Z。窗口内的读数都按它算。 */
const NOW = Date.parse("2026-11-02T06:00:00.000Z");
const IN_WINDOW = new Date(NOW - 2 * 3_600_000).toISOString();
const OUT_OF_WINDOW = new Date(NOW - 96 * 3_600_000).toISOString();

const env = { now: NOW, slug: "moon-read/comfy-app-t3" };

describe("classifyMirrorText：七类形状各有下一动作，不许念成同一句", () => {
  it("成功那句要**两半都在**（已推 + 已派发）", () => {
    const present = classifyMirrorText(
      "[mirror] ✓ 已推 wuxianyuedu/comfy-app:cnb-pr-3053 @ d5891eba · 已派发 cnb-pr-sync",
    );
    expect(present.shape).toBe("present");
    /* 只推成而派发没发生 ⇒ GitHub 那边不会起跑，不能算出勤。 */
    expect(classifyMirrorText("[mirror] ✓ 已推 wuxianyuedu/comfy-app:cnb-pr-3053").shape).not.toBe(
      "present",
    );
  });

  it("egress / 仓库没建 / 身份够不到 三形分得开（#3046 的现场就是被念成同一句）", () => {
    expect(
      classifyMirrorText(
        "[mirror] 推送前这一读没通（exit 128）：这一跳没通（TCP / DNS / 代理层）⇒ 出网在节点侧",
      ).shape,
    ).toBe("egress");
    expect(
      classifyMirrorText("[mirror] 推送前这一读没通：目标仓库在 GitHub 上不存在 ⇒ 先去建仓库")
        .shape,
    ).toBe("repo-missing");
    expect(
      classifyMirrorText("[mirror] 推送前这一读没通：这枚令牌的身份够不到目标仓库").shape,
    ).toBe("token-scope");
    /* 反控制：探针那句被念成默认话术时落 token-scope（同一层的保守归属），
     * 而**绝不**因为「没通」就落进 egress —— 把令牌问题说成出网问题同样是指错下一动作。 */
    expect(classifyMirrorText("[mirror] 推送前这一读没通：现场拿真值定值").shape).toBe(
      "token-scope",
    );
    expect(
      classifyMirrorText("[mirror] 推送前这一读没通：egress 无关的一句 fatal: 403").shape,
    ).toBe("token-scope");
  });

  it("现场 `Connection was reset` 走完探针话术 ⇒ egress，不许落成 token-scope", () => {
    const raw =
      "fatal: unable to access 'https://github.com/wuxianyuedu/comfy-app.git/': Recv failure: Connection was reset";
    /* cnb-95h-1k6in94fu / cnb-sji-1k6iu657n：修判据前这句落默认话术，出勤被记成令牌问题。
     * 这条把「原话 → explainRemoteProbeFailure → classifyMirrorText」整条链钉在一起。 */
    const text = `[mirror] 推送前这一读没通（exit 128）：${explainRemoteProbeFailure(raw)}`;
    expect(classifyMirrorText(text).shape).toBe("egress");
  });

  it("推送那一跳与派发那一跳各自成形状（探针通了之后断点会在更后面一跳）", () => {
    /* 实测原话（cnb-vj3-1k6ddf69d）：status=success 而正文写着推送失败 —— Schannel 断流。 */
    const push = classifyMirrorText(
      "[mirror] 推送前这一读：通（空仓库 ⇒ 零条 ref 也是通的）\n" +
        "[mirror] 推送失败（exit 128）：\n" +
        "[mirror]   fatal: unable to access 'https://github.com/x/y.git/': " +
        "schannel: server closed abruptly (missing close_notify)",
    );
    expect(push.shape).toBe("push-failed");
    expect(push.evidence).toContain("推送失败");
    expect(classifyMirrorText("[mirror] 派发被拒：HTTP 404").shape).toBe("dispatch-rejected");
    expect(classifyMirrorText("[mirror] 没跑起来的原因：`GITHUB_MIRROR_TOKEN` 未配置").shape).toBe(
      "missing-prereq",
    );
  });

  it("格子被 skip 与「有格没正文」分得开（两种都不是缺勤的证据）", () => {
    expect(classifyMirrorText("", "skipped").shape).toBe("no-cell");
    expect(
      classifyMirrorText("Runner[orange] $ node scripts/ci-github-mirror-push.mjs").shape,
    ).toBe("unreadable");
  });
});

describe("judgeMirrorAttendance：三态、覆盖与「没这一格不算缺勤」", () => {
  const build = (sn: string, createTime = IN_WINDOW) => ({ createTime, eventUrl: "x/pull/1", sn });

  it("窗口内一次「已推 · 已派发」⇒ 0 出勤", () => {
    const out = judgeMirrorAttendance({
      builds: [build("cnb-a"), build("cnb-b")],
      now: NOW,
      readings: [
        { evidence: "推送失败（exit 128）", found: true, shape: "push-failed", sn: "cnb-a" },
        { evidence: "已推 · 已派发", found: true, shape: "present", sn: "cnb-b" },
      ],
      windowHours: DEFAULT_WINDOW_HOURS,
    });
    expect(out.code).toBe(0);
    expect(out.verdict).toBe("present");
    expect(out.headline).toContain("1/2 跑「已推 · 已派发」");
    expect(out.stats.present).toBe(1);
  });

  it("有格而零次推成 ⇒ 1 缺勤，并把形状逐类点名", () => {
    const out = judgeMirrorAttendance({
      builds: [build("cnb-a"), build("cnb-b"), build("cnb-c")],
      now: NOW,
      readings: [
        { evidence: "这一跳没通", found: true, shape: "egress", sn: "cnb-a" },
        { evidence: "schannel 断流", found: true, shape: "push-failed", sn: "cnb-b" },
        { evidence: "", found: false, shape: "no-cell", sn: "cnb-c" },
      ],
      windowHours: DEFAULT_WINDOW_HOURS,
    });
    expect(out.code).toBe(1);
    /* 「2 跑有这一格」的主语是**有正文的那两跑**：no-cell 那一跑根本没这一格，
     * 把它算进缺勤就是替平台编一条不存在的执行（与 #2392 那条同一口径）。 */
    expect(out.headline).toContain("2 跑有这一格、零次推成（egress×1、push-failed×1、no-cell×1）");
    expect(out.stats.seen).toBe(2);
  });

  it("整批都没有这一格 ⇒ 2 没结论（前移未生效 / 不是 PR 档），不是缺勤", () => {
    const out = judgeMirrorAttendance({
      builds: [build("cnb-a")],
      now: NOW,
      readings: [{ evidence: "", found: false, shape: "no-cell", sn: "cnb-a" }],
      windowHours: DEFAULT_WINDOW_HOURS,
    });
    expect(out.code).toBe(2);
    expect(out.verdict).toBe("unknown");
    expect(out.headline).toContain(MIRROR_STAGE_NAME);
  });

  it("窗口外的读数不改变判决的基数（windowBuilds 只数窗口内）", () => {
    const out = judgeMirrorAttendance({
      builds: [build("cnb-in"), build("cnb-out", OUT_OF_WINDOW)],
      now: NOW,
      readings: [{ evidence: "已推 · 已派发", found: true, shape: "present", sn: "cnb-in" }],
      windowHours: DEFAULT_WINDOW_HOURS,
    });
    expect(out.stats.windowBuilds).toBe(1);
  });
});

/* ── ISSUE #3278：环境红信号 ────────────────────────────────────────────────
 * 现场是「24h 窗口 6 present + 2 egress」仍 `code=0 / verdict=present`：出勤判据没坏，
 * 坏的是「有没有机器说得出这几跑是环境红」。信号单列一档，退码一个字不改。 */
describe("egressWindowSignal：出勤照旧，环境红单独可读（ISSUE #3278）", () => {
  const build = (sn: string) => ({ createTime: IN_WINDOW, eventUrl: "x/pull/1", sn });
  const judge = (shapes: string[]) =>
    judgeMirrorAttendance({
      builds: shapes.map((_, i) => build(`cnb-${String(i)}`)),
      now: NOW,
      readings: shapes.map((shape, i) => ({
        evidence: "",
        found: true,
        shape,
        sn: `cnb-${String(i)}`,
      })),
      windowHours: DEFAULT_WINDOW_HOURS,
    });

  it("6 present + 2 egress ⇒ 仍是出勤，但信号说间歇性断流、要立案，并把 egress 点进 headline", () => {
    const out = judge([
      "present",
      "present",
      "present",
      "present",
      "present",
      "present",
      "egress",
      "egress",
    ]);
    expect(out.code).toBe(0);
    expect(out.verdict).toBe("present");
    expect(out.stats.present).toBe(6);
    expect(out.stats.egress).toBe(2);
    expect(out.signal.signal).toBe(EGRESS_SIGNAL.INTERMITTENT);
    expect(out.signal.shouldFile).toBe(true);
    expect(out.headline).toContain("egress×2（环境红/节点出网）");
  });

  it("推成且零 egress ⇒ stable，不立案", () => {
    const out = judge(["present", "present"]);
    expect(out.signal.signal).toBe(EGRESS_SIGNAL.STABLE);
    expect(out.signal.shouldFile).toBe(false);
    expect(out.headline).not.toContain("环境红");
  });

  it("零次推成、全是 egress ⇒ egress-only，立案（持续断流）", () => {
    const out = judge(["egress", "egress"]);
    expect(out.code).toBe(1);
    expect(out.signal.signal).toBe(EGRESS_SIGNAL.EGRESS_ONLY);
    expect(out.signal.shouldFile).toBe(true);
  });

  it("缺勤但不是出网（令牌 / 仓库那族）⇒ 不立 egress 单，交缺勤判决自己交账", () => {
    const out = judge(["token-scope", "repo-missing"]);
    expect(out.code).toBe(1);
    expect(out.signal.signal).toBe(EGRESS_SIGNAL.OTHER_ABSENT);
    expect(out.signal.shouldFile).toBe(false);
  });

  it("没结论 ⇒ no-verdict，绝不立案（§13.6.3：判据读不到不等于判过了）", () => {
    const out = judgeMirrorAttendance({
      builds: [build("cnb-a")],
      now: NOW,
      readings: [{ evidence: "", found: false, shape: "no-cell", sn: "cnb-a" }],
      windowHours: DEFAULT_WINDOW_HOURS,
    });
    expect(out.code).toBe(2);
    expect(out.signal.signal).toBe(EGRESS_SIGNAL.NO_VERDICT);
    expect(out.signal.shouldFile).toBe(false);
  });

  it("纯函数那一档：`code=2` 优先于 stats 里残留的 egress 计数", () => {
    const signal = egressWindowSignal({
      code: 2,
      stats: { present: 0, seen: 3, shapeCounts: { egress: 3 } },
    });
    expect(signal.signal).toBe(EGRESS_SIGNAL.NO_VERDICT);
    expect(signal.egress).toBe(3);
    expect(signal.shouldFile).toBe(false);
  });

  it("`--json` 里带 signal，非 json 档带 `signal=` 那一行（人和机器都能认）", () => {
    const list = JSON.stringify({
      data: [
        {
          createTime: IN_WINDOW,
          eventUrl: "https://cnb.cool/o/r/-/merge_requests/1",
          sn: "cnb-a",
          status: "success",
        },
      ],
      status: 200,
    });
    const run = (_cmd: string, args: Array<string>) => {
      if (args[1] === "get-build-logs") {
        return { error: null, stderr: "", stdout: list, status: 0 };
      }
      if (args[1] === "get-build-status") {
        return { error: null, stderr: "", status: 0, stdout: buildStatus() };
      }
      return {
        error: null,
        stderr: "",
        status: 0,
        stdout: JSON.stringify({
          data: { content: ["[mirror] ✓ 已推 o/r:cnb-pr-1 @ abc · 已派发 cnb-pr-sync"] },
          status: 200,
        }),
      };
    };
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(main(["--json"], { ...env, run: run as never })).toBe(0);
      /* 按纯文本钉字段形状即可：这里要证的是「signal 真的进了 --json 的载荷」，
       * 再 JSON.parse 一遍只会把平台载荷类型重新引进用例（那份形状由判据自己给）。 */
      const jsonOut = spy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(jsonOut).toContain('"signal": "stable"');
      expect(jsonOut).toContain('"shouldFile": false');

      spy.mockClear();
      expect(main([], { ...env, run: run as never })).toBe(0);
      const lines = spy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("signal=stable"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

/** 造一份「平台给的一跑读数」：格在主列（stage-3），正文由调用方在 detail 那一跳给。 */
function buildStatus(stageId = "stage-3") {
  return JSON.stringify({
    status: 200,
    data: {
      status: "success",
      pipelinesStatus: {
        "cnb-x-1-001": {
          id: "cnb-x-1-001",
          name: "质量门禁",
          status: "success",
          stages: [{ duration: 100_418, id: stageId, name: MIRROR_STAGE_NAME, status: "success" }],
        },
      },
    },
  });
}

describe("readMirrorCell：按格名找到那一格，再按同一份实现取正文", () => {
  it("正文里的形状与格子 id 一起回来（#3047 之后主列格可按名点）", () => {
    const body = [
      "[mirror] 计划：HEAD d5891eba",
      "[mirror] 推送失败（exit 128）：",
      "[mirror]   fatal: unable to access: schannel: server closed abruptly",
    ];
    const asked: Array<Array<string>> = [];
    const run = (_cmd: string, args: Array<string>) => {
      asked.push(args);
      const stdout =
        args[1] === "get-build-status"
          ? buildStatus()
          : JSON.stringify({
              data: { content: body, duration: 100_418, error: "", status: "success" },
              status: 200,
            });
      return { error: null, stderr: "", stdout, status: 0 };
    };
    const read = readMirrorCell(run, "o/r", "cnb-x-1");
    expect(read.found).toBe(true);
    expect(read.stageId).toBe("stage-3");
    expect(read.shape).toBe("push-failed");
    /* 取正文那一跳必须带它自己的 pipelineId 与 stageId（拼错不报错、会读到另一格）。 */
    const detailCall = asked.find((a) => a[1] === "get-build-stage");
    expect(detailCall).toContain("cnb-x-1-001");
    expect(detailCall).toContain("stage-3");
  });

  it("同名两格 ⇒ 不替你挑一格，落 unreadable 并把两条流水线念出来", () => {
    const twoPipelines = {
      data: {
        pipelinesStatus: {
          "p-001": {
            id: "p-001",
            name: "质量门禁",
            stages: [{ id: "stage-3", name: MIRROR_STAGE_NAME, status: "success" }],
            status: "success",
          },
          "p-002": {
            id: "p-002",
            name: "每日档",
            stages: [{ id: "stage-9", name: MIRROR_STAGE_NAME, status: "success" }],
            status: "success",
          },
        },
        status: "success",
      },
      status: 200,
    };
    const asked: Array<Array<string>> = [];
    const run = (_cmd: string, args: Array<string>) => {
      asked.push(args);
      return {
        error: null,
        stderr: "",
        stdout: JSON.stringify(twoPipelines),
        status: 0,
      };
    };
    const read = readMirrorCell(run, "o/r", "cnb-y-1");
    expect(read.found).toBe(false);
    expect(read.shape).toBe("unreadable");
    expect(read.evidence).toContain("同名格 2 个");
    /* 挑不出来就**不发**那一跳按格取详情的请求 —— 发了也不知道该发哪一格。 */
    expect(asked.filter((a) => a[1] === "get-build-stage")).toEqual([]);
  });
});

describe("main：取数盖不住窗口 / 列表取不到 都落 2，不落在 1", () => {
  it("列表取不到 ⇒ 2（「我没取到」不许被念成「它没跑」）", () => {
    const run = () => ({ error: null, stderr: "", stdout: "not json", status: 0 });
    expect(main([], { ...env, run: run as never })).toBe(2);
  });

  it("在线那一跳：PR 档的格子被读到 ⇒ 三态照正文出", () => {
    const list = JSON.stringify({
      data: [
        {
          createTime: IN_WINDOW,
          eventUrl: "https://cnb.cool/o/r/-/merge_requests/1",
          sn: "cnb-a",
          status: "success",
        },
      ],
      status: 200,
    });
    const run = (_cmd: string, args: Array<string>) => {
      if (args[1] === "get-build-logs") {
        return { error: null, stderr: "", stdout: list, status: 0 };
      }
      if (args[1] === "get-build-status") {
        return {
          error: null,
          stderr: "",
          status: 0,
          stdout: buildStatus(),
        };
      }
      return {
        error: null,
        stderr: "",
        status: 0,
        stdout: JSON.stringify({
          data: { content: ["[mirror] ✓ 已推 o/r:cnb-pr-1 @ abc · 已派发 cnb-pr-sync"] },
          status: 200,
        }),
      };
    };
    expect(main([], { ...env, run: run as never })).toBe(0);
  });
});
