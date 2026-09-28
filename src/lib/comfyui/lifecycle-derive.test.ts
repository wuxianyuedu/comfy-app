// lifecycle 纯派生逻辑的判决表测试。
//
// 为什么单独测这一层：lifecycle.ts 的判断规则每一条都对应一次真实事故
// （任务卡在队列 / 窗口关了进程还在 / 关掉又被悄悄拉起），但它们此前散在
// 副作用代码里无法断言。这里把规则逐条钉住——用例名直接写出「什么情况 →
// 什么判决」，改动判断顺序或漏掉某个前置条件都会立刻红。

import { describe, expect, it } from "vitest";

import {
  buildEarlyExitDetail,
  deriveComfyUiStatus,
  isWithinWindow,
  type ComfyStatusFacts,
  buildSpawnArgs,
  decideEnsureLaunch,
  decideStop,
  decideStopOutcome,
  extractMissingModule,
  isKeepAliveDead,
  isWithinStoppingWindow,
  resolveLaunchPolicy,
  shouldCheckKeepAliveProcess,
  shouldClearStoppingOnStopMiss,
  hasEmbedClearanceFlag,
  withEmbedClearanceFlag,
  isPortConflictLine,
  portConflictExitDetail,
  COMFY_EMBED_FLAG,
  type EnsureFacts,
} from "./lifecycle-derive";

/** 默认事实：未运行 / 非手动 / 无闩锁 / 开了自动启动 / 配了路径。 */
function facts(over: Partial<EnsureFacts> = {}): EnsureFacts {
  return {
    upBase: null,
    manual: false,
    manualStop: false,
    autoStart: true,
    comfyuiPath: "/x",
    ...over,
  };
}

describe("decideEnsureLaunch — 自动启动判决表", () => {
  it("已在运行（探测到 base）→ 直接复用，不再拉起第二个实例", () => {
    const d = decideEnsureLaunch(facts({ upBase: "http://127.0.0.1:8189" }));
    expect(d).toEqual({ kind: "already-up", base: "http://127.0.0.1:8189" });
  });

  it("已在运行时即便带了手动关闭闩锁也复用现有实例（闩锁只拦「拉起」）", () => {
    const d = decideEnsureLaunch(
      facts({ upBase: "http://127.0.0.1:8188", manualStop: true }),
    );
    expect(d.kind).toBe("already-up");
  });

  it("自动启动来源 + 用户刚手动关闭过 → 让路，不把 ComfyUI 悄悄拉起（ISSUE #290）", () => {
    const d = decideEnsureLaunch(facts({ manualStop: true, manual: false }));
    expect(d).toEqual({ kind: "skip-manual-stop" });
  });

  it("手动启动优先于闩锁：manual=true 时不被上一次手动关闭拦住", () => {
    const d = decideEnsureLaunch(facts({ manualStop: true, manual: true }));
    expect(d).toEqual({ kind: "launch" });
  });

  it("未开启自动启动 → 不拉起（返回可行动的提示分支）", () => {
    const d = decideEnsureLaunch(facts({ autoStart: false }));
    expect(d).toEqual({ kind: "skip-autostart-off" });
  });

  it("未配置 comfyuiPath → 不拉起（提示去设置页填写）", () => {
    const d = decideEnsureLaunch(facts({ comfyuiPath: "" }));
    expect(d).toEqual({ kind: "skip-no-path" });
  });

  it("闩锁优先于「未开自动启动」：两条都命中时给的是「手动关闭」的结论", () => {
    // 顺序写反会让用户在「我刚关了它」时看到「你没开自动启动」，
    // 对着错误的原因去改设置，永远修不好。
    const d = decideEnsureLaunch(facts({ manualStop: true, autoStart: false }));
    expect(d).toEqual({ kind: "skip-manual-stop" });
  });

  it("条件齐备 → launch", () => {
    expect(decideEnsureLaunch(facts())).toEqual({ kind: "launch" });
  });
});

describe("resolveLaunchPolicy — 退出策略到拉起方式", () => {
  it("exitKillComfyui=true → bound（随应用退出连带关闭）", () => {
    expect(resolveLaunchPolicy(true)).toBe("bound");
  });

  it("exitKillComfyui=false → keepAlive（脱离进程树保活）", () => {
    expect(resolveLaunchPolicy(false)).toBe("keepAlive");
  });

  it("未配置（undefined）→ 保活：与设置里的默认值（不勾选）一致，不能意外变成 bound", () => {
    expect(resolveLaunchPolicy(undefined)).toBe("keepAlive");
  });
});

describe("buildSpawnArgs — spawn 参数组装", () => {
  it("有效端口与默认端口一致时不传 --port（避免污染「界面端口=实际端口」对照）", () => {
    const args = buildSpawnArgs({
      baseArgs: ["-s", "/x/main.py"],
      effectivePort: 8188,
      defaultPort: 8188,
      extraArgs: [],
    });
    expect(args).toEqual(["-s", "/x/main.py", COMFY_EMBED_FLAG]);
    expect(args).not.toContain("--port");
  });

  it("有效端口非默认 → 显式传 --port", () => {
    const args = buildSpawnArgs({
      baseArgs: ["-s", "/x/main.py"],
      effectivePort: 8199,
      defaultPort: 8188,
      extraArgs: [],
    });
    expect(args).toEqual([
      "-s",
      "/x/main.py",
      "--port",
      "8199",
      COMFY_EMBED_FLAG,
    ]);
  });

  it("端口为 0/undefined → 落到默认端口且不传 --port", () => {
    for (const port of [undefined, 0]) {
      const args = buildSpawnArgs({
        baseArgs: ["-s", "/x/main.py"],
        effectivePort: port,
        defaultPort: 8188,
        extraArgs: [],
      });
      expect(args).toEqual(["-s", "/x/main.py", COMFY_EMBED_FLAG]);
    }
  });

  it("附加参数追加在最后（不覆盖 --port 的位置语义）", () => {
    const args = buildSpawnArgs({
      baseArgs: ["main.py"],
      effectivePort: 9001,
      defaultPort: 8188,
      extraArgs: ["--cpu", "--lowvram"],
    });
    expect(args).toEqual([
      "main.py",
      "--port",
      "9001",
      "--cpu",
      "--lowvram",
      COMFY_EMBED_FLAG,
    ]);
  });
});

describe("shouldCheckKeepAliveProcess — 保活进程表查询节流", () => {
  const base = { graceMs: 15_000, intervalMs: 5_000 };

  it("宽限期内不查：解释器冷启动时进程可能还没出现在进程表，早查会误判「没起来」", () => {
    expect(
      shouldCheckKeepAliveProcess({
        ...base,
        sinceSpawnMs: 3_000,
        sinceLastCheckMs: 999_999,
      }),
    ).toBe(false);
  });

  it("过了宽限期但距上次查询太近 → 不查（限频，避免每轮轮询全表扫描）", () => {
    expect(
      shouldCheckKeepAliveProcess({
        ...base,
        sinceSpawnMs: 60_000,
        sinceLastCheckMs: 1_000,
      }),
    ).toBe(false);
  });

  it("宽限期后且间隔足够 → 查", () => {
    expect(
      shouldCheckKeepAliveProcess({
        ...base,
        sinceSpawnMs: 20_000,
        sinceLastCheckMs: 6_000,
      }),
    ).toBe(true);
  });
});

describe("isKeepAliveDead — 保活死亡判决", () => {
  it("单次查不到不算死：冷启动高负载下进程表查询可能超时误报", () => {
    expect(isKeepAliveDead(1)).toBe(false);
  });

  it("连续 2 次都查不到 → 判死", () => {
    expect(isKeepAliveDead(2)).toBe(true);
    expect(isKeepAliveDead(5)).toBe(true);
  });
});

describe("buildEarlyExitDetail — 进程秒退文案", () => {
  it("输出里有 No module named 'X' → 给出「缺依赖 + 该动哪个环境」的可行动提示", () => {
    const detail = buildEarlyExitDetail([
      "Traceback (most recent call last):",
      "ModuleNotFoundError: No module named 'torch'",
    ]);
    expect(detail).toContain("No module named 'torch'");
    expect(detail).toContain("comfyuiPath");
    expect(
      extractMissingModule(["ModuleNotFoundError: No module named 'torch'"]),
    ).toBe("torch");
  });

  it("无缺依赖特征 → 退回通用提示并指向日志文件", () => {
    const detail = buildEarlyExitDetail(["some unrelated crash"]);
    expect(detail).toContain("启动后立即退出");
    expect(detail).toContain("log/services/comfyui-runtime.log");
    expect(extractMissingModule(["some unrelated crash"])).toBeNull();
  });
});

describe("decideStop — 关闭流程判决", () => {
  it("握有 bound 子进程句柄 → 杀树，标签为 bound 子进程", () => {
    expect(decideStop({ hasChild: true, pid: 123, stillUp: true })).toEqual({
      kind: "kill",
      pid: 123,
      kindLabel: "bound 子进程",
    });
  });

  it("无句柄但按配置路径定位到 PID → 仍然杀树（ISSUE #100：保活/接管实例也必须关得掉）", () => {
    expect(decideStop({ hasChild: false, pid: 456, stillUp: true })).toEqual({
      kind: "kill",
      pid: 456,
      kindLabel: "按配置路径定位到的进程",
    });
  });

  it("在跑但定位不到 PID（别人启动的实例）→ 不动手，交给用户自己关", () => {
    expect(decideStop({ hasChild: false, pid: null, stillUp: true })).toEqual({
      kind: "foreign-running",
    });
  });

  it("本来就没在跑 → not-running（不报错、不留「关闭中」窗口）", () => {
    expect(decideStop({ hasChild: false, pid: null, stillUp: false })).toEqual({
      kind: "not-running",
    });
  });
});

describe("closeStopping / stopping window", () => {
  it("目标已不在且无正在进行的启动 → 立刻清「关闭中」，不留无意义的进行态窗口", () => {
    expect(
      shouldClearStoppingOnStopMiss({ stillUp: false, starting: false }),
    ).toBe(true);
  });

  it("仍在响应 / 有启动在跑 → 不清，交给窗口时限兜底", () => {
    expect(
      shouldClearStoppingOnStopMiss({ stillUp: true, starting: false }),
    ).toBe(false);
    expect(
      shouldClearStoppingOnStopMiss({ stillUp: false, starting: true }),
    ).toBe(false);
  });

  it("「关闭中」窗口：未标记为 false，窗口内为 true，过期回 false", () => {
    expect(
      isWithinStoppingWindow({
        stoppingAt: undefined,
        nowMs: 1000,
        windowMs: 30_000,
      }),
    ).toBe(false);
    expect(
      isWithinStoppingWindow({
        stoppingAt: 1000,
        nowMs: 1500,
        windowMs: 30_000,
      }),
    ).toBe(true);
    expect(
      isWithinStoppingWindow({
        stoppingAt: 1000,
        nowMs: 99_000,
        windowMs: 30_000,
      }),
    ).toBe(false);
  });
});

describe("decideStopOutcome — 关闭收尾结论", () => {
  it("最后一轮探测仍可达 → ok=false，提示用户手动确认", () => {
    const r = decideStopOutcome([
      "http://127.0.0.1:8188",
      "http://127.0.0.1:8188",
    ]);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("仍在响应");
  });

  it("探测变为不可达 → ok=true", () => {
    const r = decideStopOutcome(["http://127.0.0.1:8188", null]);
    expect(r.ok).toBe(true);
    expect(r.detail).toBe("ComfyUI 已关闭");
  });

  it("一个探测结果都没有（循环没跑）→ 视为未关闭，不给假成功", () => {
    expect(decideStopOutcome([]).ok).toBe(false);
  });
});

/* ── 内嵌放行开关（ISSUE #310）────────────────────────────────────────
 * 这几条钉住的是「本应用拉起的 ComfyUI 一定能被内嵌」这件事本身：
 * 空白页签的成因是未开 CORS 的 origin-only 中间件对跨源返 403，
 * 而开关握在我们手里（见 comfy-embed.ts 的成因说明）。
 */
describe("withEmbedClearanceFlag — 内嵌放行开关注入", () => {
  it("未带开关时补上 --enable-cors-header", () => {
    expect(withEmbedClearanceFlag(["main.py", "--port", "8199"])).toEqual([
      "main.py",
      "--port",
      "8199",
      COMFY_EMBED_FLAG,
    ]);
  });

  it("已手填开关时不重复注入（幂等）", () => {
    const already = ["main.py", COMFY_EMBED_FLAG];
    expect(withEmbedClearanceFlag(already)).toEqual(already);
  });

  it("识别 --enable-cors-header=ORIGIN 的等号写法，也算已带", () => {
    const already = ["main.py", `${COMFY_EMBED_FLAG}=http://127.0.0.1:3100`];
    expect(hasEmbedClearanceFlag(already)).toBe(true);
    expect(withEmbedClearanceFlag(already)).toEqual(already);
  });

  it("不改动入参数组（返回新副本）", () => {
    const input = ["main.py"];
    const out = withEmbedClearanceFlag(input);
    expect(input).toEqual(["main.py"]);
    expect(out).not.toBe(input);
  });

  /* 开关放在**最后一位**是刻意的：argparse 的 `nargs="?"` + `const="*"` 让
   * 它在末尾解析为 `*`，既不会吃掉前面参数的值，也不会被当成位置参数。
   * buildSpawnArgs 的顺序契约就靠这条钉住。 */
  it("buildSpawnArgs 把开关放在最后一位", () => {
    const args = buildSpawnArgs({
      baseArgs: ["main.py"],
      effectivePort: 8199,
      defaultPort: 8188,
      extraArgs: ["--cpu", "--lowvram"],
    });
    expect(args[args.length - 1]).toBe(COMFY_EMBED_FLAG);
  });
});

/* ── 运行状态结论的判决表（ISSUE #442）────────────────────────────────
 * 这一条是设置页状态行「启动中 → 未运行 → 运行中」来回跳的判据本身。
 * 输入全是「已探明的事实」，所以能在这里把每种组合逐条钉死——不必起进程、
 * 也不必等 5s 轮询。 */
function statusFacts(over: Partial<ComfyStatusFacts> = {}): ComfyStatusFacts {
  return {
    starting: false,
    stopping: false,
    probe: null,
    snap: {
      running: false,
      pid: null,
      port: null,
      via: null,
      unverified: false,
      didQueryProcTable: true,
    },
    startingWindow: false,
    notRunningHeld: false,
    ...over,
  };
}

describe("deriveComfyUiStatus — 运行状态结论", () => {
  it("HTTP 通了 → 运行中，base 用探测到的真实地址", () => {
    const v = deriveComfyUiStatus(
      statusFacts({ probe: "http://127.0.0.1:8190" }),
    );
    expect(v.up).toBe(true);
    expect(v.base).toBe("http://127.0.0.1:8190");
    expect(v.starting).toBe(false);
  });

  it("进程活着且已绑定端口 → 运行中（/system_stats 短暂不响应也算）", () => {
    const v = deriveComfyUiStatus(
      statusFacts({
        snap: {
          running: true,
          pid: 7,
          port: 8188,
          via: "配置路径的实例",
          unverified: false,
          didQueryProcTable: true,
        },
      }),
    );
    expect(v.up).toBe(true);
    expect(v.base).toBe("http://127.0.0.1:8188");
    expect(v.port).toBe(8188);
  });

  it("进程活着但端口未绑定 → 启动中，不是未运行", () => {
    const v = deriveComfyUiStatus(
      statusFacts({
        snap: {
          running: true,
          pid: 7,
          port: null,
          via: "配置路径的实例",
          unverified: false,
          didQueryProcTable: true,
        },
      }),
    );
    expect(v.up).toBe(false);
    expect(v.starting).toBe(true);
  });

  it("探明没在跑 → 未运行，且不报「检测中」", () => {
    const v = deriveComfyUiStatus(statusFacts());
    expect(v.up).toBe(false);
    expect(v.starting).toBe(false);
    expect(v.probing).toBe(false);
  });

  /* 启动窗口：拉起动作已发出、实例还没被探针看到。这时报「未运行」正是
   * ISSUE #442 里用户看到的那一下闪回。 */
  it("启动窗口内 → 启动中（哪怕探针什么都没看到）", () => {
    const v = deriveComfyUiStatus(statusFacts({ startingWindow: true }));
    expect(v.starting).toBe(true);
    expect(v.probing).toBe(false);
  });

  it("拉起流程进行中（单飞锁）→ 启动中", () => {
    const v = deriveComfyUiStatus(statusFacts({ starting: true }));
    expect(v.starting).toBe(true);
  });

  /* 「探明没在跑」的黏滞：上一轮坐实了未运行，本轮证据更弱（查询超时 /
   * 0 候选一条没问），不该改口成「检测中…」。 */
  it("黏滞期内的事实不可信 → 维持未运行，不翻成「检测中」", () => {
    const v = deriveComfyUiStatus(
      statusFacts({
        notRunningHeld: true,
        snap: {
          running: false,
          pid: null,
          port: null,
          via: null,
          unverified: true,
          didQueryProcTable: true,
        },
      }),
    );
    expect(v.starting).toBe(false);
    expect(v.probing).toBe(false);
  });

  it("一条进程表查询都没发出（0 候选）→ 检测中，不报未运行", () => {
    const v = deriveComfyUiStatus(
      statusFacts({
        snap: {
          running: false,
          pid: null,
          port: null,
          via: null,
          unverified: false,
          didQueryProcTable: false,
        },
      }),
    );
    expect(v.probing).toBe(true);
    expect(v.starting).toBe(false);
  });

  it("探测失败（事实不可信）→ 检测中，不报未运行", () => {
    const v = deriveComfyUiStatus(
      statusFacts({
        snap: {
          running: false,
          pid: null,
          port: null,
          via: null,
          unverified: true,
          didQueryProcTable: true,
        },
      }),
    );
    expect(v.probing).toBe(true);
  });

  it("运行中优先于一切：启动窗口与黏滞都不影响", () => {
    const v = deriveComfyUiStatus(
      statusFacts({
        probe: "http://127.0.0.1:8188",
        startingWindow: true,
        notRunningHeld: true,
      }),
    );
    expect(v.up).toBe(true);
    expect(v.starting).toBe(false);
  });

  it("关闭中标记原样带出（设置页据此保持「关闭中…」）", () => {
    const v = deriveComfyUiStatus(statusFacts({ stopping: true }));
    expect(v.stopping).toBe(true);
    expect(v.up).toBe(false);
  });

  it("兜底 PID：快照没给时用调用方手里那个子进程句柄", () => {
    const v = deriveComfyUiStatus(statusFacts({ fallbackPid: 1234 }));
    expect(v.pid).toBe(1234);
  });
});

describe("isWithinWindow — 计时窗口判据", () => {
  it("没落过时刻 = 无窗口；窗口内为真、过窗为假", () => {
    expect(isWithinWindow({ at: undefined, nowMs: 1_000, windowMs: 10 })).toBe(
      false,
    );
    expect(isWithinWindow({ at: 1_000, nowMs: 1_005, windowMs: 10 })).toBe(
      true,
    );
    expect(isWithinWindow({ at: 1_000, nowMs: 1_010, windowMs: 10 })).toBe(
      false,
    );
  });
});

describe("isPortConflictLine — 端口被占的 stderr 识别", () => {
  it("认出 ComfyUI 绑定端口失败的报错行（实测现场的原文形态）", () => {
    expect(
      isPortConflictLine(
        "[ERROR] Port 8188 is already in use on address 127.0.0.1. Please close the other application or use a different port with --port.",
      ),
    ).toBe(true);
    expect(isPortConflictLine("port 8188 is already in use")).toBe(true);
  });

  it("普通启动输出不误报", () => {
    expect(isPortConflictLine("Starting server")).toBe(false);
    expect(
      isPortConflictLine("To see the GUI go to: http://127.0.0.1:8188"),
    ).toBe(false);
    expect(isPortConflictLine("")).toBe(false);
  });

  it("portConflictExitDetail 给出可行动去向（转接管 + 日志位置）", () => {
    expect(portConflictExitDetail()).toContain("端口已被其他实例占用");
    expect(portConflictExitDetail()).toContain("comfyui-runtime.log");
  });
});
