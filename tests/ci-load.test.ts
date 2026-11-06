/**
 * 「这一跑该开几个并发」的唯一出处（ISSUE #1993 / 规范 §13.5.21）。退化形态是「又变回常数」：写死
 * `--maxWorkers=4` 时**没有任何东西会红**，只在节点换规格或同机多流水线时咬人（既不推进也不报错）。
 * 钉三件：① `CNB_CPUS` → 本机 → 兜底（非法值不许变 0）；② 换算方向是**降载**；③ `COMFY_CI_MAX_WORKERS` 只调并发、非法值按默认并提醒。
 */
import { describe, expect, it } from "vitest";

import {
  CORES_PER_WORKER,
  FALLBACK_CORES,
  GA_CORES_PER_WORKER,
  MIN_WORKERS,
  resolveCiWorkers,
  resolveCores,
  workersForCores,
} from "../scripts/ci-load.mjs";

describe("现场核数：平台读数优先，读不到才落本机 / 兜底", () => {
  it("`CNB_CPUS` 是平台给的读数，优先于本机", () => {
    const r = resolveCores({ CNB_CPUS: "16" });
    expect(r.cores).toBe(16);
    expect(r.source).toBe("CNB_CPUS");
    expect(r.note).toBeNull();
  });

  it("没有 `CNB_CPUS` 就按本机读数（正整数），不是拍一个常数", () => {
    const r = resolveCores({});
    expect(Number.isInteger(r.cores)).toBe(true);
    expect(r.cores).toBeGreaterThanOrEqual(1);
    expect(["os", "fallback"]).toContain(r.source);
  });

  it("非法读数按本机办并留一句提醒 —— 不许静默变成 0", () => {
    for (const raw of ["0", "-2", "abc", "8.5"]) {
      const r = resolveCores({ CNB_CPUS: raw });
      expect(r.cores, `CNB_CPUS=${raw} 应当落回本机读数`).toBeGreaterThanOrEqual(1);
      expect(r.note, `CNB_CPUS=${raw} 必须留一句提醒`).toContain("CNB_CPUS");
    }
  });
});

describe("核数 → worker 数：方向是降载，不是放宽判据", () => {
  it("档位是「一个 worker 至少 8 核」：16 核 ⇒ 2（钉住常数本身，不拿公式自证）", () => {
    /* 这条以前写的是 `toBe(16 / CORES_PER_WORKER)` —— 那是恒等式，把常数改成任何值
     * 它都绿。档位是**判断**，必须逐字钉在这里：改常数就要同时改这一行。 */
    expect(CORES_PER_WORKER).toBe(8);
    expect(workersForCores(16)).toBe(2);
    expect(workersForCores(8)).toBe(1);
    expect(workersForCores(12)).toBe(2);
  });

  it("核越多 worker 越多（单调不减），小核机不会被算成 0", () => {
    let prev = 0;
    for (const cores of [1, 2, 3, 4, 6, 8, 12, 16, 32]) {
      const w = workersForCores(cores);
      expect(w, `${cores} 核算不出至少 ${MIN_WORKERS} 个 worker`).toBeGreaterThanOrEqual(
        MIN_WORKERS,
      );
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  it("不是整数核也不炸（拿不到读数时按兜底那一档算）", () => {
    for (const cores of [Number.NaN, 0, -1]) {
      expect(workersForCores(cores)).toBeGreaterThanOrEqual(MIN_WORKERS);
    }
    expect(workersForCores(FALLBACK_CORES)).toBeGreaterThanOrEqual(MIN_WORKERS);
  });
});

describe("人的出口：只调并发，不动任何判据", () => {
  it("不设 `COMFY_CI_MAX_WORKERS` 时用核数推出来的那个", () => {
    const r = resolveCiWorkers({ env: { CNB_CPUS: "16" } });
    /* 具体数值由上面那条钉档位；这里钉的是「默认值 == 公式值」这层关系。 */
    expect(r.workers).toBe(workersForCores(16));
    expect(r.note).toBeNull();
  });

  it("设了就用它（机器被别的东西占着时压到 1 是唯一还兑现得了的动作）", () => {
    const r = resolveCiWorkers({
      env: { CNB_CPUS: "16", COMFY_CI_MAX_WORKERS: "1" },
    });
    expect(r.workers).toBe(1);
    expect(r.note).toContain("只调并发");
  });

  it("非法值按默认办并提醒，不许静默降级成 0", () => {
    for (const raw of ["0", "-1", "abc", "2.5"]) {
      const r = resolveCiWorkers({
        env: { CNB_CPUS: "16", COMFY_CI_MAX_WORKERS: raw },
      });
      expect(r.workers, `COMFY_CI_MAX_WORKERS=${raw}`).toBe(workersForCores(16));
      expect(r.note, `COMFY_CI_MAX_WORKERS=${raw} 必须留一句提醒`).toContain(
        "COMFY_CI_MAX_WORKERS",
      );
    }
  });
});

describe("平台分档：CNB 共享宿主机 8 / GA 独享 2（CNB 数字一个不改）", () => {
  it("CNB 档保持原值：16⇒2、8⇒1、12⇒2", () => {
    expect(CORES_PER_WORKER).toBe(8);
    expect(resolveCiWorkers({ env: { CNB_CPUS: "16" } }).workers).toBe(2);
    expect(resolveCiWorkers({ env: { CNB_CPUS: "8" } }).workers).toBe(1);
    expect(resolveCiWorkers({ env: { CNB_CPUS: "12" } }).workers).toBe(2);
  });

  it("GA 档是「一个 worker 至少 2 核」：4 核 ⇒ 2、2 核 ⇒ 1", () => {
    expect(GA_CORES_PER_WORKER).toBe(2);
    expect(workersForCores(4, GA_CORES_PER_WORKER)).toBe(2);
    expect(workersForCores(2, GA_CORES_PER_WORKER)).toBe(1);
    expect(resolveCiWorkers({ env: { GITHUB_ACTIONS: "true", CNB_CPUS: "4" } }).workers).toBe(2);
  });

  it("同一个核数在两档上给出不同答案 —— 分档真的生效，不是同一常数换张皮", () => {
    expect(resolveCiWorkers({ env: { CNB_CPUS: "8" } }).workers).toBe(1);
    expect(resolveCiWorkers({ env: { GITHUB_ACTIONS: "true", CNB_CPUS: "8" } }).workers).toBe(4);
  });

  it('缺省 / 非 "true" 的 `GITHUB_ACTIONS` 一律按 CNB 档（本地与 CNB 行为逐字不变）', () => {
    for (const v of [undefined, "", "false", "1", "TRUE "]) {
      const env: Record<string, string | undefined> = { CNB_CPUS: "16" };
      if (v !== undefined) env.GITHUB_ACTIONS = v;
      expect(resolveCiWorkers({ env }).workers, `GITHUB_ACTIONS=${String(v)}`).toBe(2);
    }
  });

  it("人的出口在 GA 档上同样优先，且仍只调并发", () => {
    const r = resolveCiWorkers({
      env: { GITHUB_ACTIONS: "true", CNB_CPUS: "4", COMFY_CI_MAX_WORKERS: "1" },
    });
    expect(r.workers).toBe(1);
    expect(r.note).toContain("只调并发");
  });
});
