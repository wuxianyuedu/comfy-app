/**
 * 「这一跑该开几个并发」的唯一出处（ISSUE #1993 / 规范 §13.5.21）。
 *
 * 为什么要有这条判据：并发旋钮最容易退化的形态是「又变回一个常数」—— 有人嫌
 * `resolveCiWorkers()` 绕，直接在 `.cnb.yml` 或跑法脚本里写死 `--maxWorkers=4`，
 * 而**没有任何东西会红**：那个数在一台 16 核的空闲节点上完全够用，只在「节点换规格」
 * 或「同机多一条流水线」时才咬人，且咬出来的形态是既不推进也不报错（实测
 * `cnb-jt3-1k5071kou` 的 ESLint 挂 8640s）。
 *
 * 这条判据钉三件事：
 *   ① 核数的读取顺序（`CNB_CPUS` → 本机 → 兜底），且非法值不许变成 0；
 *   ② 核数 → worker 数的换算方向（**降载**，不是放宽判据）；
 *   ③ 人的出口（`COMFY_CI_MAX_WORKERS`）只调并发、不碰任何判据，非法值按默认办并提醒。
 */
import { describe, expect, it } from "vitest";

import {
  CORES_PER_WORKER,
  FALLBACK_CORES,
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
