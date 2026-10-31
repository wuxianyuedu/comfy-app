import { describe, expect, it } from "vitest";

import {
  CPU_LIMIT_LABELS,
  CPU_LIMIT_MODES,
  POSIX_NICE_INCREMENT,
  THROTTLE_MIN_CORES,
  WINDOWS_BELOW_NORMAL,
  cpuLimitCommands,
  resolveCpuLimitMode,
  throttleCores,
  toCpuLimitMode,
} from "./cpu-limit";

describe("CPU 档位取值（ISSUE #1959）", () => {
  it("三档都有，且每档都有人话名（设置页两处共用一份，不许漏档）", () => {
    expect(CPU_LIMIT_MODES).toEqual(["off", "yield", "throttle"]);
    for (const mode of CPU_LIMIT_MODES) {
      expect(CPU_LIMIT_LABELS[mode].length).toBeGreaterThan(0);
    }
  });

  it("从 JSON 读进来的脏值回落 yield，不认识的值不会被当成某一档", () => {
    expect(toCpuLimitMode("throttle")).toBe("throttle");
    expect(toCpuLimitMode(undefined)).toBe("yield");
    expect(toCpuLimitMode(80)).toBe("yield");
    expect(toCpuLimitMode("HIGH")).toBe("yield");
  });
});

describe("默认档按环境分叉（老设置文件里没有这个键）", () => {
  it("桌面壳内默认让路：用户就在同一个窗口里干别的活", () => {
    expect(
      resolveCpuLimitMode({
        desktopShell: true,
        mode: undefined,
        platform: "win32",
      }),
    ).toBe("yield");
  });

  it("浏览器形态默认不限制：那里没有「同一个窗口里干别的活」这回事，凭空降速只会让人困惑", () => {
    expect(
      resolveCpuLimitMode({
        desktopShell: false,
        mode: undefined,
        platform: "linux",
      }),
    ).toBe("off");
  });

  it("用户显式选过的档一律照办 —— 环境只影响**默认值**", () => {
    for (const mode of CPU_LIMIT_MODES) {
      expect(
        resolveCpuLimitMode({
          desktopShell: true,
          mode,
          platform: "win32",
        }),
      ).toBe(mode);
      expect(
        resolveCpuLimitMode({
          desktopShell: false,
          mode,
          platform: "linux",
        }),
      ).toBe(mode);
    }
  });
});

describe("限核档的核数", () => {
  it("按比例取整，且不少于下界（单核机上 floor(1*0.5)=0 等于不让它跑）", () => {
    expect(throttleCores(1)).toBe(THROTTLE_MIN_CORES);
    expect(throttleCores(2)).toBe(1);
    expect(throttleCores(4)).toBe(2);
    expect(throttleCores(16)).toBe(8);
  });

  it("核数取不到 / 非法时按 2 算，绝不给 0", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(throttleCores(bad)).toBeGreaterThanOrEqual(THROTTLE_MIN_CORES);
    }
  });
});

describe("档位 → 命令形态（两种平台各断言一次，避免「按平台 if 两遍」的散写）", () => {
  it("off 什么都不调 —— 这一条是「关掉」这一档的全部实现", () => {
    const r = cpuLimitCommands({
      cpuCount: 8,
      mode: "off",
      pid: 1234,
      platform: "win32",
    });
    expect(r.priority).toBeNull();
    expect(r.affinity).toBeNull();
  });

  it("POSIX·让路：只调 renice，不碰亲和性", () => {
    const r = cpuLimitCommands({
      cpuCount: 8,
      mode: "yield",
      pid: 4321,
      platform: "linux",
    });
    expect(r.priority?.command).toBe("renice");
    expect(r.priority?.args).toEqual(["-n", String(POSIX_NICE_INCREMENT), "-p", "4321"]);
    expect(r.affinity).toBeNull();
  });

  it("POSIX·限核：既降优先级又限核（两档叠加才是它名字的意思）", () => {
    const r = cpuLimitCommands({
      cpuCount: 8,
      mode: "throttle",
      pid: 4321,
      platform: "linux",
    });
    expect(r.priority?.command).toBe("renice");
    expect(r.affinity?.command).toBe("taskset");
    expect(r.affinity?.args).toEqual(["-cp", "0-3", "4321"]);
  });

  it("Windows·让路：按 PID 改优先级（不是 Start-Process —— 保活路径拿不到那个句柄）", () => {
    const r = cpuLimitCommands({
      cpuCount: 8,
      mode: "yield",
      pid: 777,
      platform: "win32",
    });
    expect(r.priority?.command).toBe("powershell.exe");
    const script = r.priority?.args.join(" ") ?? "";
    // 整条命令只出现单引号：execFile argv → PS -Command 的引号链路会把内嵌
    // 双引号变形（同 proc-detect 的 WMI 查询踩过的坑）。
    expect(script).not.toContain('"');
    expect(script).toContain("Win32_Process");
    expect(script).toContain("ProcessId = 777");
    expect(script).toContain(WINDOWS_BELOW_NORMAL);
    expect(r.affinity).toBeNull();
  });

  it("Windows·限核：亲和性位掩码 = 低 N 位全 1（8 核限 4 核 → 0b1111）", () => {
    const r = cpuLimitCommands({
      cpuCount: 8,
      mode: "throttle",
      pid: 777,
      platform: "win32",
    });
    const script = r.affinity?.args.join(" ") ?? "";
    expect(script).toContain("ProcessorAffinity = 15");
    expect(script).not.toContain('"');
  });

  it("每一条都带一句人话说明 —— 它是用户在运行日志里唯一能确认「生效了」的东西", () => {
    for (const platform of /* SAFETY: 类型断言已复核 */ ["win32", "linux"] as const) {
      for (const mode of CPU_LIMIT_MODES) {
        const { affinity, priority } = cpuLimitCommands({
          cpuCount: 4,
          mode,
          pid: 1,
          platform,
        });
        for (const cmd of [priority, affinity]) {
          if (cmd) {
            expect(cmd.describe.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
